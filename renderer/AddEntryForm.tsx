import { useState, type FormEvent } from 'react'
import styles from './AddEntryForm.module.css'

type Props = {
  onAdd: (key: string, value: string) => Promise<void>
}

export default function AddEntryForm({ onAdd }: Props) {
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return

    setError(null)
    setSuccess(false)

    const key = name.trim()

    if (!key) {
      setError('Entry name is required.')
      return
    }

    setSaving(true)

    try {
      await onAdd(key, value)
      setName('')
      setValue('')
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add entry.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className={styles.card} onSubmit={handleSubmit} aria-busy={saving}>
      <fieldset className={styles.fields} disabled={saving}>
        <legend className={styles.legend}>
          <span className={styles.headingIcon} aria-hidden='true'>
            <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.7'>
              <path d='M12 5v14M5 12h14' strokeLinecap='round' />
            </svg>
          </span>
          Add an entry
        </legend>

        <div className={styles.body}>
          <div className={styles.field}>
            <label htmlFor='entry-name'>Name</label>
            <input
              className={styles.control}
              id='entry-name'
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>

          <div className={styles.field}>
            <label htmlFor='entry-value'>Value</label>
            <textarea
              className={styles.control + ' ' + styles.textarea}
              id='entry-value'
              value={value}
              onChange={(event) => setValue(event.target.value)}
              rows={4}
            />
          </div>

          <div className={styles.actions}>
            <button className={styles.primaryButton} type='submit'>
              <svg
                aria-hidden='true'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='1.8'
              >
                <path d='M12 5v14M5 12h14' strokeLinecap='round' />
              </svg>
              {saving ? 'Adding…' : 'Add entry'}
            </button>
          </div>
        </div>
      </fieldset>

      {error && (
        <p className={styles.message + ' ' + styles.error} role='alert'>
          <svg
            aria-hidden='true'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth='1.7'
          >
            <circle cx='12' cy='12' r='8.5' />
            <path d='M12 7.5v5M12 16h.01' strokeLinecap='round' />
          </svg>
          {error}
        </p>
      )}
      {success && (
        <p className={styles.message + ' ' + styles.success} role='status'>
          <svg
            aria-hidden='true'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth='1.7'
          >
            <circle cx='12' cy='12' r='8.5' />
            <path d='m8 12 2.5 2.5L16 9' strokeLinecap='round' strokeLinejoin='round' />
          </svg>
          Entry added.
        </p>
      )}
    </form>
  )
}
