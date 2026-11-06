export function registrarSW() {
  if (!('serviceWorker' in navigator) || !isSecureContext) return;
  navigator.serviceWorker.register('./sw.js').catch(() => { /* la app funciona igual sin SW */ });
}
