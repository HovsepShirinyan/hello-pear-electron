import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach } from 'vitest'

const roots = new Set<Root>()

export async function interact(action: () => unknown) {
  await act(async () => {
    await action()
  })
}

export async function render(content: ReactNode) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.add(root)
  await interact(() => root.render(content))
  return {
    async unmount() {
      await interact(() => root.unmount())
      roots.delete(root)
      host.remove()
    }
  }
}

afterEach(async () => {
  for (const root of roots) await interact(() => root.unmount())
  roots.clear()
  document.body.replaceChildren()
})

export function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector)
  if (!node) throw new Error('Expected element: ' + selector)
  return node
}

export function button(name: string): HTMLButtonElement {
  const node = [...document.querySelectorAll('button')].find(
    (candidate) => (candidate.getAttribute('aria-label') || candidate.textContent.trim()) === name
  )
  if (!node) throw new Error('Expected button: ' + name)
  return node
}

export async function click(name: string) {
  await interact(() => button(name).click())
}

export async function input(selector: string, value: string) {
  await interact(() => {
    const node = element<HTMLInputElement | HTMLTextAreaElement>(selector)
    const prototype =
      node.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

export async function submit() {
  // Dispatching submit tests React's handler. Native constraint validation is
  // checked separately and the desktop smoke test exercises real Chromium.
  await interact(() =>
    element('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  )
}

export function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
