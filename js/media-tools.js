// Grabación (MediaRecorder), validación de audio, conversión a WAV y preparación de imágenes.
import { LIMITES, mimeBase, MIME_POR_EXT } from './model.js';
import { fmtBytes } from './util.js';

const CANDIDATOS = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/aac', 'audio/ogg;codecs=opus', 'audio/ogg'];

export function grabacionSoportada() {
  if (!globalThis.isSecureContext) return { ok: false, motivo: 'La grabación requiere HTTPS (o localhost).' };
  if (!navigator.mediaDevices?.getUserMedia) return { ok: false, motivo: 'Este navegador no permite acceder al micrófono.' };
  if (typeof MediaRecorder === 'undefined') return { ok: false, motivo: 'Este navegador no soporta MediaRecorder (grabación).' };
  return { ok: true };
}

export function mimeDeGrabacion() {
  if (typeof MediaRecorder === 'undefined') return '';
  if (!MediaRecorder.isTypeSupported) return '';
  return CANDIDATOS.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

export function mensajeErrorMicrofono(e) {
  switch (e?.name) {
    case 'NotAllowedError': case 'SecurityError': return 'Permiso de micrófono denegado. Habilitalo en la configuración del navegador para este sitio.';
    case 'NotFoundError': case 'OverconstrainedError': return 'No se encontró ningún micrófono.';
    case 'NotReadableError': return 'El micrófono está siendo usado por otra aplicación.';
    default: return `No se pudo grabar: ${e?.message || e}`;
  }
}

/** Grabador simple: iniciar() → detener() devuelve Blob. */
export class Grabador {
  constructor({ maxSegundos = 900, onTick } = {}) { this.maxSegundos = maxSegundos; this.onTick = onTick; }
  async iniciar() {
    const soporte = grabacionSoportada();
    if (!soporte.ok) throw new Error(soporte.motivo);
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const mimeType = mimeDeGrabacion();
    this.rec = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.trozos = [];
    this.rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) this.trozos.push(ev.data); };
    this.inicio = Date.now();
    this.rec.start(1000);
    this.timer = setInterval(() => {
      const s = (Date.now() - this.inicio) / 1000;
      this.onTick?.(s);
      if (s >= this.maxSegundos) this.detener();
    }, 250);
  }
  get grabando() { return this.rec?.state === 'recording'; }
  detener() {
    if (this._detener) return this._detener;
    this._detener = new Promise((res, rej) => {
      if (!this.rec) return rej(new Error('No hay grabación en curso.'));
      this.rec.onstop = () => {
        clearInterval(this.timer);
        this.stream.getTracks().forEach((t) => t.stop());
        const tipo = mimeBase(this.rec.mimeType || this.trozos[0]?.type || 'audio/webm');
        const blob = new Blob(this.trozos, { type: tipo });
        if (!blob.size) rej(new Error('La grabación quedó vacía.')); else res(blob);
      };
      this.rec.onerror = (e) => rej(e.error || new Error('Error de grabación'));
      if (this.rec.state !== 'inactive') this.rec.stop(); else this.rec.onstop();
    });
    return this._detener;
  }
  cancelar() {
    clearInterval(this.timer);
    try { if (this.rec && this.rec.state !== 'inactive') this.rec.stop(); } catch { /* nada */ }
    this.stream?.getTracks().forEach((t) => t.stop());
  }
}

/** Devuelve 'probably' | 'maybe' | '' según el navegador actual. */
export function puedeReproducir(mime) {
  try { return document.createElement('audio').canPlayType(mimeBase(mime)); } catch { return ''; }
}

export function avisoCompatibilidad(mime) {
  const m = mimeBase(mime);
  if (m === 'audio/webm' || m === 'audio/ogg')
    return 'Formato WebM/Ogg: algunos iPhone/iPad con iOS anterior a 17 no lo reproducen. Para máxima compatibilidad usá “Convertir a WAV” o subí un MP3/M4A.';
  if (m === 'audio/flac') return 'FLAC no se reproduce en todos los navegadores; preferí MP3.';
  return '';
}

function mimeDeArchivo(file) {
  const m = mimeBase(file.type);
  if (m) return m;
  const ext = /\.([a-z0-9]+)$/i.exec(file.name || '')?.[1]?.toLowerCase();
  return MIME_POR_EXT[ext] || '';
}

