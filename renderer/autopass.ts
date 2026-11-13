export type Entry = {
  key: string
  value: string | null
}

type EntryRequest =
  | { type: 'entries:list' }
  | { type: 'entries:add'; key: string; value: string }
  | { type: 'entries:remove'; key: string }

const worker = '/workers/main.js'
const decoder = new TextDecoder()

function decodeMessage(data: Uint8Array): Record<string, unknown> | null {
  try {
    const message: unknown = JSON.parse(decoder.decode(data))
    return typeof message === 'object' && message !== null && !Array.isArray(message)
      ? (message as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error('The worker request failed.')
}

function sendEntryRequest(
  request: EntryRequest,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Request cancelled.', 'AbortError'))
      return
    }

    const bridge = window.bridge
    if (!bridge) {
      reject(new Error('Open the desktop application to access entries.'))
      return
    }

    const requestId = crypto.randomUUID()
    let settled = false
    let offIPC = () => {}
    let offExit = () => {}

    const timeout = window.setTimeout(() => {
      finish(new Error('The worker did not respond. Refresh before retrying.'))
    }, 10000)

    function onAbort() {
      finish(new DOMException('Request cancelled.', 'AbortError'))
    }

    function finish(error: Error | null, response: Record<string, unknown> = {}) {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      offIPC()
      offExit()
      signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve(response)
    }

    signal?.addEventListener('abort', onAbort, { once: true })

    try {
      offIPC = bridge.onWorkerIPC(worker, (data) => {
        const message = decodeMessage(data)
        if (!message || message.requestId !== requestId) return

        if (message.type === request.type + ':result') {
          if ('key' in request && message.key !== request.key) {
            finish(new Error('Invalid entry response.'))
          } else {
            finish(null, message)
          }
        } else if (message.type === request.type + ':error') {
          finish(
            new Error(typeof message.error === 'string' ? message.error : 'The request failed.')
          )
        }
      })

      offExit = bridge.onWorkerExit(worker, () => finish(new Error('The worker stopped.')))

      bridge
        .startWorker(worker)
        .then(() => {
          if (settled) return
          return bridge.writeWorkerIPC(worker, JSON.stringify({ ...request, requestId }))
        })
        .catch((err: unknown) => finish(toError(err)))
    } catch (err) {
      finish(toError(err))
    }
  })
}

function isEntry(value: unknown): value is Entry {
  return (
    typeof value === 'object' &&
    value !== null &&
    'key' in value &&
    typeof value.key === 'string' &&
    'value' in value &&
    (typeof value.value === 'string' || value.value === null)
  )
}

export async function listEntries(signal?: AbortSignal): Promise<Entry[]> {
  const response = await sendEntryRequest({ type: 'entries:list' }, signal)
  if (!Array.isArray(response.entries) || !response.entries.every(isEntry)) {
    throw new Error('Invalid entries response.')
  }
  return response.entries
}

export async function addEntry(key: string, value: string): Promise<void> {
  await sendEntryRequest({ type: 'entries:add', key: key.trim(), value })
}

export async function removeEntry(key: string): Promise<void> {
  await sendEntryRequest({ type: 'entries:remove', key: key.trim() })
}

export function watchEntries(
  onEntries: (entries: Entry[]) => void,
  onError: (error: Error) => void
): () => void {
  const bridge = window.bridge
  if (!bridge) {
    onError(new Error('Open the desktop application to access entries.'))
    return () => {}
  }

  const controller = new AbortController()
  let active = true
  let refreshing = false
  let dirty = false

  async function refresh() {
    if (!active) return
    if (refreshing) {
      dirty = true
      return
    }

    refreshing = true
    do {
      dirty = false
      try {
        const entries = await listEntries(controller.signal)
        if (active && !dirty) onEntries(entries)
      } catch (err) {
        if (active && !dirty) onError(toError(err))
      }
    } while (active && dirty)
    refreshing = false
  }

  const offIPC = bridge.onWorkerIPC(worker, (data) => {
    if (decodeMessage(data)?.type === 'entries:changed') void refresh()
  })
  const offExit = bridge.onWorkerExit(worker, () => {
    if (active && !refreshing) onError(new Error('The worker stopped.'))
  })
  void refresh()

  return () => {
    active = false
    controller.abort()
    offIPC()
    offExit()
  }
}
