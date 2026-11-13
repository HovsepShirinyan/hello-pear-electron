const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const path = require('node:path')
const { duplexPair } = require('node:stream')
const test = require('node:test')
const vm = require('node:vm')
const FramedStream = require('framed-stream')
const createUpdateRequest = require('../electron/update-request.cjs')

function setup(options = {}) {
  const pipe = new EventEmitter()
  pipe.rawStream = new EventEmitter()
  const writes = []
  const timers = new Map()
  pipe.write = (message) => {
    writes.push(message)
    if (options.writeError) throw options.writeError
    return true
  }
  const apply = createUpdateRequest(() => pipe, {
    timeoutMs: 50,
    setTimeout(callback, delay) {
      assert.equal(delay, 50)
      timers.set(1, callback)
      return 1
    },
    clearTimeout(id) {
      timers.delete(id)
    }
  })
  return {
    pipe,
    writes,
    apply,
    timeout() {
      const callback = timers.get(1)
      timers.delete(1)
      callback()
    },
    assertClean() {
      assert.equal(timers.size, 0)
      for (const emitter of [pipe, pipe.rawStream]) {
        for (const event of emitter.eventNames()) assert.equal(emitter.listenerCount(event), 0)
      }
    }
  }
}

test('duplicate apply calls share one request and clean up after success', async () => {
  const harness = setup()
  const first = harness.apply()
  assert.equal(harness.apply(), first)
  assert.deepEqual(harness.writes, ['pear:applyUpdate'])
  harness.pipe.emit('data', Buffer.from('updated'))
  harness.pipe.emit('data', Buffer.from('pear:updateFailed-other'))
  harness.pipe.emit('data', Buffer.from('pear:updateApplied'))
  await first
  assert.equal(harness.apply(), first, 'a completed swap is not sent again')
  assert.equal(harness.writes.length, 1)
  harness.assertClean()
})

test('raw update failure rejects and cannot be retried on the latched worker', async () => {
  const harness = setup()
  const first = harness.apply()
  const rejection = assert.rejects(first, /dummy swap failure.*Restart the app/)
  harness.pipe.emit('data', Buffer.from('pear:updateFailed dummy swap failure'))
  await rejection
  assert.equal(harness.apply(), first)
  await assert.rejects(harness.apply(), /dummy swap failure/)
  assert.equal(harness.writes.length, 1)
  harness.assertClean()
})

for (const failure of [
  'pipe error',
  'worker error',
  'worker exit',
  'connection close',
  'timeout'
]) {
  test(`${failure} rejects the apply request and removes listeners and deadline`, async () => {
    const harness = setup()
    const pending = harness.apply()
    const rejection = assert.rejects(pending, /Restart the app/)
    if (failure === 'pipe error') harness.pipe.emit('error', new Error('dummy IPC failure'))
    if (failure === 'worker error') {
      harness.pipe.rawStream.emit('error', new Error('dummy worker failure'))
    }
    if (failure === 'worker exit') harness.pipe.rawStream.emit('exit', 1)
    if (failure === 'connection close') harness.pipe.emit('close')
    if (failure === 'timeout') harness.timeout()
    await rejection
    harness.pipe.emit('data', Buffer.from('pear:updateApplied'))
    assert.equal(harness.apply(), pending, 'late success must not enable another request')
    harness.assertClean()
  })
}

test('a synchronous write failure rejects and cleans up', async () => {
  const harness = setup({ writeError: new Error('dummy write failure') })
  await assert.rejects(harness.apply(), /dummy write failure/)
  harness.assertClean()
})

