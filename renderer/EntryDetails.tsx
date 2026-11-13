import { useState } from 'react'
import type { Entry } from './autopass'

type Props = {
  entry: Entry
  onClose: () => void
}

export default function EntryDetails({ entry, onClose }: Props) {
  const [revealed, setRevealed] = useState(false)

  return (
    <section id='entry-details' aria-labelledby='entry-details-title'>
      <h3 id='entry-details-title'>Entry details</h3>
      <button type='button' onClick={onClose} aria-label='Close entry details'>
        Close details
      </button>

      <dl>
        <dt>Name</dt>
        <dd id='entry-detail-name'>{entry.key}</dd>
        <dt>Value</dt>
        <dd id='entry-detail-value'>
          {entry.value === null ? (
            <p>No value stored.</p>
          ) : revealed ? (
            <pre>{entry.value === '' ? 'Empty value.' : entry.value}</pre>
          ) : (
            <p>Value hidden.</p>
          )}
        </dd>
      </dl>

      {entry.value !== null && (
        <button
          type='button'
          aria-controls='entry-detail-value'
          aria-pressed={revealed}
          onClick={() => setRevealed((value) => !value)}
        >
          {revealed ? 'Hide value' : 'Reveal value'}
        </button>
      )}
    </section>
  )
}