/** Valida un archivo de audio: tipo, tamaño y que este navegador pueda leerlo. */
export async function validarAudio(file) {
  const mime = mimeDeArchivo(file);
  if (!mime.startsWith('audio/')) throw new Error('El archivo no parece ser de audio (usá MP3, M4A, WAV, OGG o WebM).');
  if (file.size > LIMITES.audioMaxBytes) throw new Error(`El audio pesa ${fmtBytes(file.size)}; el máximo es ${fmtBytes(LIMITES.audioMaxBytes)}. Comprimilo a MP3 (ver README).`);
  if (!file.size) throw new Error('El archivo está vacío.');
  const duracion = await duracionAudio(file).catch(() => null);
  const avisos = [];
  if (duracion == null) avisos.push('Este navegador no pudo leer el audio. Puede que otros sí, pero conviene convertirlo a MP3.');
  const ac = avisoCompatibilidad(mime); if (ac) avisos.push(ac);
  return { mime, duracion, avisos };
}

export function duracionAudio(blob, ms = 8000) {
  return new Promise((res, rej) => {
    const a = document.createElement('audio');
    const url = URL.createObjectURL(blob);
    const fin = (f) => { clearTimeout(t); URL.revokeObjectURL(url); a.removeAttribute('src'); f(); };
    const t = setTimeout(() => fin(() => rej(new Error('timeout'))), ms);
    a.preload = 'metadata';
    a.onloadedmetadata = () => {
      if (a.duration === Infinity) { // WebM de MediaRecorder: forzar cálculo de duración
        a.currentTime = 1e7;
        a.ontimeupdate = () => { a.ontimeupdate = null; const d = a.duration; fin(() => res(isFinite(d) ? d : null)); };
      } else fin(() => res(a.duration));
    };
    a.onerror = () => fin(() => rej(new Error('No reproducible')));
    a.src = url;
  });
}

/** Convierte cualquier audio decodificable a WAV PCM 16 bits mono (22,05 kHz): se reproduce en todos los navegadores. */
export async function convertirAWav(blob, frecuencia = 22050) {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) throw new Error('Este navegador no permite convertir audio.');
  const ctx = new AC();
  let buffer;
  try { buffer = await ctx.decodeAudioData(await blob.arrayBuffer()); }
  catch { throw new Error('No se pudo decodificar el audio en este navegador.'); }
  finally { ctx.close?.(); }
  const largo = Math.ceil(buffer.duration * frecuencia);
  const off = new OfflineAudioContext(1, largo, frecuencia);
  const src = off.createBufferSource(); src.buffer = buffer; src.connect(off.destination); src.start();
  const r = await off.startRendering();
  return codificarWav(r.getChannelData(0), frecuencia);
}

export function codificarWav(muestras, frecuencia) {
  const dv = new DataView(new ArrayBuffer(44 + muestras.length * 2));
  const str = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); dv.setUint32(4, 36 + muestras.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, frecuencia, true);
  dv.setUint32(28, frecuencia * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); str(36, 'data');
  dv.setUint32(40, muestras.length * 2, true);
  for (let i = 0; i < muestras.length; i++) { const s = Math.max(-1, Math.min(1, muestras[i])); dv.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Blob([dv.buffer], { type: 'audio/wav' });
}

/** Valida y, si es grande, reduce la imagen (máx. 1600 px, JPEG). */
export async function prepararImagen(file) {
  const mime = mimeDeArchivo(file);
  if (!mime.startsWith('image/')) throw new Error('El archivo no es una imagen (JPG, PNG, WebP o GIF).');
  if (file.size > LIMITES.imagenMaxBytes * 3) throw new Error(`La imagen pesa ${fmtBytes(file.size)}; es demasiado grande.`);
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { throw new Error('No se pudo leer la imagen.'); }
  const max = 1600;
  if (bmp.width <= max && bmp.height <= max && file.size <= 800 * 1024 && mime !== 'image/gif') return { blob: file, mime };
  if (mime === 'image/gif' && file.size <= LIMITES.imagenMaxBytes) return { blob: file, mime };
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
  return { blob, mime: 'image/jpeg' };
}
