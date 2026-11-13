const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const filename = path.join(__dirname, '..', 'electron', 'preload.js')
const source = fs.readFileSync(filename, 'utf8')
const worker = '/workers/main.js'

function setup() {
  const ipcRenderer = new EventEmitter()
  let bridge
  const context = vm.createContext({
    require(name) {
      assert.equal(name, 'electron', 'sandbox preload requires only Electron')
      return {
        ipcRenderer,
        contextBridge: {
          exposeInMainWorld(name, api) {
            assert.equal(name, 'bridge')
            bridge = api
          }
        }
      }
    }
  })
  assert.equal(vm.runInContext('typeof Buffer', context), 'undefined')
  vm.runInContext(source, context, { filename })
  return { bridge, ipcRenderer }
}

for (const [method, kind] of [
  ['onWorkerStdout', 'stdout'],
  ['onWorkerStderr', 'stderr'],
  ['onWorkerIPC', 'ipc']
]) {
  test(`${method} forwards exact byte views without a Buffer global`, () => {
    const { bridge, ipcRenderer } = setup()
    const channel = `pear:worker:${kind}:${worker}`
    const received = []
    const off = bridge[method](worker, (...args) => received.push(args))
    const backing = new Uint8Array([99, 0, 127, 128, 255, 88])
    const payload = backing.subarray(1, 5)

    ipcRenderer.emit(channel, { privilegedEvent: true }, payload)
    assert.equal(received.length, 1)
    assert.equal(received[0].length, 1, 'Electron event object must not cross the bridge')
    const bytes = received[0][0]
    assert.equal(Object.prototype.toString.call(bytes), '[object Uint8Array]')
    assert.deepEqual(Array.from(bytes), [0, 127, 128, 255])
    assert.equal(bytes.buffer, payload.buffer)
    assert.equal(bytes.byteOffset, payload.byteOffset)
    assert.equal(bytes.byteLength, payload.byteLength)

    for (const value of [null, undefined, 7]) {
      ipcRenderer.emit(channel, {}, value)
      assert.equal(received.at(-1)[0], value)
    }
    off()
    assert.equal(ipcRenderer.listenerCount(channel), 0)
  })

  test(`${method} keeps workers and stream channels isolated when unsubscribing`, () => {
    const { bridge, ipcRenderer } = setup()
    const channel = `pear:worker:${kind}:${worker}`
    const otherWorker = '/workers/other.js'
    const otherChannel = `pear:worker:${kind}:${otherWorker}`
    let first = 0
    let second = 0
    let other = 0
    const offFirst = bridge[method](worker, () => first++)
    const offSecond = bridge[method](worker, () => second++)
    const offOther = bridge[method](otherWorker, () => other++)

    const payload = new Uint8Array([1])
    ipcRenderer.emit(`pear:worker:not-${kind}:${worker}`, {}, payload)
    assert.deepEqual([first, second, other], [0, 0, 0])
    ipcRenderer.emit(channel, {}, payload)
    assert.deepEqual([first, second, other], [1, 1, 0])
    offFirst()
    offFirst()
    assert.equal(ipcRenderer.listenerCount(channel), 1)
    ipcRenderer.emit(channel, {}, payload)
    ipcRenderer.emit(otherChannel, {}, payload)
    assert.deepEqual([first, second, other], [1, 2, 1])
    offSecond()
    offOther()
    assert.equal(ipcRenderer.eventNames().length, 0)
  })
}

test('worker exits still forward only the exit code and support unsubscribe', () => {
  const { bridge, ipcRenderer } = setup()
  const received = []
  const off = bridge.onWorkerExit(worker, (...args) => received.push(args))
  ipcRenderer.emit('pear:worker:exit:/workers/other.js', {}, 9)
  assert.equal(received.length, 0)
  ipcRenderer.emit('pear:worker:exit:' + worker, { privilegedEvent: true }, 1)
  ipcRenderer.emit('pear:worker:exit:' + worker, {}, null)
  assert.deepEqual(received, [[1], [null]])
  off()
  assert.equal(ipcRenderer.eventNames().length, 0)
})
