// Panel de administración: spots, recorridos, cursos, simulador y proyecto.
/* global L, qrcode */
import { h, $, uid, sanear, slugify, fmtDist, fmtBytes, fmtTiempo, toast, descargar, ahora, esErrorCuota, SLUG_RE } from './util.js';
import * as M from './model.js';
import * as db from './db.js';
import { distanciaMetros, puntoAlEste, largoTrazado } from './geo.js';
import { crearMapa, iconoSpot, encuadrar } from './mapa.js';
import { Grabador, grabacionSoportada, mensajeErrorMicrofono, validarAudio, convertirAWav, prepararImagen, puedeReproducir, avisoCompatibilidad, mimeDeGrabacion } from './media-tools.js';
import { exportarDatos, exportarSitio, leerImportacion, leerPublicado, aplicarImportacion } from './exportar.js';
import { montarSimulador } from './admin-sim.js';
import { registrarSW } from './sw-registro.js';

const st = {
  p: null, tab: 'spots',
  sel: { spot: null, rec: null, curso: null },
  agregando: false, dibujando: false, filtro: '', filtroRec: '',
  ui: {}, sim: null,
};
const panel = $('#panel');
let mapa, capa;
const urlsTemporales = [];

// ---------------- guardado ----------------
let timerGuardar = null, guardando = Promise.resolve();
function guardar() {
  estadoGuardado('Guardando…', '');
  clearTimeout(timerGuardar);
  timerGuardar = setTimeout(guardarYa, 350);
}
async function guardarYa() {
  clearTimeout(timerGuardar);
  st.p.actualizado = ahora();
  guardando = db.guardarProyecto(st.p).then(
    () => estadoGuardado('Guardado ✓', 'ok'),
    (e) => {
      estadoGuardado('Error al guardar', 'error');
      toast(esErrorCuota(e) ? 'Almacenamiento insuficiente: liberá espacio (borrá audios o exportá y limpiá).' : `No se pudo guardar: ${e.message}`, 'error', 9000);
    });
  return guardando;
}
function estadoGuardado(txt, cls) { const e = $('#estadoGuardado'); e.textContent = txt; e.className = `pastilla ${cls ? 'pastilla-' + cls : ''}`; }
addEventListener('beforeunload', (e) => { if (timerGuardar) { guardarYa(); e.preventDefault(); } });

async function limpiarMediosHuerfanos() {
  await guardarYa();
  const refs = M.mediosReferenciados(st.p);
  let n = 0;
  for (const id of await db.listarMedios()) if (!refs.has(id)) { await db.borrarMedio(id); n++; }
  return n;
}

// ---------------- inicio ----------------
async function iniciar() {
  registrarSW();
  try {
    let raw = await db.leerProyecto();
    if (!raw) {
      try {
        const imp = await leerPublicado();
        await aplicarImportacion(imp);
        raw = imp.proyecto;
        toast('Se cargó el contenido publicado (incluye el “Recorrido ejemplo”).', 'info');
      } catch (e) {
        raw = M.nuevoProyecto();
        toast(`No se pudo cargar data/project.json (${e.message}). Empezás con un proyecto vacío.`, 'aviso', 8000);
      }
    }
    const { proyecto, avisos } = M.normalizarProyecto(raw);
    st.p = proyecto;
    avisos.forEach((a) => toast(a, 'aviso', 8000));
    await db.guardarProyecto(st.p);
    estadoGuardado('Guardado ✓', 'ok');
  } catch (e) {
    panel.replaceChildren(h('p', { class: 'banner banner-error', role: 'alert' }, `No se pudo abrir el almacenamiento local: ${e.message}`));
    return;
  }
  navigator.storage?.persist?.().catch(() => {});
  mapa = crearMapa($('#mapa'), st.p.ajustes, { doubleClickZoom: false });
  $('#mapa').addEventListener('tiles-error', () => toast('No se pudieron cargar algunos mosaicos del mapa (¿sin conexión?).', 'aviso'));
  capa = L.layerGroup().addTo(mapa);
  mapa.on('click', (e) => controladores[st.tab].clickMapa?.(e));
  const pts = st.p.spots.map((s) => [s.lat, s.lng]);
  encuadrar(mapa, pts);
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => cambiarTab(b.dataset.tab)));
  $('.pestanas').addEventListener('keydown', (e) => {
    const tabs = [...document.querySelectorAll('[data-tab]')], i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; n.focus(); cambiarTab(n.dataset.tab); }
  });
  const hash = location.hash.slice(1);
  cambiarTab(controladores[hash] ? hash : 'spots');
}

function cambiarTab(tab) {
  if (tab === st.tab) { // tocar la pestaña activa vuelve a la lista
    if (tab === 'spots') st.sel.spot = null;
    if (tab === 'recorridos') st.sel.rec = null;
    if (tab === 'cursos') st.sel.curso = null;
  }
  controladores[st.tab]?.salir?.();
  st.tab = tab; st.agregando = false; st.dibujando = false;
  history.replaceState(null, '', `#${tab}`);
  document.querySelectorAll('[data-tab]').forEach((b) => {
    const activo = b.dataset.tab === tab;
    b.setAttribute('aria-selected', activo); b.tabIndex = activo ? 0 : -1;
  });
  panel.setAttribute('aria-labelledby', `tab-${tab}`);
  $('#insigniaSim').hidden = tab !== 'simulador';
  render();
}

function render() {
  urlsTemporales.splice(0).forEach((u) => URL.revokeObjectURL(u));
  capa.clearLayers();
  pista('');
  controladores[st.tab].render();
}
function pista(txt) { const p = $('#pistaMapa'); p.hidden = !txt; p.textContent = txt; }
function urlTemporal(blob) { const u = URL.createObjectURL(blob); urlsTemporales.push(u); return u; }

// ---------------- helpers de formulario ----------------
let nCampo = 0;
function campo(etiqueta, control, ayuda) {
  const id = control.id || `c${++nCampo}`;
  control.id = id;
  const idAyuda = ayuda ? `${id}-ayuda` : null;
  if (idAyuda) control.setAttribute('aria-describedby', idAyuda);
  return h('div', { class: 'campo' }, h('label', { for: id }, etiqueta), control, ayuda ? h('small', { id: idAyuda, class: 'ayuda' }, ayuda) : null);
}
function marcarError(control, msj) {
  control.setAttribute('aria-invalid', msj ? 'true' : 'false');
  let e = control.parentElement.querySelector('.error-campo');
  if (!e) { e = h('small', { class: 'error-campo', role: 'alert' }); control.after(e); }
  e.textContent = msj || '';
}
const confirmar = (msj) => window.confirm(msj);
const numero = (v) => Number(String(v).replace(',', '.'));

// ======================================================================
// SPOTS
// ======================================================================
const spots = {
  render() {
    const s = st.sel.spot && M.buscarSpot(st.p, st.sel.spot);
    if (s) editorSpot(s); else bibliotecaSpots();
    mapaSpots();
  },
  clickMapa(e) {
    if (!st.agregando) return;
    crearSpotEn(e.latlng.lat, e.latlng.lng);
  },
  salir() { st.ui.grabador?.cancelar(); },
};

