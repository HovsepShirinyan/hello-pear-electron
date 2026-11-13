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

async function exercise(phase) {
  const worker = '/workers/main.js'
  const check = (condition, label) => {
    if (!condition) throw new Error(label)
  }
  async function waitFor(predicate, label) {
    const until = Date.now() + 8000
    while (!predicate()) {
      if (Date.now() > until) throw new Error('UI timed out: ' + label)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  const hasEntry = (key) =>
    [...document.querySelectorAll('#entries-list button[data-entry-key]')].some(
      (node) => node.getAttribute('data-entry-key') === key && node.textContent.includes(key)
    )
  const empty = () => document.querySelector('#root')?.textContent.includes('No entries yet.')
  const countIs = (text) => document.querySelector('#entry-count')?.textContent.trim() === text
  const unselected = () =>
    document.querySelector('#root')?.textContent.includes('Select an entry to view its details.') &&
    !document.querySelector('#entry-detail-name')
  function click(label, attribute = 'textContent') {
    const button = [...document.querySelectorAll('#root button')].find((node) =>
      attribute === 'textContent'
        ? node.textContent.trim() === label
        : node.getAttribute(attribute) === label
    )
    check(button && !button.disabled, 'Expected an enabled button: ' + label)
    button.click()
  }
  async function input(selector, text) {
    const node = document.querySelector(selector)
    const prototype =
      node.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, text)
    node.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  async function submit(key, value) {
    await input('#entry-name', key)
    await input('#entry-value', value)
    document.querySelector('#root form').requestSubmit()
  }
  function remove(key) {
    click('Remove ' + key, 'aria-label')
  }
  async function selectHidden(key, value) {
    click('View ' + key, 'aria-label')
    await waitFor(
      () =>
        document.querySelector('#entry-detail-name')?.textContent === key &&
        document.querySelector('#entry-detail-value')?.textContent === 'Value hidden.',
      'selected value hidden by default'
    )
    check(
      !document.querySelector('#entry-details').innerHTML.includes(value),
      'Hidden value in DOM'
    )
  }
  async function clearSearch(expectedCount) {
    click('Clear search')
    await waitFor(
      () =>
        document.querySelector('#entry-search').value === '' &&
        document.activeElement === document.querySelector('#entry-search') &&
        countIs(expectedCount),
      'clear search, count, and input focus'
    )
  }
  function rawRequest(request, operation) {
    return new Promise((resolve, reject) => {
      let offIPC = () => {}
      let offExit = () => {}
      const timeout = setTimeout(() => finish(new Error('Raw IPC timed out')), 8000)
      function finish(error, message) {
        clearTimeout(timeout)
        offIPC()
        offExit()
        if (error) reject(error)
        else resolve(message)
      }
      offIPC = window.bridge.onWorkerIPC(worker, (data) => {
        let message
        try {
          message = JSON.parse(new TextDecoder().decode(data))
        } catch {
          return
        }
        if (message.requestId !== undefined) return
        if (message.type === operation + ':result') finish(null, message)
        if (message.type === operation + ':error') finish(new Error(message.error))
      })
      offExit = window.bridge.onWorkerExit(worker, () => finish(new Error('Worker stopped')))
      window.bridge
        .writeWorkerIPC(worker, typeof request === 'string' ? request : JSON.stringify(request))
        .catch((error) => finish(error))
    })
  }
  if (phase === 'create') {
    await waitFor(empty, 'initial empty list')
    check(countIs('0 entries'), 'Empty count')
    await submit(' ui-note ', 'first-fixture-value')
    await waitFor(
      () =>
        hasEntry('ui-note') &&
        document.querySelector('form [role="status"]')?.textContent === 'Entry added.',
      'form creation and success message'
    )
    await submit('ui-note', 'must-not-overwrite')
    await waitFor(
      () => document.querySelector('form [role="alert"]')?.textContent.includes('already exists'),
      'duplicate rejection'
    )
    const listed = await rawRequest('entries:list', 'entries:list')
    check(listed.entries.length === 1, 'Duplicate must not add another entry')
    check(
      listed.entries[0].value === 'first-fixture-value',
      'Duplicate must preserve the first value'
    )
    check(countIs('1 entry'), 'Singular entry count')
    await selectHidden('ui-note', 'first-fixture-value')
    click('Reveal value')
    await waitFor(
      () => document.querySelector('#entry-detail-value')?.textContent === 'first-fixture-value',
      'revealed value'
    )
    click('Hide value')
    await waitFor(
      () => document.querySelector('#entry-detail-value')?.textContent === 'Value hidden.',
      'hidden value after reveal'
    )
    check(
      !document.querySelector('#entry-details').innerHTML.includes('first-fixture-value'),
      'Hiding must remove the value from the DOM'
    )
    click('Reveal value')
    await rawRequest(
      { type: 'entries:add', key: 'Beta-Note', value: 'second-fixture-value' },
      'entries:add'
    )
    await waitFor(() => hasEntry('Beta-Note') && countIs('2 entries'), 'second entry and count')
    await selectHidden('Beta-Note', 'second-fixture-value')
    check(
      !document.querySelector('#entry-details').innerHTML.includes('first-fixture-value'),
      'Switching entries must discard the previously revealed value'
    )
    click('Close entry details', 'aria-label')
    await waitFor(unselected, 'close details')
    await selectHidden('ui-note', 'first-fixture-value')
    check(document.querySelector('#entry-search').type === 'search', 'Search input type')
    await input('#entry-search', '  UI-NOTE  ')
    await waitFor(
      () =>
        hasEntry('ui-note') &&
        !hasEntry('Beta-Note') &&
        countIs('1 matching entry (2 total)') &&
        unselected(),
      'trimmed case-insensitive search clears selection'
    )
    await input('#entry-search', 'missing-entry')
    await waitFor(
      () =>
        countIs('0 matching entries (2 total)') &&
        document.querySelectorAll('#entries-list button[data-entry-key]').length === 0,
      'no matching entries'
    )
    await clearSearch('2 entries')
    await input('#entry-search', ' LIVE ')
    await waitFor(() => countIs('0 matching entries (2 total)'), 'empty live filter')
    for (const [key, expected] of [
      ['live-first', '1 matching entry (3 total)'],
      ['LIVE-second', '2 matching entries (4 total)']
    ]) {
      await rawRequest({ type: 'entries:add', key, value: 'live-fixture-value' }, 'entries:add')
      await waitFor(() => hasEntry(key) && countIs(expected), 'filtered live addition and count')
    }
    for (const [key, expected] of [
      ['live-first', '1 matching entry (3 total)'],
      ['LIVE-second', '0 matching entries (2 total)']
    ]) {
      await rawRequest({ type: 'entries:remove', key }, 'entries:remove')
      await waitFor(() => !hasEntry(key) && countIs(expected), 'filtered live removal and count')
    }
    await clearSearch('2 entries')
    await selectHidden('Beta-Note', 'second-fixture-value')
    await rawRequest({ type: 'entries:remove', key: 'Beta-Note' }, 'entries:remove')
    await waitFor(
      () => unselected() && countIs('1 entry'),
      'deleting selected entry clears details'
    )
    await rawRequest(
      { type: 'entries:add', key: 'Beta-Note', value: 'replacement-fixture-value' },
      'entries:add'
    )
    await waitFor(
      () => hasEntry('Beta-Note') && countIs('2 entries') && unselected(),
      'readding the same key does not reselect it'
    )
    await rawRequest({ type: 'entries:remove', key: 'Beta-Note' }, 'entries:remove')
    await waitFor(() => !hasEntry('Beta-Note') && countIs('1 entry'), 'second entry cleanup')
    remove('ui-note')
    await waitFor(empty, 'form entry removal')
    await rawRequest(
      { type: 'entries:add', key: 'external-note', value: 'fixture-only' },
      'entries:add'
    )
    await waitFor(() => hasEntry('external-note'), 'worker-driven entry appearance')
    await rawRequest({ type: 'entries:remove', key: 'external-note' }, 'entries:remove')
    await waitFor(empty, 'worker-driven entry disappearance')
    await submit('persisted-note', 'persisted-fixture-value')
    await waitFor(() => hasEntry('persisted-note'), 'entry saved for restart')
  } else {
    await waitFor(() => hasEntry('persisted-note'), 'entry persists after application restart')
    const listed = await rawRequest('entries:list', 'entries:list')
    check(listed.entries.length === 1, 'Only the persisted entry should remain')
    check(
      listed.entries[0].value === 'persisted-fixture-value',
      'Persisted value must survive restart'
    )
    remove('persisted-note')
    await waitFor(empty, 'persisted entry removal')
  }
}

function runElectron() {
  const { app } = require('electron')
  // Tests must not replace the user's OS protocol handler.
  app.setAsDefaultProtocolClient = () => false
  const phase = process.env.TEST_PHASE
  const workers = new Set()
  const Runtime = require(path.join(packagedApp, 'node_modules', 'pear-runtime'))
  const originalRun = Runtime.run
  Runtime.run = function (...args) {
    const worker = originalRun.apply(this, args)
    workers.add(worker)
    worker.once('exit', () => workers.delete(worker))
    return worker
  }
  let finished = false
  let failed = false
  const timeout = setTimeout(() => finish(new Error('Electron test timed out')), 45000)
  function finish(error) {
    if (finished) return
    finished = true
    failed = !!error
    clearTimeout(timeout)
    if (error) console.error(`DESKTOP_SMOKE_FAIL:${phase}: ${error.message}`)
    else console.log(`DESKTOP_SMOKE_PASS:${phase}`)
    app.quit()
  }
  app.once('will-quit', (event) => {
    event.preventDefault()
    const pending = [...workers].map(
      (worker) => new Promise((resolve) => worker.once('exit', resolve))
    )
    const force = setTimeout(() => {
      for (const worker of workers) worker.kill('SIGKILL')
    }, 1500)
    Promise.all(pending).finally(() => {
      clearTimeout(force)
      app.exit(failed || !finished ? 1 : 0)
    })
  })
  process.on('uncaughtException', finish)
  process.on('unhandledRejection', finish)
  app.on('browser-window-created', (event, win) => {
    win.hide()
    win.webContents.once('did-fail-load', () => finish(new Error('Renderer failed to load')))
    win.webContents.once('render-process-gone', () => finish(new Error('Renderer process stopped')))
    win.webContents.once('did-finish-load', async () => {
      try {
        await win.webContents.executeJavaScript(
          `(${exercise.toString()})(${JSON.stringify(phase)})`
        )
        finish()
      } catch (error) {
        finish(error)
      }
    })
  })
  require(path.join(packagedApp, 'electron', 'main.js'))
}

async function runParent() {
  const { spawn } = require('node:child_process')
  const electron = require('electron')
  const storage = fs.mkdtempSync(path.join(root, 'out', 'desktop-smoke-'))
  for (const phase of ['create', 'restart']) {
    const env = { ...process.env, TEST_PHASE: phase, ELECTRON_ENABLE_LOGGING: '1' }
    delete env.PEAR_DEV_SERVER_URL
    delete env.ELECTRON_RUN_AS_NODE
    await new Promise((resolve, reject) => {
      const child = spawn(electron, [__filename, '--storage', storage, '--no-updates'], {
        env,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let output = ''
      let timedOut = false
      const capture = (data) => {
        output = (output + data.toString()).slice(-32000)
      }
      child.stdout.on('data', capture)
      child.stderr.on('data', capture)
      const timeout = setTimeout(() => {
        timedOut = true
        if (process.platform === 'win32') {
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore'
          })
        } else {
          process.kill(-child.pid, 'SIGKILL')
        }
      }, 49000)
      child.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      child.once('close', (code) => {
        clearTimeout(timeout)
        if (timedOut || code !== 0 || !output.includes(`DESKTOP_SMOKE_PASS:${phase}`)) {
          reject(new Error(`Electron ${phase} failed (exit ${code}).\n${output}`))
        } else if (
          [
            'first-fixture-value',
            'must-not-overwrite',
            'fixture-only',
            'second-fixture-value',
            'live-fixture-value',
            'replacement-fixture-value',
            'persisted-fixture-value'
          ].some((value) => output.includes(value))
        ) {
          reject(new Error('Stored entry values appeared in application console output.'))
        } else {
          console.log(
            `PASS: desktop ${phase === 'create' ? 'CRUD, search, masked details, and live refresh' : 'restart persistence'}`
          )
          resolve()
        }
      })
    })
  }
}

if (process.versions.electron) runElectron()
else {
  runParent().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
