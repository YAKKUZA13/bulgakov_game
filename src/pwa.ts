export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  if (!import.meta.env.PROD) return

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // no-op: PWA is best-effort
    })
  })
}