function crearSpotEn(lat, lng) {
  const s = M.nuevoSpot(lat, lng, `Spot ${st.p.spots.length + 1}`);
  st.p.spots.push(s);
  st.agregando = false; st.sel.spot = s.id;
  guardar(); render();
  toast('Spot creado. Completá título, texto y audio.', 'ok');
  $('#spotTitulo')?.focus();
}

function bibliotecaSpots() {
  const lista = h('ul', { class: 'lista-items', id: 'listaSpotsAdmin' });
  const pintar = () => {
    const f = st.filtro.toLowerCase();
    const items = st.p.spots.filter((s) => !f || s.titulo.toLowerCase().includes(f) || s.texto.toLowerCase().includes(f));
    lista.replaceChildren(...items.map((s) => {
      const recs = M.recorridosQueUsan(st.p, s.id).length;
      return h('li', {}, h('button', { type: 'button', class: 'item', onclick: () => { st.sel.spot = s.id; render(); } },
        h('strong', {}, s.titulo),
        h('small', {}, [`entrada ${s.radioEntradaMetros} m / salida ${s.radioSalidaMetros} m`, s.audio ? '🔊 audio' : 'sin audio', `${recs} recorrido(s)`, s.habilitado ? null : 'deshabilitado'].filter(Boolean).join(' · '))));
    }));
    if (!items.length) lista.append(h('li', { class: 'nota' }, st.p.spots.length ? 'Ningún spot coincide con la búsqueda.' : 'Todavía no hay spots.'));
  };
  const btnAgregar = h('button', { type: 'button', class: `btn ${st.agregando ? 'btn-activo' : 'btn-primario'}`, 'aria-pressed': String(st.agregando), onclick: () => { st.agregando = !st.agregando; render(); } },
    st.agregando ? 'Cancelar: tocá el mapa para ubicar el spot' : '+ Nuevo spot (tocá el mapa)');
  panel.replaceChildren(
    h('h2', {}, `Biblioteca de spots (${st.p.spots.length})`),
    h('p', { class: 'ayuda' }, 'Los spots son independientes: un mismo spot puede estar en varios recorridos y se edita una sola vez.'),
    h('div', { class: 'fila' }, btnAgregar,
      h('button', { type: 'button', class: 'btn', onclick: () => { const c = mapa.getCenter(); crearSpotEn(c.lat, c.lng); } }, '+ En el centro del mapa')),
    campo('Buscar', h('input', { type: 'search', value: st.filtro, placeholder: 'Título o texto…', oninput: (e) => { st.filtro = e.target.value; pintar(); } })),
    lista,
  );
  pintar();
  if (st.agregando) pista('Tocá el mapa donde querés crear el spot.');
}

function mapaSpots() {
  st.ui.circulos = null;
  const sel = st.sel.spot;
  for (const s of st.p.spots) {
    const esSel = s.id === sel;
    if (esSel) continue;
    L.circle([s.lat, s.lng], { radius: s.radioEntradaMetros, color: '#64748b', weight: 1, fillOpacity: 0.05, interactive: false }).addTo(capa);
    L.marker([s.lat, s.lng], { icon: iconoSpot('•', s.habilitado ? '' : 'spot-off'), title: s.titulo, keyboard: true })
      .on('click', () => { st.sel.spot = s.id; render(); }).addTo(capa);
  }
  const s = sel && M.buscarSpot(st.p, sel);
  if (!s) return;
  const salida = L.circle([s.lat, s.lng], { radius: s.radioSalidaMetros, color: '#c2410c', weight: 1, dashArray: '6 6', fill: false, interactive: false }).addTo(capa);
  const entrada = L.circle([s.lat, s.lng], { radius: s.radioEntradaMetros, color: '#c2410c', weight: 2, fillOpacity: 0.15, interactive: false }).addTo(capa);
  const manija = L.marker(puntoAlEste(s.lat, s.lng, s.radioEntradaMetros), { icon: L.divIcon({ className: 'manija', iconSize: [18, 18] }), draggable: true, title: 'Arrastrá para cambiar el radio de entrada', keyboard: false }).addTo(capa);
  const m = L.marker([s.lat, s.lng], { icon: iconoSpot('✓', 'spot-sel'), draggable: true, title: `${s.titulo} (arrastrá para mover)`, zIndexOffset: 1000 }).addTo(capa);
  m.on('drag', (e) => {
    const { lat, lng } = e.target.getLatLng();
    entrada.setLatLng([lat, lng]); salida.setLatLng([lat, lng]);
    manija.setLatLng(puntoAlEste(lat, lng, s.radioEntradaMetros));
  });
  m.on('dragend', (e) => {
    const { lat, lng } = e.target.getLatLng();
    s.lat = M.redondear(lat); s.lng = M.redondear(lng); s.actualizado = ahora();
    if (st.ui.lat) { st.ui.lat.value = s.lat; st.ui.lng.value = s.lng; marcarError(st.ui.lat, ''); marcarError(st.ui.lng, ''); }
    guardar();
  });
  manija.on('drag', (e) => {
    const ll = e.target.getLatLng();
    const r = Math.round(Math.min(M.LIMITES.radioMax, Math.max(M.LIMITES.radioMin, distanciaMetros(s.lat, s.lng, ll.lat, ll.lng))));
    aplicarRadio(s, r, false);
    entrada.setRadius(s.radioEntradaMetros); salida.setRadius(s.radioSalidaMetros);
  });
  manija.on('dragend', () => { manija.setLatLng(puntoAlEste(s.lat, s.lng, s.radioEntradaMetros)); guardar(); });
  st.ui.circulos = { entrada, salida, manija, m };
}

function aplicarRadio(s, r, persistir = true) {
  s.radioEntradaMetros = r;
  if (s.radioSalidaMetros <= r) s.radioSalidaMetros = Math.min(M.LIMITES.salidaMax, M.salidaSugerida(r));
  s.actualizado = ahora();
  if (st.ui.entrada) { st.ui.entrada.value = r; st.ui.entradaRango.value = Math.min(300, r); st.ui.salida.value = s.radioSalidaMetros; marcarError(st.ui.salida, ''); }
  if (st.ui.circulos) {
    st.ui.circulos.entrada.setRadius(r); st.ui.circulos.salida.setRadius(s.radioSalidaMetros);
    st.ui.circulos.manija.setLatLng(puntoAlEste(s.lat, s.lng, r));
  }
  if (persistir) guardar();
}

