const { contextBridge, ipcRenderer } = require('electron')

function toBytes(data) {
  if (data === null || data === undefined || typeof data === 'number') return data
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

contextBridge.exposeInMainWorld('bridge', {
  pkg() {
    return ipcRenderer.sendSync('pkg')
  },
  applyUpdate: () => ipcRenderer.invoke('pear:applyUpdate'),
  appAfterUpdate: () => ipcRenderer.invoke('app:afterUpdate'),
  startWorker: (specifier) => ipcRenderer.invoke('pear:startWorker', specifier),
  onWorkerStdout: (specifier, listener) => {
    const wrap = (evt, data) => listener(toBytes(data))
    ipcRenderer.on('pear:worker:stdout:' + specifier, wrap)
    return () => ipcRenderer.removeListener('pear:worker:stdout:' + specifier, wrap)
  },
  onWorkerStderr: (specifier, listener) => {
    const wrap = (evt, data) => listener(toBytes(data))
    ipcRenderer.on('pear:worker:stderr:' + specifier, wrap)
    return () => ipcRenderer.removeListener('pear:worker:stderr:' + specifier, wrap)
  },
  onWorkerIPC: (specifier, listener) => {
    const wrap = (evt, data) => listener(toBytes(data))
    ipcRenderer.on('pear:worker:ipc:' + specifier, wrap)
    return () => ipcRenderer.removeListener('pear:worker:ipc:' + specifier, wrap)
  },
  onWorkerExit: (specifier, listener) => {
    const wrap = (evt, code) => listener(code)
    ipcRenderer.on('pear:worker:exit:' + specifier, wrap)
    return () => ipcRenderer.removeListener('pear:worker:exit:' + specifier, wrap)
  },
  writeWorkerIPC: (specifier, data) => {
    return ipcRenderer.invoke('pear:worker:writeIPC:' + specifier, data)
  }
})
