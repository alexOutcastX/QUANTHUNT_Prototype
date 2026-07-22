// Self-hosted crash reporting — uncaught JS errors and unhandled promise
// rejections POST to /client-error so production failures surface in the
// server log instead of dying silently inside a WebView. Throttled hard: a
// crash loop must not DDoS the backend. Web/WebView only (the app always
// renders as react-native-web).
import { API_BASE } from './api';

const MAX_REPORTS = 5; // per app session
let sent = 0;

function report(message: string, stack?: string) {
  if (sent >= MAX_REPORTS) return;
  sent++;
  try {
    fetch(API_BASE + '/client-error', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: String(message).slice(0, 400),
        stack: String(stack || '').slice(0, 1500),
        platform: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 40) : 'unknown',
        version: (globalThis as { __TAUREYE_VERSION__?: string }).__TAUREYE_VERSION__ || '',
      }),
    }).catch(() => {});
  } catch {
    /* reporting must never throw */
  }
}

export function installErrorReporting(): void {
  if (typeof window === 'undefined') return;
  const w = window as Window & { __teErrHook?: boolean };
  if (w.__teErrHook) return;
  w.__teErrHook = true;
  window.addEventListener('error', (e) => {
    report(e.message || 'window.onerror', e.error?.stack);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = (e as PromiseRejectionEvent).reason;
    report(r?.message || String(r) || 'unhandledrejection', r?.stack);
  });
}