function editorSpot(s) {
  const tocar = () => { s.actualizado = ahora(); guardar(); };
  const titulo = h('input', { id: 'spotTitulo', type: 'text', value: s.titulo, maxlength: M.LIMITES.tituloMax, required: true,
    oninput: (e) => { const v = sanear(e.target.value, M.LIMITES.tituloMax); marcarError(titulo, v.trim() ? '' : 'El título no puede estar vacío.'); if (v.trim()) { s.titulo = v; tocar(); $('#spotH2').textContent = v; } } });
  const coord = (k) => h('input', { type: 'text', inputmode: 'decimal', value: s[k],
    onchange: (e) => {
      const v = numero(e.target.value);
      const err = k === 'lat' ? M.validarCoord(v, 0)[0] : M.validarCoord(0, v)[0];
      marcarError(e.target, err || '');
      if (!err) { s[k] = M.redondear(v); tocar(); render(); }
    } });
  st.ui.lat = coord('lat'); st.ui.lng = coord('lng');
  st.ui.entradaRango = h('input', { type: 'range', min: 5, max: 300, step: 1, value: Math.min(300, s.radioEntradaMetros), 'aria-label': 'Radio de entrada (deslizador)',
    oninput: (e) => aplicarRadio(s, Number(e.target.value)) });
  st.ui.entrada = h('input', { type: 'number', min: M.LIMITES.radioMin, max: M.LIMITES.radioMax, step: 1, value: s.radioEntradaMetros, inputmode: 'numeric',
    onchange: (e) => {
      const v = Math.round(numero(e.target.value));
      if (!(v >= M.LIMITES.radioMin && v <= M.LIMITES.radioMax)) return marcarError(e.target, `Entre ${M.LIMITES.radioMin} y ${M.LIMITES.radioMax} m.`);
      marcarError(e.target, ''); aplicarRadio(s, v);
    } });
  st.ui.salida = h('input', { type: 'number', min: 6, max: M.LIMITES.salidaMax, step: 1, value: s.radioSalidaMetros, inputmode: 'numeric',
    onchange: (e) => {
      const v = Math.round(numero(e.target.value));
      if (!(v > s.radioEntradaMetros && v <= M.LIMITES.salidaMax)) return marcarError(e.target, `Debe ser mayor que el radio de entrada (${s.radioEntradaMetros} m) y como máximo ${M.LIMITES.salidaMax} m.`);
      marcarError(e.target, ''); s.radioSalidaMetros = v; st.ui.circulos?.salida.setRadius(v); tocar();
    } });
  const texto = h('textarea', { rows: 8, maxlength: M.LIMITES.textoMax, value: s.texto, oninput: (e) => { s.texto = sanear(e.target.value, M.LIMITES.textoMax); tocar(); } });
  const habil = h('input', { type: 'checkbox', checked: s.habilitado, onchange: (e) => { s.habilitado = e.target.checked; tocar(); } });
  const recs = M.recorridosQueUsan(st.p, s.id);

  panel.replaceChildren(
    h('button', { type: 'button', class: 'btn', onclick: () => { st.sel.spot = null; render(); } }, '← Biblioteca de spots'),
    h('h2', { id: 'spotH2' }, s.titulo),
    h('p', { class: 'ayuda' }, recs.length ? `Usado en: ${recs.map((r) => r.titulo).join(', ')}. Los cambios se reflejan en todos.` : 'Este spot todavía no está en ningún recorrido.'),
    campo('Título', titulo),
    h('div', { class: 'fila' }, campo('Latitud', st.ui.lat), campo('Longitud', st.ui.lng)),
    h('div', { class: 'fila' },
      h('button', { type: 'button', class: 'btn btn-chico', onclick: () => mapa.setView([s.lat, s.lng], Math.max(17, mapa.getZoom())) }, '◎ Centrar en el mapa'),
      h('button', { type: 'button', class: 'btn btn-chico', onclick: () => { const c = mapa.getCenter(); s.lat = M.redondear(c.lat); s.lng = M.redondear(c.lng); tocar(); render(); } }, 'Mover al centro del mapa')),
    h('p', { class: 'ayuda' }, 'También podés arrastrar el marcador ✓ en el mapa, y la manija blanca para cambiar el radio.'),
    h('div', { class: 'campo' }, h('label', { for: 'radioEntrada' }, 'Radio de entrada (m)'),
      h('div', { class: 'fila' }, st.ui.entradaRango, Object.assign(st.ui.entrada, { id: 'radioEntrada' })),
      h('small', { class: 'ayuda' }, 'Al entrar en este círculo se activa el audio. Recomendado: 15–40 m (el GPS tiene error).')),
    campo('Radio de salida (m)', st.ui.salida, 'Debe ser mayor que el de entrada. El spot recién puede volver a activarse después de salir de este círculo (evita disparos repetidos por el ruido del GPS).'),
    campo('Texto / guion (siempre visible para el estudiante)', texto),
    h('label', { class: 'check' }, habil, ' Spot habilitado (si lo deshabilitás, no se muestra ni se activa)'),
    seccionAudio(s),
    seccionImagen(s),
    h('div', { class: 'fila acciones' },
      h('button', { type: 'button', class: 'btn', onclick: () => duplicarSpot(s) }, 'Duplicar'),
      h('button', { type: 'button', class: 'btn btn-peligro', onclick: () => eliminarSpot(s) }, 'Eliminar spot')),
  );
}

function duplicarSpot(s) {
  const c = { ...structuredClone(s), id: uid('spot'), titulo: `${s.titulo} (copia)`.slice(0, M.LIMITES.tituloMax), lat: M.redondear(s.lat + 0.0002), creado: ahora(), actualizado: ahora() };
  st.p.spots.push(c); st.sel.spot = c.id; guardar(); render();
  toast('Spot duplicado (comparte los mismos archivos de audio/imagen hasta que los cambies).', 'ok');
}

async function eliminarSpot(s) {
  const recs = M.recorridosQueUsan(st.p, s.id);
  const msj = recs.length ? `“${s.titulo}” está en ${recs.length} recorrido(s): ${recs.map((r) => r.titulo).join(', ')}.\nSe va a quitar de todos. ¿Eliminar?` : `¿Eliminar “${s.titulo}”?`;
  if (!confirmar(msj)) return;
  st.ui.grabador?.cancelar();
  st.p.spots = st.p.spots.filter((x) => x.id !== s.id);
  for (const r of recs) r.spotIds = r.spotIds.filter((id) => id !== s.id);
  st.sel.spot = null;
  await limpiarMediosHuerfanos();
  render(); toast('Spot eliminado.', 'ok');
}

// ---------- audio de un spot ----------
async function asignarMedio(s, campo, blob, mime, nombre) {
  const id = uid(campo === 'audio' ? 'audio' : 'img');
  try { await db.guardarMedio(id, blob, mime, nombre); }
  catch (e) { toast(esErrorCuota(e) ? 'No hay espacio suficiente en el almacenamiento del navegador.' : `No se pudo guardar el archivo: ${e.message}`, 'error', 9000); return false; }
  s[campo] = { id, ext: M.extDeMime(mime, nombre), mime: M.mimeBase(mime), nombre: sanear(nombre, 200), bytes: blob.size };
  s.actualizado = ahora();
  await limpiarMediosHuerfanos();
  render();
  return true;
}

