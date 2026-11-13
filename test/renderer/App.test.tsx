import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../renderer/App.tsx'
import type { Entry } from '../../renderer/autopass'
import { button, click, deferred, element, input, interact, render, submit } from './dom'

const service = vi.hoisted(() => ({
  addEntry: vi.fn<(key: string, value: string) => Promise<void>>(),
  removeEntry: vi.fn<(key: string) => Promise<void>>(),
  watchEntries:
    vi.fn<(onEntries: (entries: Entry[]) => void, onError: (error: Error) => void) => () => void>(),
  unsubscribe: vi.fn<() => void>()
}))

vi.mock('../../renderer/autopass', () => service)

const entries: Entry[] = [
  { key: 'Alpha note', value: 'first-test-value' },
  { key: 'Beta note', value: 'second-test-value' }
]
let publish: (entries: Entry[]) => void
let fail: (error: Error) => void

beforeEach(() => {
  service.addEntry.mockReset().mockResolvedValue(undefined)
  service.removeEntry.mockReset().mockResolvedValue(undefined)
  service.unsubscribe.mockReset()
  service.watchEntries.mockReset().mockImplementation((onEntries, onError) => {
    publish = onEntries
    fail = onError
    return service.unsubscribe
  })
})

async function ready(initialEntries = entries) {
  const mounted = await render(<App />)
  await interact(() => publish(initialEntries))
  return mounted
}

const count = () => element('#entry-count').textContent.trim()
const visibleKeys = () =>
  [...document.querySelectorAll('[data-entry-key]')].map((node) =>
    node.getAttribute('data-entry-key')
  )
const valueText = () => element('#entry-detail-value').textContent.trim()

