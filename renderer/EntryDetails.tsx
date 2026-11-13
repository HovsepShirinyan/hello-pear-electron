import { useState } from 'react'
import type { Entry } from './autopass'
import styles from './EntryDetails.module.css'

type Props = {
  entry: Entry
  onClose: () => void
}

export default function EntryDetails({ entry, onClose }: Props) {
  const [revealed, setRevealed] = useState(false)

  return (
    <section className={styles.card} id='entry-details' aria-labelledby='entry-details-title'>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.headingIcon} aria-hidden='true'>
            <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.6'>
              <rect x='5' y='3.5' width='14' height='17' rx='3' />
              <path d='M9 8h6M9 12h6M9 16h3' strokeLinecap='round' />
            </svg>
          </span>
          <h3 id='entry-details-title'>Entry details</h3>
        </div>
        <button
          className={styles.closeButton}
          type='button'
          onClick={onClose}
          aria-label='Close entry details'
        >
          <svg
            aria-hidden='true'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth='1.7'
          >
            <path d='m7 7 10 10M17 7 7 17' strokeLinecap='round' />
          </svg>
          Close details
        </button>
      </header>

      <dl className={styles.details}>
        <div className={styles.detail}>
          <dt>Name</dt>
          <dd className={styles.name} id='entry-detail-name'>
            {entry.key}
          </dd>
        </div>
        <div className={styles.detail}>
          <dt>Value</dt>
          <dd className={styles.valueBox} id='entry-detail-value'>
            {entry.value === null ? (
              <p className={styles.placeholder}>No value stored.</p>
            ) : revealed ? (
              <pre className={entry.value === '' ? styles.emptyValue : styles.value}>
                {entry.value === '' ? 'Empty value.' : entry.value}
              </pre>
            ) : (
              <p className={styles.placeholder}>
                <svg
                  aria-hidden='true'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='1.6'
                >
                  <rect x='5.5' y='10' width='13' height='10' rx='2.5' />
                  <path d='M8.5 10V7a3.5 3.5 0 0 1 7 0v3M12 14v2' strokeLinecap='round' />
                </svg>
                Value hidden.
              </p>
            )}
          </dd>
        </div>
      </dl>

      {entry.value !== null && (
        <div className={styles.actions}>
          <button
            className={styles.revealButton}
            type='button'
            aria-controls='entry-detail-value'
            aria-pressed={revealed}
            onClick={() => setRevealed((value) => !value)}
          >
            <svg
              aria-hidden='true'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='1.6'
            >
              {revealed ? (
                <>
                  <path
                    d='m4 4 16 16M9.5 5.5A11 11 0 0 1 12 5c6.5 0 10 7 10 7a16 16 0 0 1-3 3.7M6 6.8A17 17 0 0 0 2 12s3.5 7 10 7a11 11 0 0 0 5-1.2'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                  />
                  <path d='M9.9 9.9a3 3 0 0 0 4.2 4.2' strokeLinecap='round' />
                </>
              ) : (
                <>
                  <path
                    d='M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z'
                    strokeLinejoin='round'
                  />
                  <circle cx='12' cy='12' r='3' />
                </>
              )}
            </svg>
            {revealed ? 'Hide value' : 'Reveal value'}
          </button>
        </div>
      )}
    </section>
  )
}
