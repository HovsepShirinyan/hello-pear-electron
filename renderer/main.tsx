import './global.css'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('React root not found')
}

createRoot(rootElement).render(<App />)