describe('App entry workspace', () => {
  it('shows loading and errors, unsubscribes, and loads an empty workspace on a fresh mount', async () => {
    const mounted = await render(<App />)
    expect(element('main').getAttribute('aria-busy')).toBe('true')
    expect(element<HTMLInputElement>('#entry-search').disabled).toBe(true)
    expect(document.querySelector('form')).toBeNull()

    await interact(() => fail(new Error('Worker unavailable.')))
    expect(element('[role="alert"]').textContent).toContain('Worker unavailable.')
    expect(count()).toBe('Entries unavailable.')
    expect(document.querySelector('form')).toBeNull()
    await mounted.unmount()
    expect(service.unsubscribe).toHaveBeenCalledOnce()

    await ready([])
    expect(count()).toBe('0 entries')
    expect(element('main').getAttribute('aria-busy')).toBe('false')
    expect(element<HTMLInputElement>('#entry-search').disabled).toBe(false)
    expect(document.body.textContent).toContain('No entries yet.')
    expect(document.querySelector('form')).not.toBeNull()
  })

  it('searches trimmed names without case sensitivity and clears selection, query, and focus', async () => {
    await ready()
    expect(count()).toBe('2 entries')
    expect(button('Clear search').disabled).toBe(true)
    await click('View Alpha note')
    await input('#entry-search', '  ALPHA  ')
    expect(visibleKeys()).toEqual(['Alpha note'])
    expect(count()).toBe('1 matching entry (2 total)')
    expect(document.querySelector('#entry-detail-name')).toBeNull()

    await input('#entry-search', 'unmatched')
    expect(visibleKeys()).toEqual([])
    expect(count()).toBe('0 matching entries (2 total)')
    expect(document.body.textContent).toContain('No matching entries.')
    await click('Clear search')
    expect(element<HTMLInputElement>('#entry-search').value).toBe('')
    expect(document.activeElement).toBe(element('#entry-search'))
    expect(visibleKeys()).toEqual(['Alpha note', 'Beta note'])
    expect(count()).toBe('2 entries')
  })

  it('updates filtered rows and counts when a worker snapshot changes', async () => {
    await ready()
    await input('#entry-search', 'alpha')
    await interact(() => publish([...entries, { key: 'ALPHA remote', value: 'remote-test-value' }]))
    expect(visibleKeys()).toEqual(['Alpha note', 'ALPHA remote'])
    expect(count()).toBe('2 matching entries (3 total)')
    await interact(() => publish([entries[1]]))
    expect(visibleKeys()).toEqual([])
    expect(count()).toBe('0 matching entries (1 total)')
    expect(element<HTMLInputElement>('#entry-search').value).toBe('alpha')
    await click('Clear search')
    expect(count()).toBe('1 entry')
  })

  it('keeps hidden values out of the DOM and resets reveal when switching entries', async () => {
    const markupValue = '<strong>test-only value</strong>'
    await ready([{ key: 'Alpha note', value: markupValue }, entries[1]])
    await click('View Alpha note')
    expect(valueText()).toBe('Value hidden.')
    expect(element('#entry-details').innerHTML).not.toContain(markupValue)
    expect(button('View Alpha note').getAttribute('aria-pressed')).toBe('true')
    await click('Reveal value')
    expect(valueText()).toBe(markupValue)
    expect(element('#entry-details').querySelector('strong')).toBeNull()
    await click('Hide value')
    expect(valueText()).toBe('Value hidden.')
    expect(element('#entry-details').innerHTML).not.toContain('test-only value')
    await click('Reveal value')
    await click('View Beta note')
    expect(valueText()).toBe('Value hidden.')
    expect(element('#entry-details').textContent).not.toContain('test-only value')
    expect(element('#entry-details').textContent).not.toContain('second-test-value')
    expect(button('Reveal value').getAttribute('aria-pressed')).toBe('false')
  })

  it('uses the latest selected value, clears deleted selections, and does not reselect a reused name', async () => {
    await ready()
    await click('View Alpha note')
    await click('Reveal value')
    await interact(() => publish([{ key: 'Alpha note', value: 'updated-test-value' }, entries[1]]))
    expect(valueText()).toBe('updated-test-value')
    await interact(() => publish([entries[1]]))
    expect(document.querySelector('#entry-detail-name')).toBeNull()
    expect(element('#entry-details').textContent).toContain('Select an entry to view its details.')
    await interact(() => publish(entries))
    expect(document.querySelector('#entry-detail-name')).toBeNull()
    expect(button('View Alpha note').getAttribute('aria-pressed')).toBe('false')
  })

  it('returns focus to the selected row when details close', async () => {
    await ready()
    await click('View Beta note')
    button('Close entry details').focus()
    await click('Close entry details')
    expect(document.activeElement).toBe(button('View Beta note'))
    expect(document.querySelector('#entry-detail-name')).toBeNull()
  })

  it('distinguishes missing values from empty values without revealing either by default', async () => {
    await ready([
      { key: 'No value', value: null },
      { key: 'Empty value', value: '' }
    ])
    await click('View No value')
    expect(valueText()).toBe('No value stored.')
    expect(
      [...document.querySelectorAll('button')].some((node) =>
        node.textContent.includes('Reveal value')
      )
    ).toBe(false)
    await click('View Empty value')
    expect(valueText()).toBe('Value hidden.')
    await click('Reveal value')
    expect(valueText()).toBe('Empty value.')
  })

  it('locks removal while pending, reports failures, and waits for snapshots to update the list', async () => {
    const removal = deferred()
    service.removeEntry.mockReturnValueOnce(removal.promise)
    await ready()
    await click('Remove Alpha note')
    expect(service.removeEntry).toHaveBeenCalledWith('Alpha note')
    expect(button('Remove Alpha note').disabled).toBe(true)
    expect(button('Remove Beta note').disabled).toBe(true)
    expect(visibleKeys()).toEqual(['Alpha note', 'Beta note'])
    await click('Remove Beta note')
    expect(service.removeEntry).toHaveBeenCalledOnce()
    await interact(() => removal.reject(new Error('Cannot remove this entry.')))
    expect(element('[role="alert"]').textContent).toContain('Cannot remove this entry.')
    expect(button('Remove Alpha note').disabled).toBe(false)
    await click('Remove Alpha note')
    expect(document.querySelector('[role="alert"]')).toBeNull()
    expect(visibleKeys()).toContain('Alpha note')
    await interact(() => publish([entries[1]]))
    expect(visibleKeys()).toEqual(['Beta note'])
  })

  it('connects form creation to the service and shows entries only after a worker snapshot', async () => {
    await ready([])
    await input('#entry-name', ' New note ')
    await input('#entry-value', 'form-test-value')
    await submit()
    expect(service.addEntry).toHaveBeenCalledWith('New note', 'form-test-value')
    expect(element('form [role="status"]').textContent.trim()).toBe('Entry added.')
    expect(visibleKeys()).toEqual([])
    await interact(() => publish([{ key: 'New note', value: 'form-test-value' }]))
    expect(visibleKeys()).toEqual(['New note'])
    expect(count()).toBe('1 entry')
  })
})