function seccionAudio(s) {
  const cont = h('section', { class: 'subseccion', 'aria-labelledby': 'tituloAudio' }, h('h3', { id: 'tituloAudio' }, 'Audio'));
  if (s.audio) {
    const reproductor = h('audio', { controls: true, preload: 'metadata', class: 'audio-admin' });
    db.leerMedio(s.audio.id).then((b) => { if (b) reproductor.src = urlTemporal(b); else cont.append(h('p', { class: 'banner banner-error' }, 'El archivo de audio no está en este navegador. Volvé a subirlo.')); });
    const avisos = [];
    if (puedeReproducir(s.audio.mime) === '') avisos.push('Este navegador no puede reproducir este formato.');
    const ac = avisoCompatibilidad(s.audio.mime); if (ac) avisos.push(ac);
    cont.append(reproductor,
      h('p', { class: 'ayuda' }, `${s.audio.nombre || 'audio'} · ${s.audio.ext.toUpperCase()} · ${fmtBytes(s.audio.bytes)}`),
      ...avisos.map((a) => h('p', { class: 'banner banner-aviso' }, a)),
      h('div', { class: 'fila' },
        s.audio.ext !== 'wav' && s.audio.ext !== 'mp3' ? h('button', { type: 'button', class: 'btn btn-chico', onclick: async (e) => {
          e.target.disabled = true; e.target.textContent = 'Convirtiendo…';
          try {
            const wav = await convertirAWav(await db.leerMedio(s.audio.id));
            await asignarMedio(s, 'audio', wav, 'audio/wav', (s.audio.nombre || 'audio').replace(/\.[^.]+$/, '') + '.wav');
            toast(`Convertido a WAV (${fmtBytes(wav.size)}).`, 'ok');
          } catch (err) { toast(err.message, 'error'); e.target.disabled = false; e.target.textContent = 'Convertir a WAV'; }
        } }, 'Convertir a WAV (compatible con todos)') : null,
        h('button', { type: 'button', class: 'btn btn-chico btn-peligro', onclick: async () => { if (!confirmar('¿Quitar el audio de este spot?')) return; s.audio = null; s.actualizado = ahora(); await limpiarMediosHuerfanos(); render(); } }, 'Quitar audio')));
  } else cont.append(h('p', { class: 'nota' }, 'Sin audio. El estudiante igual verá el texto.'));

  const archivo = h('input', { type: 'file', accept: 'audio/*,.mp3,.m4a,.aac,.wav,.ogg,.oga,.webm', class: 'visually-hidden', id: 'subirAudio',
    onchange: async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try {
        const v = await validarAudio(f);
        if (await asignarMedio(s, 'audio', f, v.mime, f.name)) {
          toast(`Audio cargado${v.duracion ? ` (${fmtTiempo(v.duracion)})` : ''}.`, 'ok');
          v.avisos.forEach((a) => toast(a, 'aviso', 9000));
        }
      } catch (err) { toast(err.message, 'error', 9000); }
    } });
  cont.append(h('div', { class: 'fila' }, archivo, h('label', { for: 'subirAudio', class: 'btn', tabindex: 0, role: 'button', onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); archivo.click(); } } }, s.audio ? '⤒ Reemplazar con archivo' : '⤒ Subir archivo de audio')),
    h('small', { class: 'ayuda' }, `MP3, M4A, WAV, OGG o WebM. Máximo ${fmtBytes(M.LIMITES.audioMaxBytes)}.`));
  cont.append(grabadorUI(s));
  return cont;
}

function grabadorUI(s) {
  const caja = h('div', { class: 'grabador', 'aria-live': 'polite' });
  const soporte = grabacionSoportada();
  if (!soporte.ok) { caja.append(h('p', { class: 'nota' }, `Grabar: ${soporte.motivo} Podés subir un archivo grabado con otra app.`)); return caja; }
  const formato = mimeDeGrabacion() || 'formato por defecto del navegador';
  const inicial = () => caja.replaceChildren(
    h('button', { type: 'button', class: 'btn', onclick: grabar }, '🎙 Grabar con el micrófono'),
    h('small', { class: 'ayuda' }, `Este navegador grabará en: ${formato}. Te va a pedir permiso para usar el micrófono.`));
  async function grabar() {
    const reloj = h('span', { class: 'reloj' }, '0:00');
    const g = new Grabador({ onTick: (seg) => { reloj.textContent = fmtTiempo(seg); } });
    st.ui.grabador = g;
    caja.replaceChildren(h('p', {}, 'Pidiendo permiso del micrófono…'));
    try { await g.iniciar(); }
    catch (e) { st.ui.grabador = null; inicial(); toast(e.name ? mensajeErrorMicrofono(e) : e.message, 'error', 9000); return; }
    const detener = h('button', { type: 'button', class: 'btn btn-peligro', onclick: async () => {
      try { revisar(await g.detener()); } catch (e) { toast(e.message, 'error'); inicial(); }
      st.ui.grabador = null;
    } }, '■ Detener');
    caja.replaceChildren(h('p', { class: 'grabando' }, h('span', { class: 'punto-rojo', 'aria-hidden': 'true' }), ' Grabando… ', reloj), h('div', { class: 'fila' }, detener,
      h('button', { type: 'button', class: 'btn', onclick: () => { g.cancelar(); st.ui.grabador = null; inicial(); } }, 'Cancelar')));
    detener.focus();
  }
  function revisar(blob) {
    const a = h('audio', { controls: true, src: urlTemporal(blob), class: 'audio-admin' });
    caja.replaceChildren(h('p', {}, `Grabación lista (${fmtBytes(blob.size)}). Escuchala antes de guardar:`), a,
      h('div', { class: 'fila' },
        h('button', { type: 'button', class: 'btn btn-primario', onclick: async () => {
          const ext = M.extDeMime(blob.type);
          if (await asignarMedio(s, 'audio', blob, blob.type, `grabacion-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${ext}`)) {
            toast('Grabación guardada en el spot.', 'ok');
            const ac = avisoCompatibilidad(blob.type); if (ac) toast(ac, 'aviso', 9000);
          }
        } }, '✓ Guardar en el spot'),
        h('button', { type: 'button', class: 'btn', onclick: () => { if (confirmar('¿Descartar esta grabación?')) inicial(); } }, 'Descartar')));
  }
  inicial();
  return caja;
}

function seccionImagen(s) {
  const cont = h('section', { class: 'subseccion' }, h('h3', {}, 'Imagen (opcional)'));
  if (s.imagen) {
    const img = h('img', { alt: `Imagen de ${s.titulo}`, class: 'img-admin' });
    db.leerMedio(s.imagen.id).then((b) => { if (b) img.src = urlTemporal(b); });
    cont.append(img, h('p', { class: 'ayuda' }, `${s.imagen.ext.toUpperCase()} · ${fmtBytes(s.imagen.bytes)}`),
      h('button', { type: 'button', class: 'btn btn-chico btn-peligro', onclick: async () => { s.imagen = null; s.actualizado = ahora(); await limpiarMediosHuerfanos(); render(); } }, 'Quitar imagen'));
  }
  const input = h('input', { type: 'file', accept: 'image/*', id: 'subirImagen', class: 'visually-hidden', onchange: async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { const { blob, mime } = await prepararImagen(f); if (await asignarMedio(s, 'imagen', blob, mime, f.name)) toast('Imagen cargada.', 'ok'); }
    catch (err) { toast(err.message, 'error'); }
  } });
  cont.append(input, h('label', { for: 'subirImagen', class: 'btn', tabindex: 0, role: 'button', onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } } }, s.imagen ? '⤒ Reemplazar imagen' : '⤒ Subir imagen'),
    h('small', { class: 'ayuda' }, 'Las imágenes grandes se reducen a 1600 px automáticamente.'));
  return cont;
}

