const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

function setup(options = {}) {
  let pipe
  let updater
  let calls = 0
  class PearRuntime extends EventEmitter {
    constructor() {
      super()
      this.storage = '/test-only/app-storage'
      updater = this.updater = Object.assign(new EventEmitter(), {
        bundled: true,
        updated: true,
        next: '/test-only/staged',
        applied: false,
        drive: { core: { discoveryKey: Buffer.alloc(32) } },
        applyUpdate() {
          calls++
          updater.applied = true
          return options.apply ? options.apply() : Promise.resolve()
        },
        ...options.updater
      })
    }
    ready() {
      return options.readyError ? Promise.reject(options.readyError) : Promise.resolve()
    }
  }
  class Autopass extends EventEmitter {
    ready() {
      return Promise.resolve()
    }
  }
  class Hyperswarm extends EventEmitter {
    join() {}
  }
  class FramedStream extends EventEmitter {
    constructor() {
      super()
      pipe = this
      this.messages = []
    }
    write(message) {
      this.messages.push(message)
      return true
    }
  }
  const modules = {
    'pear-runtime': PearRuntime,
    hyperswarm: Hyperswarm,
    corestore: class {},
    'graceful-goodbye': () => {},
    'framed-stream': FramedStream,
    'bare-path': path,
    'bare-storage': { persistent: () => '/test-only/storage' },
    'which-runtime': { isBareKit: false },
    autopass: Autopass
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../workers/main.js'), 'utf8'), {
    require(name) {
      assert.ok(name in modules, 'unexpected worker dependency ' + name)
      return modules[name]
    },
    Bare: {
      argv: [
        'bare',
        'worker',
        String(options.updates ?? true),
        '1.0.0',
        'test',
        'Test.msix',
        '/test-only/storage',
        options.app ?? '/test-only/installed'
      ],
      IPC: {}
    }
  })
  return {
    pipe,
    calls: () => calls,
    send: () => pipe.emit('data', Buffer.from('pear:applyUpdate')),
    failures: () => pipe.messages.filter((message) => message.startsWith('pear:updateFailed')),
    successes: () => pipe.messages.filter((message) => message === 'pear:updateApplied')
  }
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve))
}

test('worker refuses disabled, development, unstaged and latched apply without swapping', async () => {
  for (const options of [
    { updates: false },
    { app: 'null' },
    { app: 'undefined' },
    { updater: { bundled: false } },
    { updater: { updated: false } },
    { updater: { next: null } },
    { updater: { applied: true } },
    { readyError: new Error('dummy readiness failure') }
  ]) {
    const harness = setup(options)
    harness.send()
    await flush()
    assert.equal(harness.calls(), 0)
    assert.equal(harness.failures().length, 1)
    assert.equal(harness.successes().length, 0)
  }
})

test('worker sends a failure for a rejected mocked swap and does not claim success', async () => {
  const harness = setup({ apply: () => Promise.reject(new Error('dummy swap failure')) })
  harness.send()
  await flush()
  assert.equal(harness.calls(), 1)
  assert.deepEqual(harness.failures(), ['pear:updateFailed dummy swap failure'])
  assert.equal(harness.successes().length, 0)
  harness.send()
  await flush()
  assert.equal(harness.calls(), 1, 'the latched updater cannot swap again')
  assert.match(harness.failures()[1], /already attempted/)
})

test('concurrent raw worker apply requests share one mocked operation', async () => {
  let complete
  const operation = new Promise((resolve) => {
    complete = resolve
  })
  const harness = setup({ apply: () => operation })
  harness.send()
  harness.send()
  await flush()
  assert.equal(harness.calls(), 1)
  assert.equal(harness.failures().length, 0)
  complete()
  await flush()
  assert.deepEqual(harness.successes(), ['pear:updateApplied'])
})
