const bridge = window.bridge
const decoder = new TextDecoder('utf-8')

document.getElementById('v').innerText += bridge.pkg().version

let updateReady = false
let applyingUpdate = false
let updateFailed = false
let updateApplied = false

function showUpdateFailure(error) {
  updateFailed = true
  const reason = error instanceof Error ? error.message : 'The update could not be applied.'
  const restart = 'Restart the app before trying again.'
  document.getElementById('v').innerText =
    'Update failed: ' + reason + (reason.endsWith(restart) ? '' : ' ' + restart)
  const btn = document.getElementById('update-btn')
  btn.disabled = true
  btn.innerText = 'Restart app to retry'
  btn.style.display = 'inline-block'
}

function showUpdateReady() {
  if (applyingUpdate || updateFailed || updateApplied) return
  updateReady = true
  document.getElementById('v').innerText = 'Update ready!'
  const btn = document.getElementById('update-btn')
  btn.style.display = 'inline-block'
  btn.disabled = false
  btn.innerText = 'Apply update'
  btn.onclick = async () => {
    if (applyingUpdate || updateFailed || updateApplied) return
    applyingUpdate = true
    btn.disabled = true
    btn.innerText = 'Updating...'
    try {
      await bridge.applyUpdate()
      updateApplied = true
      updateReady = false
      await bridge.appAfterUpdate()
    } catch (err) {
      showUpdateFailure(err)
    } finally {
      applyingUpdate = false
    }
  }
}

function onWorkerUpdaterEvent(name) {
  if (updateFailed || applyingUpdate || updateApplied) return
  if (name === 'updating') {
    document.getElementById('v').innerText = 'UPDATING...'
    return
  }
  if (name === 'updated') showUpdateReady()
}

const workers = {
  main: '/workers/main.js'
}

bridge.startWorker(workers.main)
let sentHello = false

const offWorkerStdout = bridge.onWorkerStdout(workers.main, (data) => {
  console.log('worker stdout', '[', workers.main, ']:', decoder.decode(data))
})

const offWorkerStderr = bridge.onWorkerStderr(workers.main, (data) => {
  console.error('worker stderr', '[', workers.main, ']:', decoder.decode(data))
})

const offWorkerIpc = bridge.onWorkerIPC(workers.main, (data) => {
  const message = decoder.decode(data)
  let label
  try {
    const parsed = JSON.parse(message)
    label = typeof parsed?.type === 'string' ? parsed.type : 'JSON message'
  } catch {
    label = message.startsWith('unknown-message ') ? 'unknown-message' : message
  }
  console.log('worker ipc', '[', workers.main, ']:', label)
  onWorkerUpdaterEvent(message)

  if (!sentHello) {
    sentHello = true
    bridge.writeWorkerIPC(workers.main, 'Hello from renderer')
  }
})

const offWorkerExit = bridge.onWorkerExit(workers.main, (code) => {
  console.log('Worker exited with code', code)
  if (!updateApplied && (updateReady || applyingUpdate)) {
    showUpdateFailure(new Error('The update worker stopped.'))
  }
  offWorkerStdout()
  offWorkerStderr()
  offWorkerIpc()
  offWorkerExit()
})