// ======================================================================
// RECORRIDOS
// ======================================================================
const recorridos = {
  render() {
    const r = st.sel.rec && M.buscarRecorrido(st.p, st.sel.rec);
    if (r) { editorRecorrido(r); mapaRecorrido(r); }
    else { bibliotecaRecorridos(); mapaTodosRecorridos(); }
  },
  clickMapa(e) {
    const r = st.sel.rec && M.buscarRecorrido(st.p, st.sel.rec);
    if (!r || !st.dibujando) return;
    r.trazado.push([M.redondear(e.latlng.lat), M.redondear(e.latlng.lng)]);
    r.actualizado = ahora(); guardar(); render();
  },
};

function bibliotecaRecorridos() {
  panel.replaceChildren(
    h('h2', {}, `Recorridos (${st.p.recorridos.length})`),
    h('button', { type: 'button', class: 'btn btn-primario', onclick: () => {
      const r = M.nuevoRecorrido(`Recorrido ${st.p.recorridos.length + 1}`);
      st.p.recorridos.push(r); st.sel.rec = r.id; st.dibujando = true; guardar(); render();
      toast('Recorrido creado. Tocá el mapa para dibujar el trazado.', 'ok');
    } }, '+ Nuevo recorrido'),
    h('ul', { class: 'lista-items' }, st.p.recorridos.length ? st.p.recorridos.map((r) => h('li', {},
      h('button', { type: 'button', class: 'item', onclick: () => { st.sel.rec = r.id; render(); } },
        h('strong', {}, r.titulo), h('small', {}, `${r.estado} · ${r.spotIds.length} spot(s) · ${r.trazado.length} punto(s) de trazado · ${M.cursosQueUsan(st.p, r.id).length} curso(s)`)))) : h('li', { class: 'nota' }, 'Todavía no hay recorridos.')),
  );
}

function mapaTodosRecorridos() {
  const colores = ['#1f5f4a', '#7c3aed', '#c2410c', '#0369a1', '#be123c'];
  st.p.recorridos.forEach((r, i) => {
    if (r.trazado.length > 1) L.polyline(r.trazado, { color: colores[i % colores.length], weight: 4 }).bindTooltip(r.titulo).on('click', () => { st.sel.rec = r.id; render(); }).addTo(capa);
  });
  st.p.spots.forEach((s) => L.marker([s.lat, s.lng], { icon: iconoSpot('•'), title: s.titulo }).addTo(capa));
}

function editorRecorrido(r) {
  const tocar = () => { r.actualizado = ahora(); guardar(); };
  const titulo = h('input', { type: 'text', value: r.titulo, maxlength: M.LIMITES.tituloMax, oninput: (e) => { const v = sanear(e.target.value, M.LIMITES.tituloMax); marcarError(titulo, v.trim() ? '' : 'El título no puede estar vacío.'); if (v.trim()) { r.titulo = v; tocar(); } } });
  const desc = h('textarea', { rows: 3, maxlength: M.LIMITES.descripcionMax, value: r.descripcion, oninput: (e) => { r.descripcion = sanear(e.target.value, M.LIMITES.descripcionMax); tocar(); } });
  const estado = h('select', { onchange: (e) => { r.estado = e.target.value; tocar(); } },
    h('option', { value: 'borrador', selected: r.estado === 'borrador' }, 'Borrador (no lo ven los estudiantes)'),
    h('option', { value: 'publicado', selected: r.estado === 'publicado' }, 'Publicado'));
  const enRuta = r.spotIds.map((id) => M.buscarSpot(st.p, id)).filter(Boolean);
  const mover = (i, d) => { const a = r.spotIds; [a[i], a[i + d]] = [a[i + d], a[i]]; tocar(); render(); setTimeout(() => document.querySelector(`[data-orden="${i + d}"]`)?.focus(), 0); };
  const listaDisp = h('ul', { class: 'lista-items compacta' });
  const pintarDisp = () => {
    const f = st.filtroRec.toLowerCase();
    const disp = st.p.spots.filter((s) => !r.spotIds.includes(s.id) && (!f || s.titulo.toLowerCase().includes(f)));
    listaDisp.replaceChildren(...disp.map((s) => h('li', { class: 'fila-item' }, h('span', {}, s.titulo, M.recorridosQueUsan(st.p, s.id).length ? h('small', {}, ` · en ${M.recorridosQueUsan(st.p, s.id).length} recorrido(s)`) : null),
      h('button', { type: 'button', class: 'btn btn-chico', onclick: () => { r.spotIds.push(s.id); tocar(); render(); } }, '+ Agregar'))));
    if (!disp.length) listaDisp.append(h('li', { class: 'nota' }, 'No hay más spots disponibles. Crealos en la pestaña Spots.'));
  };
  const largo = largoTrazado(r.trazado);

  panel.replaceChildren(
    h('button', { type: 'button', class: 'btn', onclick: () => { st.sel.rec = null; st.dibujando = false; render(); } }, '← Recorridos'),
    h('h2', {}, r.titulo),
    campo('Título', titulo), campo('Descripción (opcional)', desc), campo('Estado', estado),
    h('section', { class: 'subseccion' },
      h('h3', {}, 'Trazado'),
      h('p', { class: 'ayuda' }, `${r.trazado.length} punto(s) · ${fmtDist(largo)}. Dibujo manual: no se ajusta a calles. Arrastrá los vértices para moverlos; tocá un vértice para eliminarlo; tocá un “+” intermedio para insertar un punto.`),
      h('div', { class: 'fila' },
        h('button', { type: 'button', class: `btn ${st.dibujando ? 'btn-activo' : 'btn-primario'}`, 'aria-pressed': String(st.dibujando), onclick: () => { st.dibujando = !st.dibujando; render(); } }, st.dibujando ? '✓ Terminar de dibujar' : '✏ Dibujar (tocá el mapa)'),
        h('button', { type: 'button', class: 'btn', disabled: !r.trazado.length, onclick: () => { r.trazado.pop(); tocar(); render(); } }, 'Deshacer último punto'),
        h('button', { type: 'button', class: 'btn btn-peligro', disabled: !r.trazado.length, onclick: () => { if (confirmar('¿Borrar todo el trazado? (Los spots no se borran.)')) { r.trazado = []; tocar(); render(); } } }, 'Borrar trazado'))),
    h('section', { class: 'subseccion' },
      h('h3', {}, `Spots del recorrido, en orden (${enRuta.length})`),
      h('p', { class: 'ayuda' }, 'Los spots son compartidos: quitarlos de este recorrido no los borra de la biblioteca ni de otros recorridos.'),
      h('ol', { class: 'lista-orden' }, enRuta.map((s, i) => h('li', {},
        h('span', { class: 'num' }, i + 1), h('span', { class: 'crece' }, s.titulo),
        h('button', { type: 'button', class: 'btn btn-chico', 'data-orden': i, disabled: i === 0, 'aria-label': `Subir ${s.titulo}`, onclick: () => mover(i, -1) }, '↑'),
        h('button', { type: 'button', class: 'btn btn-chico', disabled: i === enRuta.length - 1, 'aria-label': `Bajar ${s.titulo}`, onclick: () => mover(i, 1) }, '↓'),
        h('button', { type: 'button', class: 'btn btn-chico', 'aria-label': `Editar ${s.titulo}`, onclick: () => { st.sel.spot = s.id; cambiarTab('spots'); } }, 'Editar'),
        h('button', { type: 'button', class: 'btn btn-chico', 'aria-label': `Quitar ${s.titulo} del recorrido`, onclick: () => { r.spotIds = r.spotIds.filter((x) => x !== s.id); tocar(); render(); } }, '✕')))),
      h('h4', {}, 'Agregar desde la biblioteca'),
      campo('Buscar spot', h('input', { type: 'search', value: st.filtroRec, oninput: (e) => { st.filtroRec = e.target.value; pintarDisp(); } })),
      listaDisp),
    h('div', { class: 'fila acciones' },
      h('a', { class: 'btn', href: `./?fuente=local&recorrido=${encodeURIComponent(r.id)}`, target: '_blank', rel: 'noopener' }, 'Vista previa (estudiante)'),
      h('button', { type: 'button', class: 'btn', onclick: () => {
        const c = { ...structuredClone(r), id: uid('rec'), titulo: `${r.titulo} (copia)`.slice(0, M.LIMITES.tituloMax), estado: 'borrador', creado: ahora(), actualizado: ahora() };
        st.p.recorridos.push(c); st.sel.rec = c.id; guardar(); render(); toast('Recorrido duplicado (usa los mismos spots, no copias).', 'ok');
      } }, 'Duplicar'),
      h('button', { type: 'button', class: 'btn btn-peligro', onclick: () => {
        const cursos = M.cursosQueUsan(st.p, r.id);
        if (!confirmar(`¿Eliminar el recorrido “${r.titulo}”?${cursos.length ? `\nSe quitará de ${cursos.length} curso(s).` : ''}\nLos spots NO se eliminan.`)) return;
        st.p.recorridos = st.p.recorridos.filter((x) => x.id !== r.id);
        cursos.forEach((c) => { c.recorridoIds = c.recorridoIds.filter((x) => x !== r.id); });
        st.sel.rec = null; guardar(); render(); toast('Recorrido eliminado. Los spots siguen en la biblioteca.', 'ok');
      } }, 'Eliminar recorrido')),
  );
  pintarDisp();
  if (st.dibujando) pista('Dibujando: tocá el mapa para agregar puntos al final del trazado.');
}

