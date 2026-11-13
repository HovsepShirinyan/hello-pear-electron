const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

function setup(options = {}) {
  const elements = {
    v: { innerText: 'v' },
    'update-btn': { innerText: 'Apply update', disabled: false, style: { display: 'none' } }
  }
  const ipc = new Set()
  const exits = new Set()
  let applies = 0
  let relaunches = 0
  const bridge = {
    pkg: () => ({ version: '1.0.0' }),
    startWorker: () => Promise.resolve(true),
    writeWorkerIPC: () => Promise.resolve(true),
    onWorkerIPC(specifier, listener) {
      ipc.add(listener)
      return () => ipc.delete(listener)
    },
    onWorkerExit(specifier, listener) {
      exits.add(listener)
      return () => exits.delete(listener)
    },
    onWorkerStdout: () => () => {},
    onWorkerStderr: () => () => {},
    applyUpdate() {
      applies++
      return options.apply ? options.apply() : Promise.resolve()
    },
    appAfterUpdate() {
      relaunches++
      return Promise.resolve()
    }
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8'), {
    window: { bridge },
    document: { getElementById: (id) => elements[id] },
    TextDecoder,
    Error,
    console: { log() {}, error() {} }
  })
  return {
    button: elements['update-btn'],
    status: elements.v,
    applies: () => applies,
    relaunches: () => relaunches,
    emit(message) {
      for (const listener of [...ipc]) listener(Buffer.from(message))
    },
    exit() {
      for (const listener of [...exits]) listener(1)
    }
  }
}

test('failed update remains visible and requires restart rather than an unsafe retry', async () => {
  const harness = setup({
    apply: () =>
      Promise.reject(new Error('dummy apply failure. Restart the app before trying again.'))
  })
  harness.emit('updated')
  await harness.button.onclick()
  assert.match(harness.status.innerText, /dummy apply failure/)
  assert.equal(
    (harness.status.innerText.match(/Restart the app before trying again/g) || []).length,
    1
  )
  assert.equal(harness.button.disabled, true)
  assert.equal(harness.button.innerText, 'Restart app to retry')
  assert.equal(harness.button.style.display, 'inline-block')
  const failure = harness.status.innerText
  harness.emit('updated')
  harness.emit('updating')
  await harness.button.onclick()
  assert.equal(harness.status.innerText, failure)
  assert.equal(harness.applies(), 1)
  assert.equal(harness.relaunches(), 0)
})

test('worker exit while an update is ready disables apply and reports the failure', () => {
  const harness = setup()
  harness.emit('updated')
  harness.exit()
  assert.match(harness.status.innerText, /worker stopped.*Restart the app/)
  assert.equal(harness.button.disabled, true)
})

test('repeated clicks during apply call the backend once and successful shutdown is not a failure', async () => {
  let complete
  const operation = new Promise((resolve) => {
    complete = resolve
  })
  const harness = setup({ apply: () => operation })
  harness.emit('updated')
  const first = harness.button.onclick()
  await harness.button.onclick()
  assert.equal(harness.applies(), 1)
  complete()
  await first
  assert.equal(harness.relaunches(), 1)
  harness.exit()
  assert.doesNotMatch(harness.status.innerText, /failed/)
})