test('actual FramedStream duplexes transport raw success and failure replies', async (t) => {
  for (const response of ['pear:updateApplied', 'pear:updateFailed dummy apply failure']) {
    const [client, server] = duplexPair()
    const pipe = new FramedStream(client)
    const backend = new FramedStream(server)
    pipe.on('error', () => {})
    backend.on('error', () => {})
    t.after(() => {
      pipe.destroy()
      backend.destroy()
    })
    backend.on('data', (data) => {
      assert.equal(data.toString(), 'pear:applyUpdate')
      backend.write(response)
    })
    const initialRawErrorListeners = client.listenerCount('error')
    const apply = createUpdateRequest(() => pipe, { timeoutMs: 1000 })
    const pending = apply()
    assert.equal(apply(), pending)
    if (response === 'pear:updateApplied') await pending
    else await assert.rejects(pending, /dummy apply failure.*Restart the app/)
    assert.equal(pipe.listenerCount('data'), 0)
    assert.equal(pipe.listenerCount('error'), 1, 'the owner error listener remains')
    assert.equal(pipe.listenerCount('close'), 0)
    assert.equal(client.listenerCount('exit'), 0)
    assert.equal(client.listenerCount('error'), initialRawErrorListeners)
  }
})

test('worker startup failure rejects without waiting for a timeout', async () => {
  const apply = createUpdateRequest(() => {
    throw new Error('dummy spawn failure')
  })
  await assert.rejects(apply(), /dummy spawn failure/)
})

test('a replacement worker receives its own apply attempt', async () => {
  const first = setup()
  const second = setup()
  let current = first.pipe
  const apply = createUpdateRequest(() => current)
  const failed = apply()
  const rejection = assert.rejects(failed, /stopped/)
  first.pipe.rawStream.emit('exit', 1)
  await rejection
  current = second.pipe
  const retry = apply()
  assert.notEqual(retry, failed)
  second.pipe.emit('data', Buffer.from('pear:updateApplied'))
  await retry
  assert.equal(first.writes.length, 1)
  assert.equal(second.writes.length, 1)
})

function mainApplyHandler(options) {
  const handlers = new Map()
  const app = new EventEmitter()
  Object.assign(app, {
    isPackaged: options.isPackaged ?? true,
    setPath() {},
    setAsDefaultProtocolClient() {},
    requestSingleInstanceLock: () => false,
    quit() {}
  })
  const command = () => ({
    parse() {},
    flags: { updates: options.updates ?? true }
  })
  const flag = () => ({
    hide() {
      return this
    }
  })
  let spawned = false
  const modules = {
    electron: {
      app,
      BrowserWindow: { getAllWindows: () => [] },
      ipcMain: { on() {}, handle: (channel, handler) => handlers.set(channel, handler) },
      nativeTheme: {}
    },
    os: require('node:os'),
    path,
    'pear-runtime': {
      run() {
        spawned = true
        throw new Error('must not spawn')
      }
    },
    'framed-stream': class {},
    './update-request.cjs': createUpdateRequest,
    'which-runtime': {
      isMac: options.platform === 'darwin',
      isLinux: options.platform === 'linux',
      isWindows: options.platform === 'win32'
    },
    paparam: { command, flag },
    '../package.json': { name: 'test', productName: 'Test', version: '1.0.0', upgrade: 'test' }
  }
  const fakeRequire = (name) => {
    assert.ok(name in modules, 'unexpected main-process dependency ' + name)
    return modules[name]
  }
  fakeRequire.resolve = () => 'test-only-worker'
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8'), {
    require: fakeRequire,
    process: {
      argv: ['test', 'test'],
      env: options.env ?? {},
      platform: options.platform,
      windowsStore: options.windowsStore,
      mas: options.mas
    },
    __dirname: path.join(__dirname, '../electron'),
    console
  })
  return { apply: handlers.get('pear:applyUpdate'), spawned: () => spawned }
}

test('main rejects dev, disabled, unpackaged Windows, Snap, Flatpak and non-AppImage apply', () => {
  for (const options of [
    { platform: 'darwin', isPackaged: false },
    { platform: 'darwin', updates: false },
    { platform: 'darwin', mas: true },
    { platform: 'win32', windowsStore: false },
    { platform: 'linux' },
    { platform: 'linux', env: { APPIMAGE: '/dummy/app', SNAP: 'dummy' } },
    { platform: 'linux', env: { APPIMAGE: '/dummy/app', FLATPAK_ID: 'dummy' } }
  ]) {
    const harness = mainApplyHandler(options)
    assert.throws(harness.apply, /supported installed app/)
    assert.equal(harness.spawned(), false)
  }
})
