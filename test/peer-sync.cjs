const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const pkg = require(path.join(root, 'package.json'))
const name = pkg.productName || pkg.name
const bundle = path.join(root, 'out', `${name}-${process.platform}-${process.arch}`)
const packagedApp =
  process.platform === 'darwin'
    ? path.join(bundle, `${name}.app`, 'Contents', 'Resources', 'app')
    : path.join(bundle, 'resources', 'app')
const modules = path.join(packagedApp, 'node_modules')
const PearRuntime = require(path.join(modules, 'pear-runtime'))
const FramedStream = require(path.join(modules, 'framed-stream'))
const createTestnet = require(path.join(modules, 'hyperdht', 'testnet'))
const fixtures = fs.mkdtempSync(path.join(root, 'out', 'peer-sync-'))
const clients = new Set()
const deadline = 30000
let testnet = null

function bounded(promise, label, timeout = deadline) {
  let timer
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), timeout)
    })
  ]).finally(() => clearTimeout(timer))
}

function connect(storage, bootstrap, mode = 'open', invite = '') {
  const worker = PearRuntime.run(path.join(__dirname, 'fixtures', 'peer-worker.cjs'), [
    packagedApp,
    storage,
    JSON.stringify(bootstrap),
    mode,
    invite
  ])
  const pipe = new FramedStream(worker)
  const messages = []
  const waiters = new Set()
  let requestNumber = 0
  let exited = false
  let failure = null
  let stderr = ''
  const exit = new Promise((resolve) => {
    worker.once('exit', (code) => {
      exited = true
      failure = new Error(`Peer sidecar exited (${code}). ${stderr}`)
      for (const check of [...waiters]) check()
      resolve()
    })
  })
  function fail(error) {
    failure = error
    for (const check of [...waiters]) check()
  }
  worker.on('error', fail)
  pipe.on('error', fail)
  worker.stdout.on('data', () => {})
  worker.stderr.on('data', (data) => {
    stderr = (stderr + data.toString()).slice(-3000)
  })
  pipe.on('data', (data) => {
    let message
    try {
      message = JSON.parse(data.toString())
    } catch {
      fail(new Error('Peer fixture sent an invalid frame.'))
      return
    }
    messages.push(message)
    if (message.type === 'boot:error') fail(new Error(message.error))
    for (const check of [...waiters]) check()
  })
  function wait(predicate, from = 0) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error(`Peer reply timed out. ${stderr}`)), deadline)
      function finish(error, message) {
        clearTimeout(timer)
        waiters.delete(check)
        if (error) reject(error)
        else resolve(message)
      }
      function check() {
        const message = messages.slice(from).find(predicate)
        if (message) finish(null, message)
        else if (failure) finish(failure)
      }
      waiters.add(check)
      check()
    })
  }
  const client = {
    messages,
    ready: () => wait((message) => message.type === 'ready'),
    changed: (from) => wait((message) => message.type === 'entries:changed', from),
    async request(type, data = {}) {
      const requestId = String(++requestNumber)
      const reply = wait((message) => message.requestId === requestId, messages.length)
      try {
        pipe.write(JSON.stringify({ type, ...data, requestId }))
      } catch (error) {
        fail(error)
      }
      const response = await reply
      if (response.type === 'error') throw new Error(response.error)
      return response
    },
    async close() {
      if (!exited) pipe.destroy()
      try {
        await bounded(exit, 'peer shutdown', 10000)
      } catch (error) {
        worker.kill('SIGKILL')
        throw error
      } finally {
        clients.delete(client)
      }
    },
    kill() {
      worker.kill('SIGKILL')
    }
  }
  clients.add(client)
  return client
}

