// Interfaz accesible del reproductor (usada por la vista estudiante y el simulador).
import { h, fmtTiempo } from './util.js';

const TEXTO_ESTADO = {
  inactivo: 'Nada en reproducción', cargando: 'Cargando audio…', reproduciendo: 'Reproduciendo',
  pausado: 'En pausa', bloqueado: 'El navegador no permitió iniciar el audio solo. Tocá ▶ para escucharlo.',
  error: 'Error de audio', terminado: 'Audio terminado',
};

export function montarReproductor(cont, rep, { onVerTexto } = {}) {
  const titulo = h('strong', { class: 'rep-titulo' });
  const estado = h('span', { class: 'rep-estado' });
  const error = h('p', { class: 'rep-error', role: 'alert', hidden: true });
  const btnPlay = h('button', { type: 'button', class: 'btn btn-grande btn-primario', onclick: () => rep.alternar() });
  const btnRep = h('button', { type: 'button', class: 'btn btn-grande', 'aria-label': 'Repetir desde el principio', title: 'Repetir', onclick: () => rep.repetir() }, '↺');
  const btnStop = h('button', { type: 'button', class: 'btn btn-grande', 'aria-label': 'Detener', title: 'Detener', onclick: () => rep.detener() }, '■');
  const btnTexto = h('button', { type: 'button', class: 'btn', onclick: () => { const s = rep.actual || rep.ultimo; if (s) onVerTexto?.(s); } }, 'Ver texto');
  const barra = h('input', { type: 'range', min: 0, max: 100, step: 0.1, value: 0, class: 'rep-barra', 'aria-label': 'Posición del audio', oninput: (e) => rep.buscar(Number(e.target.value)) });
  const tiempo = h('span', { class: 'rep-tiempo', 'aria-hidden': 'true' }, '0:00 / 0:00');
  const cola = h('ol', { class: 'rep-cola' });
  const tituloCola = h('h3', { class: 'rep-cola-titulo' });
  const vivo = h('p', { class: 'visually-hidden', 'aria-live': 'polite' });

  cont.replaceChildren(
    h('div', { class: 'rep' },
      h('div', { class: 'rep-cabecera' }, titulo, estado),
      h('div', { class: 'rep-controles' }, btnPlay, btnRep, btnStop, btnTexto),
      h('div', { class: 'rep-progreso' }, barra, tiempo),
      error, tituloCola, cola, vivo),
  );

  function pintarTiempo() {
    const a = rep.audio, d = isFinite(a.duration) ? a.duration : 0;
    barra.max = d || 100; barra.value = a.currentTime || 0;
    tiempo.textContent = `${fmtTiempo(a.currentTime)} / ${fmtTiempo(d)}`;
  }
  let ultimoAnuncio = '';
  function pintar() {
    const s = rep.actual || rep.ultimo;
    titulo.textContent = s ? s.titulo : 'Reproductor';
    estado.textContent = TEXTO_ESTADO[rep.estado] || '';
    estado.dataset.estado = rep.estado;
    const sonando = rep.estado === 'reproduciendo';
    btnPlay.textContent = sonando ? '❚❚' : '▶';
    btnPlay.setAttribute('aria-label', sonando ? 'Pausar' : rep.actual ? 'Reanudar' : rep.cola[0] ? `Reproducir ${rep.cola[0].titulo}` : 'Reproducir');
    btnPlay.disabled = !rep.actual && !rep.cola.length;
    btnRep.disabled = !s; btnStop.disabled = !rep.actual; btnTexto.disabled = !s;
    barra.disabled = !rep.actual;
    error.hidden = !rep.error; error.textContent = rep.error;
    cola.replaceChildren(...rep.cola.map((sp, i) => h('li', {},
      h('span', {}, sp.titulo, i === 0 && !rep.ocupado ? h('em', {}, ' — listo para escuchar') : null),
      h('button', { type: 'button', class: 'btn btn-chico', onclick: () => rep.reproducir(sp), 'aria-label': `Reproducir ahora ${sp.titulo}` }, '▶ Ahora'),
      h('button', { type: 'button', class: 'btn btn-chico', onclick: () => rep.quitarDeCola(sp.id), 'aria-label': `Quitar ${sp.titulo} de la espera` }, '✕'),
    )));
    tituloCola.textContent = rep.cola.length ? (rep.ocupado ? `En espera (${rep.cola.length})` : `Para escuchar (${rep.cola.length})`) : '';
    tituloCola.hidden = !rep.cola.length;
    const anuncio = `${estado.textContent}${s ? ': ' + s.titulo : ''}`;
    if (anuncio !== ultimoAnuncio) { vivo.textContent = anuncio; ultimoAnuncio = anuncio; }
    pintarTiempo();
  }
  rep._desmontarUI?.();
  rep.addEventListener('cambio', pintar);
  rep.addEventListener('tiempo', pintarTiempo);
  rep.audio.addEventListener('loadedmetadata', pintarTiempo);
  rep._desmontarUI = () => {
    rep.removeEventListener('cambio', pintar);
    rep.removeEventListener('tiempo', pintarTiempo);
    rep.audio.removeEventListener('loadedmetadata', pintarTiempo);
  };
  pintar();
  return { pintar };
}
