import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import AddEntryForm from './AddEntryForm'
import { addEntry, removeEntry, watchEntries, type Entry } from './autopass'

type State =
  | { status: 'loading' }
  | { status: 'ready'; entries: Entry[] }
  | { status: 'error'; message: string }

function App() {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [removingKey, setRemovingKey] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)

  useEffect(() => {
    return watchEntries(
      (entries) => setState({ status: 'ready', entries }),
      (error) => setState({ status: 'error', message: error.message })
    )
  }, [])

  async function handleRemove(key: string) {
    if (removingKey !== null) return
    setRemovingKey(key)
    setRemoveError(null)
    try {
      await removeEntry(key)
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : 'Could not remove entry.')
    } finally {
      setRemovingKey(null)
    }
  }

  return (
    <main aria-busy={state.status === 'loading'}>
      <h2>Autopass</h2>
      {removeError && <p role='alert'>{removeError}</p>}
      {state.status === 'ready' && <AddEntryForm onAdd={addEntry} />}
      {state.status === 'loading' && <p role='status'>Loading entries…</p>}
      {state.status === 'error' && <p role='alert'>{state.message}</p>}

      {state.status === 'ready' &&
        (state.entries.length === 0 ? (
          <p>No entries yet.</p>
        ) : (
          <ul>
            {state.entries.map((entry) => (
              <li key={entry.key}>
                <span>{entry.key}</span>{' '}
                <button
                  type='button'
                  disabled={removingKey !== null}
                  aria-label={'Remove ' + entry.key}
                  onClick={() => void handleRemove(entry.key)}
                >
                  {removingKey === entry.key ? 'Removing…' : 'Remove'}
                </button>
              </li>
            ))}
          </ul>
        ))}
    </main>
  )
}

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('React root not found')
createRoot(rootElement).render(<App />)