function mapaRecorrido(r) {
  const tocar = () => { r.actualizado = ahora(); guardar(); };
  st.p.spots.forEach((s) => {
    const i = r.spotIds.indexOf(s.id);
    if (i >= 0) {
      L.circle([s.lat, s.lng], { radius: s.radioEntradaMetros, color: '#c2410c', weight: 1, fillOpacity: 0.1, interactive: false }).addTo(capa);
      L.marker([s.lat, s.lng], { icon: iconoSpot(i + 1), title: s.titulo }).bindTooltip(s.titulo).addTo(capa);
    } else {
      const btn = h('button', { type: 'button', class: 'btn btn-chico', onclick: () => { r.spotIds.push(s.id); tocar(); render(); } }, '+ Agregar al recorrido');
      L.marker([s.lat, s.lng], { icon: iconoSpot('•', 'spot-gris'), title: `${s.titulo} (no está en el recorrido)` })
        .bindPopup(h('div', {}, h('strong', {}, s.titulo), h('br'), btn)).addTo(capa);
    }
  });
  if (r.trazado.length > 1) L.polyline(r.trazado, { color: '#1f5f4a', weight: 5, opacity: 0.85, interactive: false }).addTo(capa);
  r.trazado.forEach((pt, i) => {
    const v = L.marker(pt, { icon: L.divIcon({ className: 'vertice', iconSize: [16, 16] }), draggable: true, title: `Punto ${i + 1} del trazado`, zIndexOffset: 500 }).addTo(capa);
    v.on('dragend', (e) => { const ll = e.target.getLatLng(); r.trazado[i] = [M.redondear(ll.lat), M.redondear(ll.lng)]; tocar(); render(); });
    v.bindPopup(h('div', {}, `Punto ${i + 1}`, h('br'), h('button', { type: 'button', class: 'btn btn-chico btn-peligro', onclick: () => { r.trazado.splice(i, 1); tocar(); render(); } }, 'Eliminar punto')));
    if (i > 0) {
      const a = r.trazado[i - 1];
      L.marker([(a[0] + pt[0]) / 2, (a[1] + pt[1]) / 2], { icon: L.divIcon({ className: 'vertice-medio', html: '+', iconSize: [14, 14] }), title: 'Insertar punto aquí' })
        .on('click', (e) => { L.DomEvent.stopPropagation(e); r.trazado.splice(i, 0, [M.redondear((a[0] + pt[0]) / 2), M.redondear((a[1] + pt[1]) / 2)]); tocar(); render(); }).addTo(capa);
    }
  });
  if (!st.ui.encuadrado || st.ui.encuadrado !== r.id) {
    st.ui.encuadrado = r.id;
    encuadrar(mapa, [...r.trazado, ...r.spotIds.map((id) => M.buscarSpot(st.p, id)).filter(Boolean).map((s) => [s.lat, s.lng])]);
  }
}

// ======================================================================
// CURSOS
// ======================================================================
function baseUrl() {
  const b = st.p.ajustes.urlPublica || location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, '');
  return b.endsWith('/') ? b : `${b}/`;
}
export const urlCurso = (c) => `${baseUrl()}?curso=${encodeURIComponent(c.enlaceId)}`;

const cursos = {
  render() {
    const c = st.sel.curso && st.p.cursos.find((x) => x.id === st.sel.curso);
    if (c) editorCurso(c); else listaCursos();
    const recs = c ? c.recorridoIds.map((id) => M.buscarRecorrido(st.p, id)).filter(Boolean) : st.p.recorridos;
    recs.forEach((r) => { if (r.trazado.length > 1) L.polyline(r.trazado, { color: '#1f5f4a', weight: 4 }).bindTooltip(r.titulo).addTo(capa); });
  },
};

function listaCursos() {
  panel.replaceChildren(
    h('h2', {}, `Cursos (${st.p.cursos.length})`),
    h('p', { class: 'ayuda' }, 'Cada curso tiene su propio enlace/QR con los recorridos que le asignes. Un recorrido puede estar en varios cursos.'),
    h('button', { type: 'button', class: 'btn btn-primario', onclick: () => {
      const c = M.nuevoCurso(st.p, `Curso ${st.p.cursos.length + 1}`);
      st.p.cursos.push(c); st.sel.curso = c.id; guardar(); render();
    } }, '+ Nuevo curso'),
    h('ul', { class: 'lista-items' }, st.p.cursos.length ? st.p.cursos.map((c) => h('li', {},
      h('button', { type: 'button', class: 'item', onclick: () => { st.sel.curso = c.id; render(); } },
        h('strong', {}, c.nombre), h('small', {}, `?curso=${c.enlaceId} · ${c.recorridoIds.length} recorrido(s)`)))) : h('li', { class: 'nota' }, 'Todavía no hay cursos.')),
  );
}

