import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import { ScreenshotOverlay } from './components/ScreenshotOverlay.tsx'

// Tauri 截图覆盖层窗口以 ?mode=screenshot 加载同一前端，进入选区 UI 而非主应用
const isScreenshotMode = new URLSearchParams(window.location.search).get('mode') === 'screenshot'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isScreenshotMode ? (
      <ScreenshotOverlay />
    ) : (
      <BrowserRouter>
        <App />
      </BrowserRouter>
    )}
  </StrictMode>,
)
