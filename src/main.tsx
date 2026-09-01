import '@fontsource/nunito-sans/latin-400.css'
import '@fontsource/nunito-sans/latin-600.css'
import '@fontsource/nunito-sans/latin-700.css'
import '@fontsource/nunito-sans/latin-800.css'
import { render } from 'preact'
import { App } from './App'
import './styles.css'

const root = document.getElementById('app')

function renderStartupFailure(error: unknown): void {
  if (!root) return
  const detail = error instanceof Error ? error.message : String(error || 'Unknown startup error')
  root.innerHTML = ''
  const screen = document.createElement('main')
  screen.setAttribute('role', 'alert')
  screen.style.cssText = 'width:100%;height:100%;padding:9vh 8vw;background:#07111e;color:#f6f6f6;font-family:Arial,sans-serif;box-sizing:border-box;'
  const label = document.createElement('p')
  label.style.cssText = 'margin:0 0 18px;color:#f04b5f;font-size:20px;font-weight:700;letter-spacing:3px;'
  label.textContent = 'IZUMI STARTUP ERROR'
  const heading = document.createElement('h1')
  heading.style.cssText = 'margin:0 0 22px;font-size:54px;line-height:1.05;'
  heading.textContent = 'The TV client could not start'
  const message = document.createElement('p')
  message.style.cssText = 'max-width:1200px;margin:0;color:#d4d9df;font-size:26px;line-height:1.45;word-break:break-word;'
  message.textContent = detail
  screen.append(label, heading, message)
  root.appendChild(screen)
}

if (!root) throw new Error('The #app launch container is missing.')

try {
  root.innerHTML = ''
  render(<App />, root)
} catch (error) {
  renderStartupFailure(error)
}
