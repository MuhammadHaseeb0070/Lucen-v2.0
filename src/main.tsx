import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import './artifact-hub.css'
import './powertools.css'
import './store/orchestration'
import App from './App.tsx'

declare const APP_VERSION: string;

// Sentry error monitoring — only initialize when DSN is configured
const sentryDsn = import.meta.env.VITE_SENTRY_DSN
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    release: typeof APP_VERSION !== 'undefined' ? APP_VERSION : '0.0.0',
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1, // 10% of transactions for performance monitoring
    replaysSessionSampleRate: 0, // no session replays by default
    replaysOnErrorSampleRate: 1.0, // 100% of sessions with errors get replayed
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
    ],
    beforeSend(event) {
      // Strip auth tokens from error reports
      if (event.request?.headers) {
        delete event.request.headers['Authorization']
        delete event.request.headers['apikey']
      }
      return event
    },
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
