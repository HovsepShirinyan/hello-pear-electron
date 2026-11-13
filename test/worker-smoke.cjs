const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const sourcePackage = require(path.join(root, 'package.json'))
const name = sourcePackage.productName || sourcePackage.name
const bundle = path.join(root, 'out', `${name}-${process.platform}-${process.arch}`)
const app =
  process.platform === 'darwin'
    ? path.join(bundle, `${name}.app`, 'Contents', 'Resources', 'app')
    : path.join(bundle, 'resources', 'app')
const pkg = require(path.join(app, 'package.json'))
const PearRuntime = require(path.join(app, 'node_modules', 'pear-runtime'))
const FramedStream = require(path.join(app, 'node_modules', 'framed-stream'))
const fixtures = fs.mkdtempSync(path.join(root, 'out', 'worker-smoke-'))
const workerEntry = path.join(app, 'workers', 'main.js')
const clients = new Set()
const deadline = 15000

function connect(storage, entry = workerEntry) {
  const extension = { win32: '.msix', darwin: '.app', linux: '.AppImage' }[process.platform]
  const installedApp =
    process.platform === 'darwin'
      ? path.join(bundle, `${name}.app`)
      : path.join(bundle, process.platform === 'win32' ? `${name}.exe` : name)
  const worker = PearRuntime.run(entry, [
    false,
    pkg.version,
    pkg.upgrade,
    name + extension,
    storage,
    installedApp
  ])
  const pipe = new FramedStream(worker)
  const messages = []
  const waiters = new Set()
  let exited = false
  let failure = null
  let stderr = ''
  const exit = new Promise((resolve) => {
    worker.once('exit', (code) => {
      exited = true
      failure = new Error(`Worker exited (${code}). ${stderr}`)
      for (const check of [...waiters]) check()
      resolve()
    })
  })
  function onError(error) {
    failure = error
    for (const check of [...waiters]) check()
  }
  worker.on('error', onError)
  pipe.on('error', onError)
  worker.stdout.on('data', () => {})
  worker.stderr.on('data', (data) => {
    stderr = (stderr + data.toString()).slice(-3000)
  })
  pipe.on('data', (data) => {
    const text = data.toString()
    try {
      messages.push(JSON.parse(text))
    } catch {
      messages.push(text)
    }
    if (text.startsWith('autopass-error ')) failure = new Error(text)
    for (const check of [...waiters]) check()
  })
  function wait(predicate, count = 1, from = 0) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => finish(new Error(`Worker reply timed out. ${stderr}`)),
        deadline
      )
      function finish(error, replies) {
        clearTimeout(timer)
        waiters.delete(check)
        if (error) reject(error)
        else resolve(replies)
      }
      function check() {
        const replies = messages.slice(from).filter(predicate)
        if (replies.length >= count) finish(null, replies.slice(0, count))
        else if (failure) finish(failure)
      }
      waiters.add(check)
      check()
    })
  }
  const client = {
    messages,
    waitForChange: (from) => wait((message) => message?.type === 'entries:changed', 1, from),
    request(requests, predicate, count = 1) {
      const response = wait(predicate, count, messages.length)
      try {
        for (const request of requests) {
          pipe.write(typeof request === 'string' ? request : JSON.stringify(request))
        }
      } catch (error) {
        onError(error)
      }
      return response
    },
    async close() {
      pipe.destroy()
      if (!exited) {
        let timer
        try {
          await Promise.race([
            exit,
            new Promise((resolve, reject) => {
              timer = setTimeout(() => {
                worker.kill('SIGKILL')
                reject(new Error('Worker shutdown timed out; forced termination.'))
              }, deadline)
            })
          ])
        } finally {
          clearTimeout(timer)
        }
      }
      clients.delete(client)
    }
  }
  clients.add(client)
  return client
}

const replyFor = (operation) => (message) =>
  message?.type === `${operation}:result` || message?.type === `${operation}:error`
const list = async (client, request = 'entries:list') => {
  const [reply] = await client.request([request], replyFor('entries:list'))
  assert.equal(reply.type, 'entries:list:result')
  return reply
}

