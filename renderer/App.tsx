import { useEffect, useRef, useState } from 'react'
import AddEntryForm from './AddEntryForm'
import EntryDetails from './EntryDetails'
import { addEntry, removeEntry, watchEntries, type Entry } from './autopass'

type State =
  | { status: 'loading' }
  | { status: 'ready'; entries: Entry[] }
  | { status: 'error'; message: string }

export default function App() {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [removingKey, setRemovingKey] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const entryButtons = useRef(new Map<string, HTMLButtonElement>())

  useEffect(() => {
    return watchEntries(
      (entries) => {
        setState({ status: 'ready', entries })
        setSelectedKey((key) =>
          key !== null && entries.some((entry) => entry.key === key) ? key : null
        )
      },
      (error) => setState({ status: 'error', message: error.message })
    )
  }, [])

  const entries = state.status === 'ready' ? state.entries : []
  const searchTerm = query.trim().toLowerCase()
  const visibleEntries = entries.filter((entry) => entry.key.toLowerCase().includes(searchTerm))
  const selectedEntry = entries.find((entry) => entry.key === selectedKey) ?? null
  const count = searchTerm
    ? visibleEntries.length +
      ' matching ' +
      (visibleEntries.length === 1 ? 'entry' : 'entries') +
      ' (' +
      entries.length +
      ' total)'
    : entries.length + (entries.length === 1 ? ' entry' : ' entries')

  function changeQuery(value: string) {
    setQuery(value)
    setSelectedKey(null)
  }

  function clearSearch() {
    changeQuery('')
    searchInput.current?.focus()
  }

  function closeDetails() {
    if (selectedKey !== null) entryButtons.current.get(selectedKey)?.focus()
    setSelectedKey(null)
  }

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
      {state.status === 'loading' && <p role='status'>Loading entries…</p>}
      {state.status === 'error' && <p role='alert'>{state.message}</p>}

      {state.status === 'ready' && (
        <>
          <AddEntryForm onAdd={addEntry} />

          <section aria-labelledby='entries-title'>
            <h3 id='entries-title'>Your entries</h3>
            <div role='search' aria-label='Find entries'>
              <label htmlFor='entry-search'>Search entries</label>
              <input
                ref={searchInput}
                id='entry-search'
                type='search'
                autoComplete='off'
                value={query}
                onChange={(event) => changeQuery(event.target.value)}
                aria-controls='entries-list'
                aria-describedby='entry-count'
              />
              <button type='button' disabled={query.length === 0} onClick={clearSearch}>
                Clear search
              </button>
            </div>

            <p id='entry-count' role='status' aria-live='polite' aria-atomic='true'>
              {count}
            </p>

            {entries.length === 0 ? (
              <p>No entries yet.</p>
            ) : visibleEntries.length === 0 ? (
              <p>No matching entries.</p>
            ) : null}

            <ul id='entries-list' hidden={visibleEntries.length === 0}>
              {visibleEntries.map((entry) => (
                <li key={entry.key}>
                  <button
                    ref={(button) => {
                      if (button) entryButtons.current.set(entry.key, button)
                      else entryButtons.current.delete(entry.key)
                    }}
                    type='button'
                    data-entry-key={entry.key}
                    aria-label={'View ' + entry.key}
                    aria-pressed={selectedEntry?.key === entry.key}
                    aria-controls='entry-details'
                    onClick={() => setSelectedKey(entry.key)}
                  >
                    <span>{entry.key}</span>
                  </button>{' '}
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
          </section>

          {selectedEntry ? (
            <EntryDetails key={selectedEntry.key} entry={selectedEntry} onClose={closeDetails} />
          ) : (
            <section id='entry-details' aria-labelledby='entry-details-title'>
              <h3 id='entry-details-title'>Entry details</h3>
              <p>Select an entry to view its details.</p>
            </section>
          )}
        </>
      )}
    </main>
  )
}
