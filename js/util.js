// Utilidades compartidas: DOM seguro (sin innerHTML con contenido de usuario), ids, textos.

export const $ = (sel, root = document) => root.querySelector(sel);

/** Crea un elemento DOM. Los hijos de texto se insertan como texto (nunca como HTML). */
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled') el[k] = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

/** Texto multilínea → párrafos seguros. */
export function parrafos(texto) {
  const frag = document.createDocumentFragment();
  String(texto || '').split(/\n{2,}/).forEach((bloque) => {
    if (!bloque.trim()) return;
    const p = document.createElement('p');
    bloque.split('\n').forEach((linea, i) => { if (i) p.append(document.createElement('br')); p.append(linea); });
    frag.append(p);
  });
  return frag;
}

const ALFABETO = 'abcdefghijklmnopqrstuvwxyz0123456789';
export function uid(prefijo = 'id') {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += ALFABETO[b % ALFABETO.length];
  return `${prefijo}-${s}`;
}

export const ID_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

// Quita caracteres de control (excepto salto de línea y tab) y limita longitud.
export function sanear(texto, max = 20000) {
  return String(texto ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g, '')
    .slice(0, max);
}

export function slugify(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
}

export function fmtDist(m) {
  if (m == null || !isFinite(m)) return '—';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

export function fmtBytes(b) {
  if (!b && b !== 0) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

export function fmtTiempo(seg) {
  if (!isFinite(seg) || seg < 0) return '0:00';
  const m = Math.floor(seg / 60), s = Math.floor(seg % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function ahora() { return new Date().toISOString(); }

let toastHost;
/** Mensaje breve accesible (región aria-live). tipo: info | ok | error | aviso */
export function toast(msg, tipo = 'info', ms = 4500) {
  if (!toastHost) {
    toastHost = document.getElementById('toasts') || document.body.appendChild(h('div', { id: 'toasts' }));
    toastHost.setAttribute('aria-live', 'polite');
    toastHost.setAttribute('role', 'status');
  }
  const t = h('div', { class: `toast toast-${tipo}` }, msg);
  toastHost.append(t);
  setTimeout(() => t.remove(), ms);
}

export function lsGet(clave, def = null) {
  try { const v = localStorage.getItem(clave); return v == null ? def : v; } catch { return def; }
}
export function lsSet(clave, valor) {
  try { localStorage.setItem(clave, valor); return true; } catch { return false; }
}

export function descargar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: nombre });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function esErrorCuota(e) {
  return e && (e.name === 'QuotaExceededError' || e.code === 22 || /quota/i.test(e.message || ''));
}
