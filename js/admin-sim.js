// Simulador de GPS: usa el MISMO motor de proximidad y reproductor que la vista del estudiante.
/* global L */
import { h, fmtDist, fmtTiempo, lsGet, lsSet } from './util.js';
import { buscarSpot } from './model.js';
import { MotorProximidad, puntoAlEste, puntoEnTrazado, largoTrazado } from './geo.js';
import { Reproductor } from './player.js';
import { montarReproductor } from './player-ui.js';
import { iconoSpot, encuadrar } from './mapa.js';
import { resolverLocal } from './datos.js';

const TODOS = '__todos__';
let recElegido = null;

export function montarSimulador({ panel, mapa, capa, proyecto: p, pista }) {
  const motor = new MotorProximidad({ precisionMaxima: 50 });
  const rep = new Reproductor(resolverLocal);
  rep.setModo(lsGet('audioguia:modo-sim', 'auto'));
  const log = [];
  let precision = 5, anim = null, distancias = new Map();
  if (!recElegido || (recElegido !== TODOS && !p.recorridos.some((r) => r.id === recElegido))) recElegido = p.recorridos[0]?.id || TODOS;

  const recorrido = () => (recElegido === TODOS ? null : p.recorridos.find((r) => r.id === recElegido));
  const spotsActivos = () => {
    const r = recorrido();
    const lista = r ? r.spotIds.map((id) => buscarSpot(p, id)).filter(Boolean) : p.spots;
    return lista.filter((s) => s.habilitado !== false);
  };

  // ----- panel -----
  const selRec = h('select', { id: 'simRec', onchange: (e) => { recElegido = e.target.value; reiniciar(true); } },
    p.recorridos.map((r) => h('option', { value: r.id, selected: r.id === recElegido }, r.titulo)),
    h('option', { value: TODOS, selected: recElegido === TODOS }, 'Todos los spots habilitados'));
  const lblPrec = h('output', {}, '±5 m');
  const rngPrec = h('input', { id: 'simPrec', type: 'range', min: 3, max: 120, value: 5, oninput: (e) => { precision = Number(e.target.value); lblPrec.textContent = `±${precision} m`; mover(pos); } });
  const velocidad = h('select', { id: 'simVel', 'aria-label': 'Velocidad del recorrido automático' },
    h('option', { value: 1 }, 'Caminando (1×)'), h('option', { value: 5, selected: true }, 'Rápido (5×)'), h('option', { value: 20 }, 'Muy rápido (20×)'));
  const btnAnim = h('button', { type: 'button', class: 'btn', onclick: () => (anim ? pararAnim() : animar()) }, '▶ Recorrer el trazado');
  const tabla = h('tbody');
  const lista = h('ol', { class: 'log', 'aria-live': 'polite', 'aria-label': 'Registro de eventos' });
  const contRep = h('div');
  const posTxt = h('p', { class: 'ayuda', id: 'simPos' });

  panel.replaceChildren(
    h('h2', {}, 'Simulador GPS'),
    h('p', { class: 'banner banner-aviso' }, 'Modo simulación: la ubicación la ponés vos en el mapa (no es el GPS real). Sirve para probar distancias, entradas, salidas, cola de audio, reingreso e histéresis.'),
    h('p', { class: 'ayuda' }, 'Tocá el mapa o arrastrá el marcador azul “S” para mover a la persona simulada.'),
    h('div', { class: 'campo' }, h('label', { for: 'simRec' }, 'Recorrido'), selRec),
    h('div', { class: 'campo' }, h('label', { for: 'simPrec' }, 'Precisión simulada '), h('div', { class: 'fila' }, rngPrec, lblPrec),
      h('small', { class: 'ayuda' }, 'Con precisión peor que 50 m (o que el radio del spot) las lecturas se ignoran, igual que con GPS real.')),
    h('fieldset', { class: 'modo' }, h('legend', {}, 'Modo de reproducción'),
      ['auto', 'manual'].map((m) => h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'simModo', value: m, checked: rep.modo === m, onchange: () => { rep.setModo(m); lsSet('audioguia:modo-sim', m); registrar(`Modo ${m === 'auto' ? 'automático' : 'manual'}`); } }), m === 'auto' ? ' Automático' : ' Manual'))),
    h('div', { class: 'fila' }, btnAnim, velocidad,
      h('button', { type: 'button', class: 'btn', onclick: () => reiniciar(false) }, 'Reiniciar estados')),
    posTxt,
    h('table', { class: 'tabla-sim' },
      h('caption', { class: 'visually-hidden' }, 'Estado de cada spot'),
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Spot'), h('th', { scope: 'col' }, 'Distancia'), h('th', { scope: 'col' }, 'Entrada / salida'), h('th', { scope: 'col' }, 'Estado'), h('th', { scope: 'col' }, 'Mover'))),
      tabla),
    h('h3', {}, 'Reproductor (simulado)'), contRep,
    h('h3', {}, 'Registro de eventos'), lista,
  );
  montarReproductor(contRep, rep, { onVerTexto: (s) => registrar(`Texto de “${s.titulo}”: ${s.texto.slice(0, 120)}${s.texto.length > 120 ? '…' : ''}`) });

  function registrar(txt) {
    log.unshift(`${new Date().toLocaleTimeString('es-AR')} · ${txt}`);
    log.length = Math.min(log.length, 60);
    lista.replaceChildren(...log.map((l) => h('li', {}, l)));
  }

  // ----- mapa -----
  const capaSim = L.layerGroup().addTo(capa);
  const circulos = new Map();
  const iconoPersona = L.divIcon({ className: 'sim-persona', html: '<span>S</span>', iconSize: [28, 28] });
  let pos;
  let marcador, circPrec;

  function dibujarBase() {
    capaSim.clearLayers(); circulos.clear();
    const r = recorrido();
    if (r?.trazado.length > 1) L.polyline(r.trazado, { color: '#1f5f4a', weight: 5, opacity: 0.8, interactive: false }).addTo(capaSim);
    spotsActivos().forEach((s, i) => {
      const sal = L.circle([s.lat, s.lng], { radius: s.radioSalidaMetros, color: '#64748b', weight: 1, dashArray: '6 6', fill: false, interactive: false }).addTo(capaSim);
      const ent = L.circle([s.lat, s.lng], { radius: s.radioEntradaMetros, color: '#64748b', weight: 2, fillOpacity: 0.1, interactive: false }).addTo(capaSim);
      L.marker([s.lat, s.lng], { icon: iconoSpot(i + 1), title: s.titulo }).bindTooltip(s.titulo).addTo(capaSim);
      circulos.set(s.id, { ent, sal });
    });
    circPrec = L.circle([0, 0], { radius: precision, color: '#2563eb', weight: 1, fillOpacity: 0.1, interactive: false }).addTo(capaSim);
    marcador = L.marker([0, 0], { icon: iconoPersona, draggable: true, title: 'Persona simulada (arrastrá)', zIndexOffset: 2000 }).addTo(capaSim);
    marcador.on('drag', (e) => { const ll = e.target.getLatLng(); mover([ll.lat, ll.lng], false); });
    marcador.on('dragend', (e) => { const ll = e.target.getLatLng(); mover([ll.lat, ll.lng]); });
  }

  function posInicial() {
    const r = recorrido(), sp = spotsActivos();
    if (r?.trazado.length) return r.trazado[0];
    if (sp.length) return [sp[0].lat - 0.0015, sp[0].lng];
    const c = mapa.getCenter(); return [c.lat, c.lng];
  }

  function reiniciar(cambioRec) {
    pararAnim();
    rep.vaciar(); motor.reiniciar(); motor.setSpots(spotsActivos());
    dibujarBase();
    if (cambioRec || !pos) {
      pos = posInicial();
      const r = recorrido();
      encuadrar(mapa, [...(r?.trazado || []), ...spotsActivos().map((s) => [s.lat, s.lng]), pos]);
    }
    registrar(cambioRec ? `Simulación lista: ${recorrido()?.titulo || 'todos los spots'}` : 'Estados reiniciados (todos “fuera”)');
    mover(pos);
  }

  /** Mueve la persona simulada y pasa la lectura por el motor. */
  function mover(nueva, moverMarcador = true) {
    pos = nueva;
    if (moverMarcador) marcador.setLatLng(pos);
    circPrec.setLatLng(pos).setRadius(precision);
    posTxt.textContent = `Posición simulada: ${pos[0].toFixed(6)}, ${pos[1].toFixed(6)} · precisión ±${precision} m`;
    const res = motor.actualizar({ lat: pos[0], lng: pos[1], accuracy: precision });
    distancias = res.distancias;
    if (res.ignorados.length && res.ignorados.length === spotsActivos().length) posTxt.textContent += ' · lectura IGNORADA por baja precisión';
    for (const ev of res.eventos) {
      if (ev.tipo === 'entrada') {
        const r = rep.activar(ev.spot);
        const txt = { 'sin-audio': 'sin audio: se muestra el texto', duplicado: 'ya estaba sonando o en espera (no se duplica)', 'en-espera': 'otro audio está sonando: queda EN ESPERA', reproduciendo: 'reproducción automática', pendiente: 'modo manual: queda listo para tocar ▶' }[r];
        registrar(`ENTRADA a “${ev.spot.titulo}” (${fmtDist(ev.distancia)}) → ${txt}`);
      } else registrar(`SALIDA de “${ev.spot.titulo}” (${fmtDist(ev.distancia)} > ${ev.spot.radioSalidaMetros} m): podrá reactivarse al volver a entrar`);
    }
    pintarTabla();
  }

  function pintarTabla() {
    tabla.replaceChildren(...spotsActivos().map((s) => {
      const d = distancias.get(s.id), dentro = motor.estaDentro(s.id);
      const zona = d == null ? '' : d <= s.radioEntradaMetros ? 'en radio de entrada' : d <= s.radioSalidaMetros ? 'zona de histéresis' : 'lejos';
      const c = circulos.get(s.id);
      if (c) { const col = dentro ? '#15803d' : '#64748b'; c.ent.setStyle({ color: col, fillColor: col }); c.sal.setStyle({ color: col }); }
      return h('tr', { class: dentro ? 'dentro' : '' },
        h('th', { scope: 'row' }, s.titulo, s.audio ? '' : h('small', {}, ' (sin audio)')),
        h('td', {}, fmtDist(d), h('br'), h('small', {}, zona)),
        h('td', {}, `${s.radioEntradaMetros} / ${s.radioSalidaMetros} m`),
        h('td', {}, h('strong', {}, dentro ? 'DENTRO' : 'FUERA')),
        h('td', {},
          h('button', { type: 'button', class: 'btn btn-chico', 'aria-label': `Ir al centro de ${s.titulo}`, onclick: () => { pararAnim(); mover([s.lat, s.lng]); } }, 'Entrar'),
          h('button', { type: 'button', class: 'btn btn-chico', 'aria-label': `Ir a la zona de histéresis de ${s.titulo}`, title: 'Entre el radio de entrada y el de salida', onclick: () => { pararAnim(); mover(puntoAlEste(s.lat, s.lng, (s.radioEntradaMetros + s.radioSalidaMetros) / 2)); } }, 'Borde'),
          h('button', { type: 'button', class: 'btn btn-chico', 'aria-label': `Salir de ${s.titulo}`, onclick: () => { pararAnim(); mover(puntoAlEste(s.lat, s.lng, s.radioSalidaMetros + 10)); } }, 'Salir')));
    }));
  }

  function animar() {
    const r = recorrido();
    if (!r || r.trazado.length < 2) { registrar('Para recorrer automáticamente, el recorrido necesita un trazado de 2 o más puntos.'); return; }
    rep.desbloquear();
    const total = largoTrazado(r.trazado);
    const vel = 1.4 * Number(velocidad.value); // m/s
    let recorrido_ = 0, t0 = performance.now();
    btnAnim.textContent = '■ Detener recorrido automático';
    registrar(`Recorrido automático iniciado (${fmtDist(total)}, ~${fmtTiempo(total / vel)})`);
    anim = setInterval(() => {
      const t = performance.now();
      recorrido_ += vel * ((t - t0) / 1000); t0 = t;
      if (recorrido_ >= total) { mover(r.trazado[r.trazado.length - 1]); pararAnim(); registrar('Fin del trazado.'); return; }
      mover(puntoEnTrazado(r.trazado, recorrido_));
    }, 500);
  }
  function pararAnim() { if (anim) { clearInterval(anim); anim = null; } btnAnim.textContent = '▶ Recorrer el trazado'; }

  reiniciar(true);
  pista('SIMULACIÓN: tocá el mapa para mover a la persona simulada.');

  return {
    clickMapa(e) { pararAnim(); rep.desbloquear(); mover([e.latlng.lat, e.latlng.lng]); },
    salir() { pararAnim(); rep.vaciar(); rep._desmontarUI?.(); capaSim.remove(); },
  };
}
