const assert = require('node:assert/strict')
const fs = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')
const path = require('node:path')
const test = require('node:test')

const worker = '/workers/main.js'
let moduleVersion = 0

async function setup(t, options = {}) {
  const ipcListeners = new Set()
  const exitListeners = new Set()
  const timers = new Map()
  const requests = []
  let nextTimer = 0
  const previousWindow = globalThis.window

  globalThis.window = {
    setTimeout(callback) {
      const id = ++nextTimer
      timers.set(id, callback)
      return id
    },
    clearTimeout(id) {
      timers.delete(id)
    },
    bridge: {
      onWorkerIPC(specifier, listener) {
        assert.equal(specifier, worker)
        ipcListeners.add(listener)
        return () => ipcListeners.delete(listener)
      },
      onWorkerExit(specifier, listener) {
        assert.equal(specifier, worker)
        exitListeners.add(listener)
        return () => exitListeners.delete(listener)
      },
      startWorker(specifier) {
        assert.equal(specifier, worker)
        assert.ok(ipcListeners.size > 0, 'subscribe before starting the worker')
        if (options.startError) return Promise.reject(options.startError)
        return Promise.resolve(true)
      },
      writeWorkerIPC(specifier, data) {
        assert.equal(specifier, worker)
        assert.ok(ipcListeners.size > 0, 'subscribe before sending the request')
        const request = JSON.parse(data)
        assert.equal(typeof request.requestId, 'string')
        assert.ok(request.requestId.length > 0)
        requests.push(request)
        if (options.writeError) return Promise.reject(options.writeError)
        return Promise.resolve(true)
      }
    }
  }

  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  })

  const source = fs.readFileSync(path.join(__dirname, '../renderer/autopass.ts'), 'utf8')
  const javascript = stripTypeScriptTypes(source)
  const service = await import(
    `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}#${++moduleVersion}`
  )

  return {
    service,
    requests,
    emit(message) {
      const data = Buffer.from(typeof message === 'string' ? message : JSON.stringify(message))
      for (const listener of [...ipcListeners]) listener(data)
    },
    exit() {
      for (const listener of [...exitListeners]) listener(1)
    },
    runTimeouts() {
      const callbacks = [...timers.values()]
      timers.clear()
      for (const callback of callbacks) callback()
    },
    assertIdle() {
      assert.equal(ipcListeners.size, 0, 'IPC listeners are removed')
      assert.equal(exitListeners.size, 0, 'exit listeners are removed')
      assert.equal(timers.size, 0, 'request timers are cleared')
    }
  }
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve))
}

function reply(harness, request, fields = {}) {
  harness.emit({
    type: `${request.type}:result`,
    requestId: request.requestId,
    ...fields
  })
}

test('concurrent adds correlate errors and successes by request ID', async (t) => {
  const harness = await setup(t)
  const first = harness.service.addEntry('same-name', 'first dummy value')
  const second = harness.service.addEntry('same-name', 'second dummy value')
  const outcomes = Promise.allSettled([first, second])
  let firstSettled = false
  void first.then(
    () => {
      firstSettled = true
    },
    () => {
      firstSettled = true
    }
  )

  await flush()
  const [firstRequest, secondRequest] = harness.requests
  assert.equal(harness.requests.length, 2)
  assert.notEqual(firstRequest.requestId, secondRequest.requestId)

  harness.emit({
    type: 'entries:add:error',
    requestId: secondRequest.requestId,
    error: 'An entry with this name is being added.'
  })
  await flush()
  assert.equal(firstSettled, false, 'another request error must not settle the first add')

  reply(harness, firstRequest, { key: 'same-name' })
  const results = await outcomes
  assert.equal(results[0].status, 'fulfilled')
  assert.equal(results[1].status, 'rejected')
  assert.match(results[1].reason.message, /being added/)
  harness.assertIdle()
})

