// Reproductor de la audioguía con cola de activaciones.
// Reglas:
//  - Una activación por GPS NUNCA interrumpe un audio en curso (o en pausa): queda "en espera".
//  - Modo automático: si no hay nada sonando, intenta reproducir; si el navegador lo bloquea, pide un toque.
//  - Modo manual: la activación queda primera en la lista para que el estudiante toque ▶.
//  - Una acción explícita del usuario (▶ en un spot) sí reemplaza lo que esté sonando.
import { mimeBase } from './model.js';

function silencioWav() {
  const dv = new DataView(new ArrayBuffer(44 + 800));
  const str = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); dv.setUint32(4, 36 + 800, true); str(8, 'WAVE'); str(12, 'fmt '); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, 8000, true); dv.setUint32(28, 16000, true);
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, 800, true);
  return URL.createObjectURL(new Blob([dv.buffer], { type: 'audio/wav' }));
}

export class Reproductor extends EventTarget {
  /** resolverAudio(spot) → Promise<{url, revocar?}> */
  constructor(resolverAudio) {
    super();
    this.resolverAudio = resolverAudio;
    this.audio = document.createElement('audio');
    this.audio.preload = 'auto';
    this.audio.setAttribute('playsinline', '');
    this.modo = 'manual';
    this.actual = null;      // spot que ocupa el reproductor
    this.estado = 'inactivo'; // inactivo | cargando | reproduciendo | pausado | bloqueado | error | terminado
    this.cola = [];          // spots en espera
    this.ultimo = null;      // último spot reproducido (para "Repetir")
    this.error = '';
    this._revocar = null;
    this.audio.addEventListener('ended', () => this._alTerminar());
    this.audio.addEventListener('pause', () => { if (this.actual && this.estado === 'reproduciendo' && !this.audio.ended) this._set('pausado'); });
    this.audio.addEventListener('play', () => { if (this.actual) this._set('reproduciendo'); });
    this.audio.addEventListener('timeupdate', () => this.dispatchEvent(new Event('tiempo')));
    this.audio.addEventListener('error', () => {
      if (!this.actual) return;
      this.error = 'No se pudo reproducir este audio en este navegador (formato no soportado o archivo no disponible). El texto sigue disponible.';
      this._set('error');
    });
  }

  _set(estado) { this.estado = estado; this._emitir('cambio'); }
  _emitir(tipo, detalle) { this.dispatchEvent(new CustomEvent(tipo, { detail: detalle })); }

  /** Ocupado = hay un audio en curso, en pausa, cargando o esperando un toque. */
  get ocupado() { return !!this.actual && ['cargando', 'reproduciendo', 'pausado', 'bloqueado'].includes(this.estado); }

  setModo(modo) { this.modo = modo === 'auto' ? 'auto' : 'manual'; this._emitir('cambio'); if (this.modo === 'auto') this._avanzar(); }

  /** Llamar dentro de un gesto del usuario (p. ej., al tocar “Iniciar”) para habilitar audio posterior. */
  desbloquear() {
    if (this._desbloqueado || this.actual) return;
    this._desbloqueado = true;
    const a = this.audio;
    a.src = silencioWav();
    a.play().then(() => a.pause()).catch(() => { this._desbloqueado = false; });
  }

  /** Activación por proximidad. Devuelve: 'sin-audio' | 'duplicado' | 'en-espera' | 'reproduciendo' | 'pendiente' */
  activar(spot) {
    this._emitir('llegada', spot);
    if (!spot.audio) return 'sin-audio';
    if ((this.actual?.id === spot.id && this.ocupado) || this.cola.some((s) => s.id === spot.id)) return 'duplicado';
    if (this.ocupado) { this.cola.push(spot); this._emitir('cambio'); return 'en-espera'; }
    if (this.modo === 'auto') { this.reproducir(spot); return 'reproduciendo'; }
    this.cola.push(spot); this._emitir('cambio'); return 'pendiente';
  }

  async reproducir(spot) {
    this.cola = this.cola.filter((s) => s.id !== spot.id);
    this.error = '';
    this.actual = spot; this.ultimo = spot;
    this._set('cargando');
    let fuente;
    try { fuente = await this.resolverAudio(spot); }
    catch (e) { this.error = e.message || 'Audio no disponible.'; this._set('error'); return; }
    if (this.actual !== spot) { fuente?.revocar?.(); return; }
    this._revocar?.(); this._revocar = fuente.revocar || null;
    if (spot.audio?.mime && this.audio.canPlayType(mimeBase(spot.audio.mime)) === '') {
      this.error = 'Es posible que este navegador no soporte el formato del audio.';
    }
    this.audio.src = fuente.url;
    this._mediaSession(spot);
    try {
      await this.audio.play();
      if (this.actual === spot) this._set('reproduciendo');
    } catch (e) {
      if (this.actual !== spot) return;
      if (e.name === 'NotAllowedError') this._set('bloqueado');
      else if (e.name !== 'AbortError') { this.error = 'No se pudo reproducir este audio en este navegador. El texto sigue disponible.'; this._set('error'); }
    }
  }

  pausar() { if (this.estado === 'reproduciendo') this.audio.pause(); }
  async reanudar() {
    if (!this.actual) return;
    try { await this.audio.play(); this._set('reproduciendo'); }
    catch (e) { if (e.name === 'NotAllowedError') this._set('bloqueado'); }
  }
  alternar() { if (this.estado === 'reproduciendo') this.pausar(); else if (this.actual && this.estado !== 'error') this.reanudar(); else if (this.cola[0]) this.reproducir(this.cola[0]); }
  repetir() {
    const s = this.actual || this.ultimo;
    if (!s) return;
    if (this.actual && this.estado !== 'error' && this.estado !== 'cargando') { this.audio.currentTime = 0; this.reanudar(); }
    else this.reproducir(s);
  }
  buscar(seg) { if (this.actual && isFinite(seg)) this.audio.currentTime = seg; }
  detener() {
    this.audio.pause();
    this.actual = null; this._set('inactivo');
    this._avanzar();
  }
  quitarDeCola(id) { this.cola = this.cola.filter((s) => s.id !== id); this._emitir('cambio'); }
  vaciar() { this.cola = []; this.audio.pause(); this.actual = null; this._set('inactivo'); }

  _alTerminar() {
    if (!this.actual) return;
    this.ultimo = this.actual; this.actual = null;
    this._set('terminado');
    this._avanzar();
  }
  _avanzar() {
    if (this.ocupado || !this.cola.length) return;
    if (this.modo === 'auto') this.reproducir(this.cola[0]);
    else this._emitir('cambio');
  }

  _mediaSession(spot) {
    try {
      if (!('mediaSession' in navigator)) return;
      navigator.mediaSession.metadata = new MediaMetadata({ title: spot.titulo, artist: 'Audioguía' });
      navigator.mediaSession.setActionHandler('play', () => this.reanudar());
      navigator.mediaSession.setActionHandler('pause', () => this.pausar());
    } catch { /* opcional */ }
  }
}
