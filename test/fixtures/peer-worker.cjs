// Test-only Bare entry point. Load the packaged modules, never development shims.
const [appDirectory, storage, bootstrapJson, mode, invite] = Bare.argv.slice(2)
const modules = appDirectory + '/node_modules/'
const Autopass = require(modules + 'autopass')
const Corestore = require(modules + 'corestore')
const FramedStream = require(modules + 'framed-stream')
const goodbye = require(modules + 'graceful-goodbye')
const b4a = require(modules + 'b4a')

const bootstrap = JSON.parse(bootstrapJson)
if (
  !Array.isArray(bootstrap) ||
  bootstrap.length === 0 ||
  bootstrap.some((node) => node.host !== '127.0.0.1' || !Number.isInteger(node.port))
) {
  throw new Error('Peer smoke requires an explicit loopback-only bootstrap list.')
}

const pipe = new FramedStream(Bare.IPC)
const store = new Corestore(storage)
let pass = null
let pair = null
let updates = 0

goodbye(async () => {
  if (pass) await pass.close()
  else if (pair) await pair.close()
  await store.close()
})

function send(message) {
  pipe.write(JSON.stringify(message))
}

async function open() {
  if (mode === 'pair') {
    pair = Autopass.pair(store, invite, { bootstrap, name: 'local-test-peer' })
    pass = await pair.finished()
  } else {
    pass = new Autopass(store, { bootstrap })
  }
  await pass.ready()
  pass.on('update', () => send({ type: 'entries:changed', updates: ++updates }))
  send({
    type: 'ready',
    key: b4a.toString(pass.key, 'hex'),
    writerKey: b4a.toString(pass.writerKey, 'hex'),
    writable: pass.writable
  })
}

const ready = open()
ready.catch((error) => send({ type: 'boot:error', error: error.message }))

pipe.on('data', async (data) => {
  let request
  try {
    request = JSON.parse(data.toString())
    await ready
    if (request.type === 'invite') {
      send({ type: 'result', requestId: request.requestId, invite: await pass.createInvite() })
      return
    }
    if (request.type === 'list') {
      const entries = []
      for await (const entry of pass.list()) entries.push({ key: entry.key, value: entry.value })
      send({ type: 'result', requestId: request.requestId, entries })
      return
    }
    if (request.type === 'add') await pass.add(request.key, request.value)
    else if (request.type === 'remove') await pass.remove(request.key)
    else throw new Error('Unknown peer smoke operation.')
    send({ type: 'result', requestId: request.requestId })
  } catch (error) {
    send({ type: 'error', requestId: request?.requestId, error: error.message })
  }
})
