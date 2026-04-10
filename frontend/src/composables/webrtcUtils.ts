/**
 * Format a byte count as a human-readable string.
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024)               return `${bytes} B`
  if (bytes < 1024 * 1024)        return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/**
 * Register the service worker required for the streaming-save fallback.
 * Call once from application setup (e.g. inside the composable or main.ts).
 */
export function registerServiceWorker(): void {
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('SW registration failed — streaming fallback may buffer in RAM:', err)
    })
  }
}
