import { createRoot } from 'react-dom/client'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('React root element was not found')
}

createRoot(rootElement).render(
  <main>
    <h2>Autopass</h2>
    <p>React ++</p>
  </main>
)