async function main() {
  const storage = path.join(fixtures, 'persistent')
  let client = connect(storage)
  assert.deepEqual(await list(client), { type: 'entries:list:result', entries: [] })
  assert.ok(client.messages.includes('Hello from worker'))
  console.log('PASS: packaged worker boots; raw empty list before readiness')

  for (const [index, invalid] of [
    { value: 'test-only' },
    { key: '   ', value: 'test-only' },
    { key: 'invalid-value', value: 123 }
  ].entries()) {
    const requestId = `invalid-${index}`
    const [reply] = await client.request(
      [{ type: 'entries:add', ...invalid, requestId }],
      replyFor('entries:add')
    )
    assert.equal(reply.type, 'entries:add:error')
    assert.equal(reply.requestId, requestId)
    assert.equal(typeof reply.error, 'string')
  }

  let from = client.messages.length
  const [added] = await client.request(
    [{ type: 'entries:add', key: ' dummy-note ', value: 'test-only', requestId: 'add' }],
    replyFor('entries:add')
  )
  assert.deepEqual(added, { type: 'entries:add:result', key: 'dummy-note', requestId: 'add' })
  await client.waitForChange(from)
  for (let attempt = 0; attempt < 2; attempt++) {
    const [duplicate] = await client.request(
      [{ type: 'entries:add', key: 'dummy-note', value: 'must-not-overwrite' }],
      replyFor('entries:add')
    )
    assert.equal(duplicate.type, 'entries:add:error')
    assert.equal(duplicate.error, 'An entry with this name already exists.')
    assert.equal(Object.hasOwn(duplicate, 'requestId'), false)
  }
  assert.equal((await list(client)).entries[0].value, 'test-only')
  console.log('PASS: validation, trimmed add, duplicate protection, and request correlation')

  const concurrent = await client.request(
    [
      {
        type: 'entries:add',
        key: 'concurrent-note',
        value: 'first-test-value',
        requestId: 'first'
      },
      {
        type: 'entries:add',
        key: 'concurrent-note',
        value: 'second-test-value',
        requestId: 'second'
      }
    ],
    replyFor('entries:add'),
    2
  )
  assert.equal(concurrent.find((reply) => reply.requestId === 'first').type, 'entries:add:result')
  assert.equal(concurrent.find((reply) => reply.requestId === 'second').type, 'entries:add:error')
  const listed = await list(client, { type: 'entries:list', requestId: 'list' })
  assert.equal(listed.requestId, 'list')
  assert.equal(listed.entries.length, 2)
  assert.equal(
    listed.entries.find((entry) => entry.key === 'concurrent-note').value,
    'first-test-value'
  )
  console.log('PASS: concurrent duplicate preserves the first value; JSON listing')

  for (const invalid of [{}, { key: '   ' }, { key: 123 }]) {
    const [reply] = await client.request(
      [{ type: 'entries:remove', ...invalid, requestId: 'remove-invalid' }],
      replyFor('entries:remove')
    )
    assert.equal(reply.type, 'entries:remove:error')
    assert.equal(reply.requestId, 'remove-invalid')
  }
  from = client.messages.length
  const [removed] = await client.request(
    [{ type: 'entries:remove', key: ' dummy-note ', requestId: 'remove' }],
    replyFor('entries:remove')
  )
  assert.deepEqual(removed, {
    type: 'entries:remove:result',
    key: 'dummy-note',
    requestId: 'remove'
  })
  await client.waitForChange(from)
  for (const text of ['Hello from renderer', 'test-only-unknown']) {
    assert.deepEqual(
      await client.request([text], (message) => message === `unknown-message ${text}`),
      [`unknown-message ${text}`]
    )
  }
  await client.close()
  client = connect(storage)
  const persisted = (await list(client)).entries
  assert.equal(persisted.length, 1)
  assert.equal(persisted[0].key, 'concurrent-note')
  assert.equal(persisted[0].value, 'first-test-value')
  await client.close()
  console.log('PASS: removal, change events, raw protocol, and persistence across restart')

  const errorEntry = path.join(fixtures, 'list-error.cjs')
  fs.writeFileSync(
    errorEntry,
    `const Autopass = require(${JSON.stringify(path.join(app, 'node_modules', 'autopass'))})\n` +
      'Autopass.prototype.list = function () { throw new Error("test-only failure") }\n' +
      `require(${JSON.stringify(workerEntry)})\n`
  )
  client = connect(path.join(fixtures, 'error'), errorEntry)
  const [error] = await client.request(
    [{ type: 'entries:list', requestId: 'list-error' }],
    replyFor('entries:list')
  )
  assert.deepEqual(error, {
    type: 'entries:list:error',
    error: 'test-only failure',
    requestId: 'list-error'
  })
  await client.request(
    ['still-responsive'],
    (message) => message === 'unknown-message still-responsive'
  )
  await client.close()
  console.log('PASS: listing errors retain correlation; worker remains responsive')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    const results = await Promise.allSettled([...clients].map((client) => client.close()))
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error(result.reason)
        process.exitCode = 1
      }
    }
  })
