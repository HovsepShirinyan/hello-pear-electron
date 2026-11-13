// https://github.com/holepunchto/hello-pear-worker v1.2.0

const PearRuntime = require('pear-runtime') // pear-runtime on desktop; pear-mobile on mobile
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const goodbye = require('graceful-goodbye')
const FramedStream = require('framed-stream')
const path = require('bare-path')
const dir = require('bare-storage')
const { isBareKit } = require('which-runtime')
const Autopass = require('autopass')

// mobile doesn't have the executable path (argv[0])
// and the worker entry path (argv[1]) in the workers argv‘s
// ... to reuse the same worker in all platforms this logic is needed
const argv = (index) => Bare.argv[index + (isBareKit ? 0 : 2)]

const updaterConfig = {
  updates: argv(0) !== 'false',
  version: argv(1),
  upgrade: argv(2),
  name: argv(3),
  dir: argv(4) || dir.persistent(), // argv[4] is undefined in mobile
  app: argv(5) // argv[5] is undefined in mobile
}

const pipe = new FramedStream(Bare.IPC)
const store = new Corestore(path.join(updaterConfig.dir, 'pear-runtime', 'corestore'))
const swarm = new Hyperswarm()
const pear = new PearRuntime({ ...updaterConfig, swarm, store })
const autopassStore = new Corestore(path.join(pear.storage, 'autopass'))

const pass = new Autopass(autopassStore)
pass.on('update', () => {
  pipe.write(JSON.stringify({ type: 'entries:changed' }))
})
const pendingEntryAdds = new Set()

pass.ready().then(
  () => pipe.write('autopass-ready'),
  (err) => pipe.write('autopass-error ' + err.message)
)
pear.updater.on('error', (err) => pipe.write('updater-error ' + err.message))

if (updaterConfig.updates !== false) {
  swarm.on('connection', (connection) => store.replicate(connection))
  swarm.join(pear.updater.drive.core.discoveryKey, {
    client: true,
    server: false
  })
}

// An append on the app's drive doesn't check for an update straight away: the
// updater defers it by a random delay of up to an hour (see PearRuntimeUpdater)
// so that a released fleet doesn't hit the seeder all at once. Forward the
// delay so the app can say it is waiting rather than look inert — without it,
// a staged update is indistinguishable from a broken updater for up to an hour.
pear.updater.on('update-scheduled', (delay) => pipe.write('update-scheduled ' + delay))
pear.updater.on('updating', () => pipe.write('updating'))
pear.updater.on('updated', () => pipe.write('updated'))
pear.on('minver-required', () => pipe.write('minver-required')) // for mobile store update notification

goodbye(async () => {
  await swarm.destroy()
  await pear.close()
  await store.close()
  await pass.close()
  await autopassStore.close()
})

let applyingUpdate = false

pipe.on('data', async (data) => {
  const message = data.toString()

  let request

  try {
    request = JSON.parse(message)
  } catch {
    request = null
  }

  const requestId = typeof request?.requestId === 'string' ? request.requestId : undefined

  if (request?.type === 'entries:add') {
    let pendingKey = null
    try {
      if (typeof request.key !== 'string' || !request.key.trim()) {
        throw new Error('Entry name is required.')
      }

      if (typeof request.value !== 'string') {
        throw new Error('Entry value must be text.')
      }

      const key = request.key.trim()

      if (pendingEntryAdds.has(key)) {
        throw new Error('An entry with this name is being added.')
      }

      pendingEntryAdds.add(key)
      pendingKey = key

      await pass.ready()

      if ((await pass.get(key)) !== null) {
        throw new Error('An entry with this name already exists.')
      }

      await pass.add(key, request.value)

      pipe.write(JSON.stringify({ type: 'entries:add:result', key, requestId }))
    } catch (err) {
      pipe.write(JSON.stringify({ type: 'entries:add:error', error: err.message, requestId }))
    } finally {
      if (pendingKey !== null) pendingEntryAdds.delete(pendingKey)
    }

    return
  }

  if (request?.type === 'entries:remove') {
    try {
      if (typeof request.key !== 'string' || !request.key.trim()) {
        throw new Error('Entry name is required.')
      }

      const key = request.key.trim()

      await pass.ready()
      await pass.remove(key)

      pipe.write(JSON.stringify({ type: 'entries:remove:result', key, requestId }))
    } catch (err) {
      pipe.write(JSON.stringify({ type: 'entries:remove:error', error: err.message, requestId }))
    }

    return
  }

  if (message === 'entries:list' || request?.type === 'entries:list') {
    try {
      await pass.ready()
      const entries = []
      for await (const entry of pass.list()) entries.push(entry)
      pipe.write(JSON.stringify({ type: 'entries:list:result', entries, requestId }))
    } catch (err) {
      pipe.write(JSON.stringify({ type: 'entries:list:error', error: err.message, requestId }))
    }
    return
  }

  if (message !== 'pear:applyUpdate') {
    pipe.write('unknown-message ' + message)
    return
  }

  // Concurrent raw requests share the result of the current apply operation.
  if (applyingUpdate) return
  applyingUpdate = true
  try {
    if (!updaterConfig.updates) throw new Error('Updates are disabled for this app session.')
    if (!updaterConfig.app || updaterConfig.app === 'null' || updaterConfig.app === 'undefined') {
      throw new Error('Updates cannot be applied outside an installed app.')
    }
    await pear.ready()
    if (pear.updater.applied) {
      throw new Error('An update was already attempted. Restart the app before trying again.')
    }
    if (!pear.updater.bundled || !pear.updater.updated || !pear.updater.next) {
      throw new Error('No downloaded update is ready to apply.')
    }
    await pear.updater.applyUpdate()
    pipe.write('pear:updateApplied')
  } catch (err) {
    pipe.write('pear:updateFailed ' + err.message)
  } finally {
    applyingUpdate = false
  }
})

pipe.write('Hello from worker')