function dibujarQR(texto) {
  const qr = qrcode(0, 'M'); qr.addData(texto); qr.make();
  const n = qr.getModuleCount(), escala = 8, margen = 4 * escala;
  const c = document.createElement('canvas');
  c.width = c.height = n * escala + margen * 2;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.fillStyle = '#000';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) ctx.fillRect(margen + x * escala, margen + y * escala, escala, escala);
  return c;
}

function editorCurso(c) {
  const tocar = () => { c.actualizado = ahora(); guardar(); };
  const contEnlace = h('div', { class: 'enlace-curso' });
  const pintarEnlace = () => {
    const url = urlCurso(c);
    const canvas = dibujarQR(url);
    const local = /^http:\/\/(localhost|127\.|192\.168\.|10\.)/.test(url) || url.startsWith('file:');
    contEnlace.replaceChildren(
      campo('Enlace para estudiantes', h('input', { type: 'text', readonly: true, value: url, onfocus: (e) => e.target.select() })),
      local ? h('p', { class: 'banner banner-aviso' }, 'Este enlace apunta a tu equipo local; los teléfonos de los estudiantes no podrán abrirlo. Configurá la “URL pública” en la pestaña Proyecto después de publicar.') : null,
      h('div', { class: 'fila' },
        h('button', { type: 'button', class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(url); toast('Enlace copiado.', 'ok'); } catch { toast('No se pudo copiar; seleccioná el texto y copialo.', 'aviso'); } } }, 'Copiar enlace'),
        h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener' }, 'Abrir'),
        h('a', { class: 'btn', href: `./?fuente=local&curso=${encodeURIComponent(c.enlaceId)}`, target: '_blank', rel: 'noopener' }, 'Vista previa local'),
        h('button', { type: 'button', class: 'btn', onclick: () => canvas.toBlob((b) => descargar(b, `qr-${c.enlaceId}.png`)) }, 'Descargar QR (PNG)')),
      h('img', { src: canvas.toDataURL(), alt: `Código QR del enlace ${url}`, class: 'qr' }),
    );
  };
  const nombre = h('input', { type: 'text', value: c.nombre, maxlength: M.LIMITES.tituloMax, oninput: (e) => { const v = sanear(e.target.value, M.LIMITES.tituloMax); if (v.trim()) { c.nombre = v; tocar(); } marcarError(nombre, v.trim() ? '' : 'El nombre no puede estar vacío.'); } });
  const enlace = h('input', { type: 'text', value: c.enlaceId, maxlength: 40, autocapitalize: 'none', spellcheck: 'false',
    onchange: (e) => {
      const v = e.target.value.trim().toLowerCase();
      if (!SLUG_RE.test(v)) return marcarError(enlace, 'Usá sólo minúsculas, números y guiones (sin espacios ni tildes).');
      if (st.p.cursos.some((x) => x.id !== c.id && x.enlaceId === v)) return marcarError(enlace, 'Ese identificador ya lo usa otro curso.');
      marcarError(enlace, ''); c.enlaceId = v; tocar(); pintarEnlace();
    } });
  panel.replaceChildren(
    h('button', { type: 'button', class: 'btn', onclick: () => { st.sel.curso = null; render(); } }, '← Cursos'),
    h('h2', {}, c.nombre),
    campo('Nombre del curso', nombre),
    campo('Identificador del enlace', enlace, `Aparece en la URL. Sugerido: ${slugify(c.nombre) || 'curso'}`),
    h('fieldset', { class: 'subseccion' }, h('legend', {}, 'Recorridos asignados'),
      st.p.recorridos.length ? st.p.recorridos.map((r) => h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: c.recorridoIds.includes(r.id), onchange: (e) => {
          c.recorridoIds = e.target.checked ? [...c.recorridoIds, r.id] : c.recorridoIds.filter((x) => x !== r.id); tocar(); render();
        } }), ` ${r.titulo}`, r.estado !== 'publicado' ? h('small', { class: 'etiqueta' }, ' borrador: no visible') : null)) : h('p', { class: 'nota' }, 'Primero creá recorridos.')),
    h('section', { class: 'subseccion' }, h('h3', {}, 'Enlace y QR'), contEnlace,
      h('p', { class: 'banner banner-info' }, 'Importante: el enlace no es una contraseña. Cualquiera que lo tenga puede entrar, y los datos publicados (data/project.json) son públicos. No incluyas información privada.')),
    h('div', { class: 'fila acciones' },
      h('button', { type: 'button', class: 'btn', onclick: () => { const n = { ...structuredClone(c), id: uid('curso'), nombre: `${c.nombre} (copia)`, enlaceId: M.slugUnico(st.p, c.enlaceId), creado: ahora(), actualizado: ahora() }; st.p.cursos.push(n); st.sel.curso = n.id; guardar(); render(); } }, 'Duplicar'),
      h('button', { type: 'button', class: 'btn btn-peligro', onclick: () => { if (!confirmar(`¿Eliminar el curso “${c.nombre}”? Los recorridos no se eliminan.`)) return; st.p.cursos = st.p.cursos.filter((x) => x.id !== c.id); st.sel.curso = null; guardar(); render(); } }, 'Eliminar curso')),
  );
  pintarEnlace();
}

// ======================================================================
// SIMULADOR
// ======================================================================
const simulador = {
  render() { st.sim?.salir(); st.sim = montarSimulador({ panel, mapa, capa, proyecto: st.p, pista }); },
  clickMapa(e) { st.sim?.clickMapa(e); },
  salir() { st.sim?.salir(); st.sim = null; },
};

