import { useState, type FormEvent } from 'react'

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
    <form onSubmit={handleSubmit} aria-busy={saving}>
      <fieldset disabled={saving}>
        <legend>Add an entry</legend>

        <label htmlFor='entry-name'>Name</label>
        <input
          id='entry-name'
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />

        <label htmlFor='entry-value'>Value</label>
        <textarea
          id='entry-value'
          value={value}
          onChange={(event) => setValue(event.target.value)}
          rows={4}
        />

        <button type='submit'>{saving ? 'Adding…' : 'Add entry'}</button>
      </fieldset>

      {error && <p role='alert'>{error}</p>}
      {success && <p role='status'>Entry added.</p>}
    </form>
  )
}
