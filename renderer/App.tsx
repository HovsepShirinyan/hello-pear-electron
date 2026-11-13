import { useEffect, useRef, useState } from 'react'
import AddEntryForm from './AddEntryForm'
import EntryDetails from './EntryDetails'
import styles from './App.module.css'
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
    <main className={styles.app} aria-busy={state.status === 'loading'}>
      <aside className={styles.sidebar} aria-label='Entry navigation'>
        <header className={styles.brand}>
          <span className={styles.brandMark} aria-hidden='true'>
            A
          </span>
          <div>
            <h1>Autopass</h1>
            <p>Your entry workspace</p>
          </div>
        </header>

        <section className={styles.entries} aria-labelledby='entries-title'>
          <div className={styles.sectionHeading}>
            <h2 id='entries-title'>Your entries</h2>
            <span className={styles.sectionTag}>All</span>
          </div>
          <div className={styles.searchBox} role='search' aria-label='Find entries'>
            <svg
              className={styles.searchIcon}
              aria-hidden='true'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='1.6'
            >
              <circle cx='10.5' cy='10.5' r='6.5' />
              <path d='m16 16 4.5 4.5' strokeLinecap='round' />
            </svg>
            <label className={styles.srOnly} htmlFor='entry-search'>
              Search entries
            </label>
            <input
              ref={searchInput}
              id='entry-search'
              type='search'
              autoComplete='off'
              placeholder='Search entries…'
              value={query}
              disabled={state.status !== 'ready'}
              onChange={(event) => changeQuery(event.target.value)}
              aria-controls='entries-list'
              aria-describedby='entry-count'
            />
            <button
              className={styles.clearButton}
              type='button'
              disabled={query.length === 0 || state.status !== 'ready'}
              onClick={clearSearch}
            >
              Clear search
            </button>
          </div>

          <p
            className={styles.count}
            id='entry-count'
            role='status'
            aria-live='polite'
            aria-atomic='true'
          >
            {state.status === 'ready'
              ? count
              : state.status === 'error'
                ? 'Entries unavailable.'
                : 'Opening your workspace…'}
          </p>

          {state.status === 'ready' && entries.length === 0 ? (
            <div className={styles.emptyList}>
              <span className={styles.emptyListIcon} aria-hidden='true'>
                ◇
              </span>
              <p>No entries yet.</p>
              <span>Add your first entry to get started.</span>
            </div>
          ) : state.status === 'ready' && visibleEntries.length === 0 ? (
            <div className={styles.emptyList}>
              <span className={styles.emptyListIcon} aria-hidden='true'>
                ⌕
              </span>
              <p>No matching entries.</p>
              <span>Try another name or clear your search.</span>
            </div>
          ) : null}

          <ul className={styles.entryList} id='entries-list' hidden={visibleEntries.length === 0}>
            {visibleEntries.map((entry) => (
              <li className={styles.entryRow} key={entry.key}>
                <button
                  className={styles.entryButton}
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
                  <span className={styles.entryIcon} aria-hidden='true'>
                    <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.6'>
                      <rect x='5' y='3.5' width='14' height='17' rx='3' />
                      <path d='M9 8h6M9 12h6M9 16h3' strokeLinecap='round' />
                    </svg>
                  </span>
                  <span className={styles.entryCopy}>
                    <span className={styles.entryName} title={entry.key}>
                      {entry.key}
                    </span>
                    <span className={styles.entryHint}>
                      {selectedEntry?.key === entry.key ? 'Selected entry' : 'Open details'}
                    </span>
                  </span>
                </button>
                <button
                  className={styles.removeButton}
                  type='button'
                  disabled={removingKey !== null}
                  aria-label={'Remove ' + entry.key}
                  title={removingKey === entry.key ? 'Removing…' : 'Remove entry'}
                  onClick={() => void handleRemove(entry.key)}
                >
                  <svg
                    aria-hidden='true'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    strokeWidth='1.6'
                  >
                    <path
                      d='M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v6M14 10v6'
                      strokeLinecap='round'
                      strokeLinejoin='round'
                    />
                  </svg>
                  <span className={styles.srOnly}>
                    {removingKey === entry.key ? 'Removing…' : 'Remove'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <footer className={styles.sidebarFooter}>
          <span aria-hidden='true'>◇</span>A little space for everything you keep.
        </footer>
      </aside>

      <div className={styles.workspace}>
        <header className={styles.workspaceHeader}>
          <span className={styles.workspaceMark} aria-hidden='true'>
            <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.6'>
              <rect x='4' y='9' width='16' height='12' rx='3' />
              <path d='M8 9V6a4 4 0 0 1 8 0v3M12 14v2' strokeLinecap='round' />
            </svg>
          </span>
          <div className={styles.workspaceHeading}>
            <h2 title={selectedEntry?.key}>
              {selectedEntry ? selectedEntry.key : 'Your workspace'}
            </h2>
            <p>{selectedEntry ? 'Entry details' : 'Select an entry or create something new'}</p>
          </div>
          <span className={styles.workspaceTag}>Personal workspace</span>
        </header>

        <div className={styles.canvas}>
          <div className={styles.content}>
            {removeError && (
              <p className={styles.error} role='alert'>
                {removeError}
              </p>
            )}
            {state.status === 'loading' && (
              <div className={styles.messageCard}>
                <span className={styles.emptyMark} aria-hidden='true'>
                  ◇
                </span>
                <h2>Opening your workspace</h2>
                <p role='status'>Loading entries…</p>
              </div>
            )}
            {state.status === 'error' && (
              <div className={styles.messageCard}>
                <h2>Something needs attention</h2>
                <p className={styles.error} role='alert'>
                  {state.message}
                </p>
              </div>
            )}

            {state.status === 'ready' && (
              <>
                {selectedEntry ? (
                  <EntryDetails
                    key={selectedEntry.key}
                    entry={selectedEntry}
                    onClose={closeDetails}
                  />
                ) : (
                  <section
                    className={styles.emptyDetails}
                    id='entry-details'
                    aria-labelledby='entry-details-title'
                  >
                    <span className={styles.emptyMark} aria-hidden='true'>
                      <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.4'>
                        <circle cx='9' cy='9' r='4.5' />
                        <path
                          d='m12.5 12.5 7 7M16 16l2-2M18 18l2-2'
                          strokeLinecap='round'
                          strokeLinejoin='round'
                        />
                      </svg>
                    </span>
                    <h2 id='entry-details-title'>Entry details</h2>
                    <p>Select an entry to view its details.</p>
                    <span>Values stay hidden until you choose to reveal them.</span>
                  </section>
                )}
                <AddEntryForm onAdd={addEntry} />
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
