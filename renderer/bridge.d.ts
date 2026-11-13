type WorkerDataListener = (data: Uint8Array) => void
type Unsubscribe = () => void

interface PearBridge {
  pkg(): {
    name: string
    productName?: string
    version: string
  }

  startWorker(specifier: string): Promise<boolean>
  writeWorkerIPC(specifier: string, data: string): Promise<boolean>

  onWorkerIPC(specifier: string, listener: WorkerDataListener): Unsubscribe
  onWorkerStdout(specifier: string, listener: WorkerDataListener): Unsubscribe
  onWorkerStderr(specifier: string, listener: WorkerDataListener): Unsubscribe
  onWorkerExit(specifier: string, listener: (code: number | null) => void): Unsubscribe

  applyUpdate(): Promise<void>
  appAfterUpdate(): Promise<void>
}

declare global {
  interface Window {
    bridge: PearBridge
  }
}

export {}