test('mutation requests trim names and ignore unrelated reply IDs and types', async (t) => {
  const harness = await setup(t)
  const addition = harness.service.addEntry('  dummy-note  ', 'value stays untrimmed  ')
  await flush()
  const add = harness.requests[0]
  assert.equal(add.type, 'entries:add')
  assert.equal(add.key, 'dummy-note')
  assert.equal(add.value, 'value stays untrimmed  ')

  let settled = false
  void addition.then(() => {
    settled = true
  })
  harness.emit({ type: 'entries:add:error', error: 'Uncorrelated error' })
  harness.emit({ type: 'entries:add:result', requestId: 'different', key: add.key })
  harness.emit({ type: 'entries:remove:result', requestId: add.requestId, key: add.key })
  await flush()
  assert.equal(settled, false)

  reply(harness, add, { key: add.key })
  await addition
  harness.assertIdle()

  const removal = harness.service.removeEntry('  dummy-note  ')
  await flush()
  const remove = harness.requests[1]
  assert.equal(remove.type, 'entries:remove')
  assert.equal(remove.key, 'dummy-note')
  reply(harness, remove, { key: remove.key })
  await removal
  harness.assertIdle()
})

test('listing ignores raw updater messages and returns validated entries', async (t) => {
  const harness = await setup(t)
  const pending = harness.service.listEntries()
  await flush()
  const request = harness.requests[0]
  assert.equal(request.type, 'entries:list')
  harness.emit('updating')
  harness.emit('{invalid JSON')
  harness.emit(null)
  const entries = [
    { key: 'dummy-note', value: 'dummy value' },
    { key: 'empty', value: null }
  ]
  reply(harness, request, { entries })
  assert.deepEqual(await pending, entries)
  harness.assertIdle()
})

test('listing rejects invalid collections and malformed entry records', async (t) => {
  const harness = await setup(t)
  for (const entries of [null, {}, [{ key: 42, value: 'dummy' }], [{ key: 'missing-value' }]]) {
    const pending = harness.service.listEntries()
    const rejected = assert.rejects(pending, /invalid|response/i)
    await flush()
    reply(harness, harness.requests.at(-1), { entries })
    await rejected
    harness.assertIdle()
  }
})

test('a timed out request removes its listeners and ignores late replies', async (t) => {
  const harness = await setup(t)
  const pending = harness.service.removeEntry('dummy-note')
  const rejected = assert.rejects(pending, /respond|time|refresh/i)
  await flush()
  harness.runTimeouts()
  await rejected
  harness.assertIdle()
  reply(harness, harness.requests[0], { key: 'dummy-note' })
  harness.assertIdle()
})

test('aborting a list request removes listeners and timers', async (t) => {
  const harness = await setup(t)
  const controller = new AbortController()
  const pending = harness.service.listEntries(controller.signal)
  const rejected = assert.rejects(pending, /abort|cancel/i)
  await flush()
  assert.equal(harness.requests.length, 1)
  controller.abort()
  await rejected
  harness.assertIdle()
})

test('an already aborted list request never reaches the worker', async (t) => {
  const harness = await setup(t)
  await assert.rejects(harness.service.listEntries(AbortSignal.abort()), /abort|cancel/i)
  await flush()
  assert.equal(harness.requests.length, 0)
  harness.assertIdle()
})

test('worker exit rejects outstanding requests and cleans every listener', async (t) => {
  const harness = await setup(t)
  const outcomes = Promise.allSettled([
    harness.service.listEntries(),
    harness.service.addEntry('dummy-note', 'dummy value')
  ])
  await flush()
  harness.exit()
  const results = await outcomes
  for (const result of results) {
    assert.equal(result.status, 'rejected')
    assert.match(result.reason.message, /worker|stopped|exit/i)
  }
  harness.assertIdle()
})