// ======================================================================
// PROYECTO
// ======================================================================
const proyecto = {
  render() {
    const { errores, avisos } = M.validarProyecto(st.p);
    const p = st.p;
    const urlPub = h('input', { type: 'url', value: p.ajustes.urlPublica, placeholder: 'https://usuario.github.io/mi-audioguia/',
      onchange: (e) => {
        const v = e.target.value.trim();
        if (v && !/^https:\/\/[^\s]+$/i.test(v)) return marcarError(urlPub, 'Debe empezar con https:// (GPS y micrófono requieren HTTPS).');
        marcarError(urlPub, ''); p.ajustes.urlPublica = v; guardar();
      } });
    const tilesUrl = h('input', { type: 'url', value: p.ajustes.tiles.url, onchange: (e) => {
      const v = e.target.value.trim();
      if (!/^https:\/\/[^\s"'<>]+\{z\}[^\s"'<>]*$/.test(v)) return marcarError(tilesUrl, 'Debe ser https:// y contener {z}, {x} y {y}.');
      marcarError(tilesUrl, ''); p.ajustes.tiles.url = v; guardar(); toast('Recargá la página para ver el nuevo mapa base.', 'info');
    } });
    const tilesAttr = h('input', { type: 'text', value: p.ajustes.tiles.atribucion, onchange: (e) => { p.ajustes.tiles.atribucion = sanear(e.target.value, 500); guardar(); } });
    const almacen = h('p', { class: 'ayuda' }, 'Calculando uso de almacenamiento…');
    (async () => {
      try {
        const est = await navigator.storage?.estimate?.();
        const pers = await navigator.storage?.persisted?.();
        almacen.textContent = est ? `Usado: ${fmtBytes(est.usage)} de ~${fmtBytes(est.quota)} disponibles. Almacenamiento persistente: ${pers ? 'sí' : 'no (el navegador podría borrarlo si falta espacio: exportá respaldos)'}.` : 'Este navegador no informa el uso de almacenamiento.';
      } catch { almacen.textContent = 'No se pudo consultar el almacenamiento.'; }
    })();
    const importar = h('input', { type: 'file', accept: '.zip,.json,application/zip,application/json', id: 'importar', class: 'visually-hidden', onchange: async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try {
        const imp = await leerImportacion(f);
        if (!confirmar(`Importar “${imp.proyecto.titulo}”: ${imp.proyecto.spots.length} spots, ${imp.proyecto.recorridos.length} recorridos, ${imp.proyecto.cursos.length} cursos.\nEsto REEMPLAZA todo lo que hay en este navegador. ¿Continuar? (Exportá un respaldo antes si lo necesitás.)`)) return;
        await aplicarImportacion(imp);
        st.p = imp.proyecto; st.sel = { spot: null, rec: null, curso: null };
        imp.avisos.forEach((a) => toast(a, 'aviso', 9000));
        toast('Proyecto importado.', 'ok'); render();
      } catch (err) { toast(`No se pudo importar: ${err.message}`, 'error', 9000); }
    } });
    const btnExport = (txt, fn, nombre) => h('button', { type: 'button', class: 'btn btn-primario', onclick: async (e) => {
      const b = e.target; b.disabled = true; const t = b.textContent; b.textContent = 'Preparando ZIP…';
      try {
        await guardarYa();
        const { blob, faltantes } = await fn(st.p);
        descargar(blob, nombre());
        toast(`ZIP generado (${fmtBytes(blob.size)}).`, 'ok');
        if (faltantes.length) toast(`Atención, faltan archivos: ${faltantes.join('; ')}`, 'error', 12000);
      } catch (err) { toast(`No se pudo exportar: ${err.message}`, 'error', 9000); }
      b.disabled = false; b.textContent = t;
    } }, txt);
    const fecha = () => new Date().toISOString().slice(0, 10);
    panel.replaceChildren(
      h('h2', {}, 'Proyecto'),
      campo('Título del proyecto (se ve arriba en la app del estudiante)', h('input', { type: 'text', value: p.titulo, maxlength: M.LIMITES.tituloMax, oninput: (e) => { const v = sanear(e.target.value, M.LIMITES.tituloMax); if (v.trim()) { p.titulo = v; guardar(); } } })),
      campo('URL pública del sitio (para enlaces y QR)', urlPub, 'Completala después de publicar en GitHub Pages. Si queda vacía, se usa la dirección actual.'),
      h('section', { class: 'subseccion' }, h('h3', {}, 'Revisión de datos'),
        errores.length ? h('ul', { class: 'banner banner-error' }, errores.map((x) => h('li', {}, x))) : h('p', { class: 'banner banner-ok' }, 'Sin errores.'),
        avisos.length ? h('details', {}, h('summary', {}, `${avisos.length} aviso(s)`), h('ul', {}, avisos.map((x) => h('li', {}, x)))) : null,
        errores.length ? h('button', { type: 'button', class: 'btn', onclick: () => { const n = M.repararReferencias(p); guardar(); render(); toast(`Se quitaron ${n} referencia(s) rota(s).`, 'ok'); } }, 'Reparar referencias rotas') : null),
      h('section', { class: 'subseccion' }, h('h3', {}, 'Exportar y publicar'),
        h('p', {}, 'GitHub Pages es un sitio estático: esta página no puede escribir en tu repositorio. Para publicar, exportá y subí los archivos a GitHub (ver README).'),
        h('div', { class: 'fila' },
          btnExport('⤓ Sitio completo listo para publicar (ZIP)', exportarSitio, () => `audioguia-sitio-${fecha()}.zip`),
          btnExport('⤓ Sólo datos / respaldo (ZIP)', exportarDatos, () => `audioguia-datos-${fecha()}.zip`)),
        h('ul', { class: 'ayuda' },
          h('li', {}, 'Sitio completo: descomprimilo y subí todo el contenido a la raíz del repositorio (primera publicación).'),
          h('li', {}, 'Sólo datos: reemplazá la carpeta data/ del repositorio (actualizaciones de contenido). También sirve como respaldo.'))),
      h('section', { class: 'subseccion' }, h('h3', {}, 'Importar'),
        importar, h('label', { for: 'importar', class: 'btn', tabindex: 0, role: 'button', onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); importar.click(); } } }, '⤒ Importar ZIP o JSON'),
        h('p', { class: 'ayuda' }, 'Reemplaza el proyecto de este navegador. Acepta los ZIP exportados por esta app.')),
      h('section', { class: 'subseccion' }, h('h3', {}, 'Almacenamiento local'), almacen,
        h('p', { class: 'ayuda' }, 'Tus cambios se guardan sólo en este navegador y este equipo. Si borrás los datos del sitio, se pierden: exportá respaldos seguido.'),
        h('div', { class: 'fila' },
          h('button', { type: 'button', class: 'btn', onclick: async () => { const ok = await navigator.storage?.persist?.(); toast(ok ? 'Almacenamiento persistente concedido.' : 'El navegador no concedió almacenamiento persistente.', ok ? 'ok' : 'aviso'); render(); } }, 'Pedir almacenamiento persistente'),
          h('button', { type: 'button', class: 'btn', onclick: async () => { const n = await limpiarMediosHuerfanos(); toast(`Se borraron ${n} archivo(s) sin usar.`, 'ok'); render(); } }, 'Limpiar archivos sin usar'),
          h('button', { type: 'button', class: 'btn btn-peligro', onclick: async () => {
            if (!confirmar('Esto BORRA todo lo de este navegador y vuelve a cargar el contenido publicado (data/project.json). ¿Continuar?')) return;
            try { const imp = await leerPublicado(); await aplicarImportacion(imp); st.p = imp.proyecto; st.sel = { spot: null, rec: null, curso: null }; toast('Se restauró el contenido publicado.', 'ok'); render(); }
            catch (err) { toast(`No se pudo: ${err.message}`, 'error'); }
          } }, 'Restaurar contenido publicado'))),
      h('details', { class: 'subseccion' }, h('summary', {}, 'Avanzado: mapa base'),
        h('p', { class: 'ayuda' }, 'Por defecto se usan los mosaicos de OpenStreetMap, sujetos a su política de uso (uso moderado, con atribución, sin descargas masivas). Para mucho tráfico, usá otro proveedor gratuito compatible.'),
        campo('URL de mosaicos', tilesUrl), campo('Atribución (HTML simple)', tilesAttr),
        h('button', { type: 'button', class: 'btn btn-chico', onclick: () => { p.ajustes.tiles = { ...M.TILES_OSM }; guardar(); render(); } }, 'Volver a OpenStreetMap')),
    );
    st.p.spots.forEach((s) => L.marker([s.lat, s.lng], { icon: iconoSpot('•'), title: s.titulo }).addTo(capa));
  },
};

const controladores = { spots, recorridos, cursos, simulador, proyecto };
iniciar();