async function eventuallyEntries(client, expected, label) {
  const until = Date.now() + deadline
  while (true) {
    const { entries } = await client.request('list')
    if (
      entries.length === expected.length &&
      expected.every((record) =>
        entries.some((entry) => entry.key === record.key && entry.value === record.value)
      )
    ) {
      return entries
    }
    if (Date.now() > until) throw new Error(`Peer data did not converge: ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

async function main() {
  // Retain each node before awaiting startup, so failure cleanup can close even
  // a node that never bootstraps. The first node has no bootstrap peers.
  testnet = await createTestnet(0)
  const first = testnet.createNode({ ephemeral: false, firewalled: false, bootstrap: [] })
  await bounded(first.fullyBootstrapped(), 'first local DHT node')
  testnet.bootstrap.push({ host: '127.0.0.1', port: first.address().port })
  await Promise.all(
    [0, 1].map(() =>
      bounded(
        testnet.createNode({ ephemeral: false, firewalled: false }).fullyBootstrapped(),
        'local DHT startup'
      )
    )
  )
  assert.ok(testnet.bootstrap.length > 0)
  assert.ok(testnet.bootstrap.every((node) => node.host === '127.0.0.1'))

  const storageA = path.join(fixtures, 'peer-a')
  const storageB = path.join(fixtures, 'peer-b')
  let a = connect(storageA, testnet.bootstrap)
  const identityA = await a.ready()
  assert.equal(identityA.writable, true)
  const { invite } = await a.request('invite')
  assert.equal(typeof invite, 'string')
  assert.ok(invite.length > 0)
  let b = connect(storageB, testnet.bootstrap, 'pair', invite)
  const identityB = await b.ready()
  assert.equal(identityB.key, identityA.key)
  assert.notEqual(identityB.writerKey, identityA.writerKey)
  assert.equal(identityB.writable, true)
  await eventuallyEntries(b, [], 'initial paired workspace')
  console.log('PASS: two packaged Bare sidecars pair over an isolated loopback DHT')

  const recordA = { key: 'from-peer-a', value: 'dummy-peer-a-value' }
  let from = b.messages.length
  await a.request('add', recordA)
  await b.changed(from)
  await eventuallyEntries(b, [recordA], 'A add reaches B')
  console.log('PASS: peer A add produces peer B update notification and list data')

  const recordB = { key: 'from-peer-b', value: 'dummy-peer-b-value' }
  from = a.messages.length
  await b.request('add', recordB)
  await a.changed(from)
  await eventuallyEntries(a, [recordA, recordB], 'B add reaches A')

  from = a.messages.length
  await b.request('remove', { key: recordA.key })
  await a.changed(from)
  await eventuallyEntries(a, [recordB], 'B remove reaches A')
  console.log('PASS: reverse writes and removal propagate with remote update notifications')

  await Promise.all([a.close(), b.close()])
  a = connect(storageA, testnet.bootstrap)
  b = connect(storageB, testnet.bootstrap)
  const [restartedA, restartedB] = await Promise.all([a.ready(), b.ready()])
  assert.equal(restartedA.key, identityA.key)
  assert.equal(restartedB.key, identityA.key)
  assert.equal(restartedB.writerKey, identityB.writerKey)
  await Promise.all([
    eventuallyEntries(a, [recordB], 'A persistence'),
    eventuallyEntries(b, [recordB], 'B persistence')
  ])
  from = b.messages.length
  await a.request('remove', { key: recordB.key })
  await b.changed(from)
  await eventuallyEntries(b, [], 'replication after restart')
  await eventuallyEntries(a, [], 'final owner state')
  console.log(
    'PASS: paired identity, data, and deletions persist; replication resumes after restart'
  )
}

const watchdog = setTimeout(() => {
  console.error('PEER_SYNC_FAIL: overall test deadline exceeded')
  for (const client of clients) client.kill()
  process.exit(1)
}, 110000)

bounded(main(), 'complete peer synchronization check', 90000)
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    let cleanupFailed = false
    const results = await Promise.allSettled([...clients].map((client) => client.close()))
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error(result.reason)
        process.exitCode = 1
        cleanupFailed = true
      }
    }
    try {
      if (testnet) await bounded(testnet.destroy(), 'local DHT shutdown', 10000)
    } catch (error) {
      console.error(error)
      cleanupFailed = true
    }
    clearTimeout(watchdog)
    if (cleanupFailed) process.exit(1)
  })