test('worker startup and IPC write failures clean request resources', async (t) => {
  for (const failure of ['startError', 'writeError']) {
    await t.test(failure, async (subtest) => {
      const harness = await setup(subtest, { [failure]: new Error(`dummy ${failure}`) })
      await assert.rejects(harness.service.listEntries(), new RegExp(failure))
      harness.assertIdle()
    })
  }
})

test('watchEntries refreshes on change notifications without a mutation callback', async (t) => {
  const harness = await setup(t)
  const snapshots = []
  const errors = []
  const stop = harness.service.watchEntries(
    (entries) => snapshots.push(entries),
    (error) => errors.push(error)
  )
  await flush()
  assert.equal(harness.requests.length, 1)
  reply(harness, harness.requests[0], { entries: [] })
  await flush()
  assert.deepEqual(snapshots, [[]])

  harness.emit({ type: 'entries:changed' })
  await flush()
  assert.equal(harness.requests.length, 2)
  const entries = [{ key: 'external-change', value: 'dummy value' }]
  reply(harness, harness.requests[1], { entries })
  await flush()
  assert.deepEqual(snapshots, [[], entries])
  assert.deepEqual(errors, [])
  stop()
  await flush()
  harness.assertIdle()
})

test('watchEntries coalesces changes and discards a superseded snapshot', async (t) => {
  const harness = await setup(t)
  const snapshots = []
  const errors = []
  const stop = harness.service.watchEntries(
    (entries) => snapshots.push(entries),
    (error) => errors.push(error)
  )
  await flush()
  harness.emit({ type: 'entries:changed' })
  harness.emit({ type: 'entries:changed' })
  harness.emit({ type: 'entries:changed' })
  await flush()
  assert.equal(harness.requests.length, 1, 'only one list may be in flight')

  reply(harness, harness.requests[0], { entries: [{ key: 'old', value: null }] })
  await flush()
  assert.deepEqual(snapshots, [], 'an invalidated snapshot must not reach the UI')
  assert.equal(harness.requests.length, 2, 'changes require one follow-up list')

  const latest = [{ key: 'latest', value: null }]
  reply(harness, harness.requests[1], { entries: latest })
  await flush()
  assert.deepEqual(snapshots, [latest])
  assert.deepEqual(errors, [])
  stop()
  await flush()
  harness.assertIdle()
})

test('watchEntries unsubscribe aborts an in-flight list and ignores subsequent events', async (t) => {
  const harness = await setup(t)
  const snapshots = []
  const errors = []
  const stop = harness.service.watchEntries(
    (entries) => snapshots.push(entries),
    (error) => errors.push(error)
  )
  await flush()
  assert.equal(harness.requests.length, 1)
  stop()
  stop()
  await flush()
  harness.assertIdle()
  harness.emit({ type: 'entries:changed' })
  reply(harness, harness.requests[0], { entries: [] })
  harness.exit()
  await flush()
  assert.equal(harness.requests.length, 1)
  assert.deepEqual(snapshots, [])
  assert.deepEqual(errors, [])
  harness.assertIdle()
})

test('watchEntries reports worker exit after its initial list has finished', async (t) => {
  const harness = await setup(t)
  const errors = []
  const stop = harness.service.watchEntries(
    () => {},
    (error) => errors.push(error)
  )
  await flush()
  reply(harness, harness.requests[0], { entries: [] })
  await flush()
  harness.exit()
  await flush()
  assert.equal(errors.length, 1)
  assert.match(errors[0].message, /worker|stopped|exit/i)
  stop()
  harness.assertIdle()
})

test('watchEntries reports a failed list once and cleans request resources', async (t) => {
  const harness = await setup(t)
  const errors = []
  const stop = harness.service.watchEntries(
    () => {},
    (error) => errors.push(error)
  )
  await flush()
  harness.emit({
    type: 'entries:list:error',
    requestId: harness.requests[0].requestId,
    error: 'dummy list failure'
  })
  await flush()
  assert.equal(errors.length, 1)
  assert.match(errors[0].message, /dummy list failure/)
  stop()
  harness.assertIdle()
})
