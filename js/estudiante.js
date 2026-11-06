// Vista del estudiante: elegir recorrido del curso, ver mapa, seguir GPS y escuchar.
/* global L */
import { h, $, parrafos, fmtDist, toast, lsGet, lsSet } from './util.js';
import { buscarSpot, rutaMedio } from './model.js';
import { MotorProximidad } from './geo.js';
import { Reproductor } from './player.js';
import { montarReproductor } from './player-ui.js';
import { crearMapa, iconoSpot, encuadrar } from './mapa.js';
import * as datos from './datos.js';
import { registrarSW } from './sw-registro.js';

const params = new URLSearchParams(location.search);
const LOCAL = params.get('fuente') === 'local';
const CLAVE_MODO = 'audioguia:modo';
const pantalla = $('#pantalla');
let proyecto, curso, recorrido;
let mapa, capaUsuario, circuloPrecision;
let watchId = null, wakeLock = null;
const motor = new MotorProximidad({ precisionMaxima: 50 });
const rep = new Reproductor(LOCAL ? datos.resolverLocal : datos.resolverPublicado);
rep.setModo(lsGet(CLAVE_MODO, 'manual'));
const distancias = new Map();

// ---------- red ----------
function pintarRed() {
  const el = $('#estadoRed');
  el.textContent = navigator.onLine ? '' : 'Sin conexión';
  el.className = navigator.onLine ? 'pastilla' : 'pastilla pastilla-error';
}
addEventListener('online', () => { pintarRed(); toast('Conexión recuperada.', 'ok'); });
addEventListener('offline', () => { pintarRed(); toast('Sin conexión: el mapa puede no cargar; los audios guardados sin conexión siguen disponibles.', 'aviso', 7000); });
pintarRed();

// ---------- navegación ----------
function irA(cambios) {
  const p = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(cambios)) if (v == null) p.delete(k); else p.set(k, v);
  history.pushState(null, '', `${location.pathname}?${p}`);
  enrutar();
}
addEventListener('popstate', enrutar);

async function iniciar() {
  if (LOCAL) $('#bannerLocal').hidden = false;
  registrarSW();
  try { proyecto = LOCAL ? await datos.cargarLocal() : await datos.cargarPublicado(); }
  catch (e) { pantalla.replaceChildren(h('div', { class: 'banner banner-error', role: 'alert' }, e.message)); return; }
  $('#tituloApp').textContent = proyecto.titulo || 'Audioguía';
  enrutar();
}

function recorridosVisibles(lista) {
  return lista.map((id) => proyecto.recorridos.find((r) => r.id === id)).filter((r) => r && (LOCAL || r.estado === 'publicado'));
}

function enrutar() {
  detenerSeguimiento();
  rep.vaciar();
  const q = new URLSearchParams(location.search);
  const slug = q.get('curso'), recId = q.get('recorrido');
  curso = slug ? proyecto.cursos.find((c) => c.enlaceId === slug) : null;
  if (slug && !curso) return pantallaCodigo(`No encontramos el curso “${slug}”. Revisá el enlace o el código.`);
  if (recId) {
    const permitido = curso ? curso.recorridoIds.includes(recId) : LOCAL;
    recorrido = permitido ? recorridosVisibles([recId])[0] : null;
    if (recorrido) return pantallaRecorrido();
  }
  if (curso) return pantallaCurso();
  pantallaCodigo();
}

// ---------- pantallas ----------
function pantallaCodigo(error) {
  document.title = 'Audioguía';
  const input = h('input', { id: 'codigo', type: 'text', autocomplete: 'off', autocapitalize: 'none', required: true, pattern: '[a-z0-9-]+' });
  const extra = LOCAL ? h('section', { class: 'tarjeta' }, h('h2', {}, 'Vista previa: todos los cursos'),
    h('ul', { class: 'lista-botones' }, proyecto.cursos.map((c) => h('li', {}, h('button', { class: 'btn btn-bloque', onclick: () => irA({ curso: c.enlaceId, recorrido: null }) }, c.nombre))))) : null;
  pantalla.replaceChildren(
    error ? h('p', { class: 'banner banner-error', role: 'alert' }, error) : null,
    h('section', { class: 'tarjeta' },
      h('h2', {}, 'Entrá con el enlace de tu curso'),
      h('p', {}, 'Tu docente te comparte un enlace o un código QR. Si tenés un código de curso, escribilo acá:'),
      h('form', { class: 'fila', onsubmit: (e) => { e.preventDefault(); irA({ curso: input.value.trim().toLowerCase(), recorrido: null }); } },
        h('label', { for: 'codigo', class: 'visually-hidden' }, 'Código del curso'), input,
        h('button', { class: 'btn btn-primario', type: 'submit' }, 'Entrar'))),
    extra, avisoRestricciones(),
  );
}

function pantallaCurso() {
  document.title = `${curso.nombre} · Audioguía`;
  const recs = recorridosVisibles(curso.recorridoIds);
  pantalla.replaceChildren(
    h('section', { class: 'tarjeta' },
      h('h2', {}, curso.nombre),
      recs.length ? h('p', {}, 'Elegí un recorrido:') : h('p', {}, 'Todavía no hay recorridos publicados para este curso.'),
      h('ul', { class: 'lista-recorridos' }, recs.map((r) => h('li', {},
        h('button', { class: 'tarjeta-boton', onclick: () => irA({ recorrido: r.id }) },
          h('strong', {}, r.titulo + (r.estado !== 'publicado' ? ' (borrador)' : '')),
          r.descripcion ? h('span', {}, r.descripcion) : null,
          h('small', {}, `${spotsDe(r).length} paradas`))))),
    ),
    avisoRestricciones(),
  );
  $('#principal').focus();
}

const spotsDe = (r) => r.spotIds.map((id) => buscarSpot(proyecto, id)).filter((s) => s && s.habilitado !== false);

function avisoRestricciones() {
  return h('details', { class: 'tarjeta aviso' },
    h('summary', {}, 'Antes de salir: cómo funciona el GPS y el audio'),
    h('ul', {},
      h('li', {}, 'El GPS del teléfono puede tener errores de 5 a 50 metros o más (edificios, árboles, interiores). La app muestra la precisión estimada.'),
      h('li', {}, 'Muchos navegadores no permiten iniciar audio sin que toques la pantalla. Si un audio no arranca solo, tocá ▶.'),
      h('li', {}, 'Con la pantalla bloqueada o la app en segundo plano, el navegador puede pausar el GPS y el audio. Dejá la pantalla encendida durante el recorrido (podés activar “Mantener pantalla encendida”).'),
      h('li', {}, 'Siempre podés leer el texto y escuchar cada parada tocándola en el mapa o en la lista, aunque no estés cerca.'),
      h('li', {}, 'No se envía tu ubicación a ningún servidor: se usa sólo en tu teléfono.'),
    ));
}

function pantallaRecorrido() {
  document.title = `${recorrido.titulo} · Audioguía`;
  const spots = spotsDe(recorrido);
  motor.setSpots(spots); motor.reiniciar(); distancias.clear();

  const elMapa = h('div', { id: 'mapa', class: 'mapa-estudiante', role: 'region', 'aria-label': 'Mapa del recorrido' });
  const estadoGps = h('p', { id: 'estadoGps', class: 'estado-gps', 'aria-live': 'polite' }, 'Seguimiento GPS apagado.');
  const btnGps = h('button', { id: 'btnGps', type: 'button', class: 'btn btn-grande btn-primario', onclick: alternarSeguimiento }, '▶ Iniciar seguimiento GPS');
  const btnCentrar = h('button', { type: 'button', class: 'btn', onclick: centrarEnMi }, '◎ Centrar en mí');
  const modo = h('fieldset', { class: 'modo' },
    h('legend', {}, 'Al llegar a una parada'),
    ['auto', 'manual'].map((m) => h('label', { class: 'radio' },
      h('input', { type: 'radio', name: 'modo', value: m, checked: rep.modo === m, onchange: () => { rep.setModo(m); lsSet(CLAVE_MODO, m); toast(m === 'auto' ? 'Modo automático: el audio intentará empezar solo.' : 'Modo manual: vas a tocar ▶ para escuchar.', 'info'); } }),
      m === 'auto' ? ' Reproducir automáticamente' : ' Avisarme y reproduzco yo')));
  const chkPantalla = h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'chkWake', onchange: (e) => mantenerPantalla(e.target.checked) }), ' Mantener pantalla encendida');
  if (!('wakeLock' in navigator)) chkPantalla.hidden = true;
  const btnOffline = h('button', { type: 'button', class: 'btn', onclick: () => guardarSinConexion(spots) }, '⤓ Guardar audios para usar sin conexión');
  if (LOCAL || !('caches' in window)) btnOffline.hidden = true;
  const contRep = h('section', { class: 'tarjeta', 'aria-label': 'Reproductor' });
  const llegada = h('div', { id: 'llegada', class: 'banner banner-ok', hidden: true, role: 'status' });
  const lista = h('ol', { class: 'lista-spots', id: 'listaSpots' });

  pantalla.replaceChildren(
    h('div', { class: 'cabecera-rec' },
      curso ? h('button', { type: 'button', class: 'btn', onclick: () => irA({ recorrido: null }) }, '← Recorridos') : null,
      h('h2', {}, recorrido.titulo)),
    recorrido.descripcion ? h('p', { class: 'descripcion' }, recorrido.descripcion) : null,
    elMapa,
    h('section', { class: 'tarjeta controles-gps' }, h('div', { class: 'fila' }, btnGps, btnCentrar), estadoGps, modo, chkPantalla, btnOffline),
    llegada, contRep,
    h('section', { class: 'tarjeta' }, h('h3', {}, 'Paradas'), lista),
    avisoRestricciones(),
  );

  montarReproductor(contRep, rep, { onVerTexto: abrirSpot });
  mapa = crearMapa(elMapa, proyecto.ajustes);
  elMapa.addEventListener('tiles-error', () => toast('No se pudieron cargar partes del mapa (¿sin conexión?). Las paradas y audios siguen disponibles en la lista.', 'aviso', 7000));
  if (recorrido.trazado.length > 1) L.polyline(recorrido.trazado, { color: '#1f5f4a', weight: 5, opacity: 0.8 }).addTo(mapa);
  const marcadores = new Map();
  spots.forEach((s, i) => {
    L.circle([s.lat, s.lng], { radius: s.radioEntradaMetros, color: '#c2410c', weight: 1, fillOpacity: 0.08, interactive: false }).addTo(mapa);
    const m = L.marker([s.lat, s.lng], { icon: iconoSpot(i + 1), title: s.titulo, alt: s.titulo, keyboard: true }).addTo(mapa);
    m.on('click', () => abrirSpot(s));
    marcadores.set(s.id, m);
  });
  encuadrar(mapa, [...recorrido.trazado, ...spots.map((s) => [s.lat, s.lng])]);

  function pintarLista() {
    lista.replaceChildren(...spots.map((s, i) => {
      const d = distancias.get(s.id), dentro = motor.estaDentro(s.id);
      return h('li', { class: dentro ? 'dentro' : '' },
        h('button', { type: 'button', class: 'spot-item', onclick: () => abrirSpot(s) },
          h('span', { class: 'num', 'aria-hidden': 'true' }, i + 1),
          h('span', { class: 'spot-item-texto' }, h('strong', {}, s.titulo),
            h('small', {}, [d != null ? `a ${fmtDist(d)}` : null, dentro ? 'estás acá' : null, s.audio ? 'con audio' : 'sólo texto'].filter(Boolean).join(' · ')))));
    }));
  }
  pintarLista();
  pantalla._pintarLista = pintarLista;
}

rep.addEventListener('llegada', (ev) => {
  const s = ev.detail, llegada = $('#llegada');
  if (!llegada) return;
  llegada.hidden = false;
  llegada.replaceChildren(h('span', {}, `Llegaste a: ${s.titulo}`), h('button', { type: 'button', class: 'btn btn-chico', onclick: () => abrirSpot(s) }, 'Ver texto'));
  if ('vibrate' in navigator) try { navigator.vibrate(200); } catch { /* nada */ }
});

// ---------- detalle de un spot ----------
async function abrirSpot(s) {
  const dlg = $('#dlgSpot');
  $('#dlgSpotTitulo').textContent = s.titulo;
  const cont = $('#dlgSpotContenido');
  const img = s.imagen ? await datos.urlImagen(s, LOCAL).catch(() => null) : null;
  cont.replaceChildren(
    img ? h('img', { src: img.url, alt: '', class: 'spot-imagen', onerror: (e) => e.target.remove() }) : null,
    s.audio ? h('button', { type: 'button', class: 'btn btn-grande btn-primario', onclick: () => { rep.desbloquear(); rep.reproducir(s); dlg.close(); } }, '▶ Escuchar esta parada')
      : h('p', { class: 'nota' }, 'Esta parada no tiene audio.'),
    h('div', { class: 'texto-spot' }, s.texto ? parrafos(s.texto) : h('p', { class: 'nota' }, 'Sin texto.')),
  );
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  dlg.addEventListener('close', () => img?.revocar?.(), { once: true });
}
$('#dlgCerrar').addEventListener('click', () => $('#dlgSpot').close());
$('#dlgSpot').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

// ---------- GPS ----------
function alternarSeguimiento() { if (watchId == null) iniciarSeguimiento(); else detenerSeguimiento(); }

function iniciarSeguimiento() {
  const est = $('#estadoGps');
  rep.desbloquear(); // estamos dentro de un toque: habilita el audio posterior
  if (!isSecureContext) { est.textContent = 'El GPS necesita que la página se abra con HTTPS.'; est.className = 'estado-gps error'; return; }
  if (!('geolocation' in navigator)) { est.textContent = 'Este navegador no ofrece geolocalización.'; est.className = 'estado-gps error'; return; }
  est.textContent = 'Pidiendo permiso y buscando señal GPS…'; est.className = 'estado-gps';
  watchId = navigator.geolocation.watchPosition(alPosicionar, alErrorGps, { enableHighAccuracy: true, maximumAge: 3000, timeout: 30000 });
  $('#btnGps').textContent = '■ Detener seguimiento';
}

function detenerSeguimiento() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  const b = $('#btnGps'); if (b) b.textContent = '▶ Iniciar seguimiento GPS';
  const est = $('#estadoGps'); if (est) { est.textContent = 'Seguimiento GPS apagado.'; est.className = 'estado-gps'; }
  if (capaUsuario && mapa) { capaUsuario.remove(); circuloPrecision.remove(); capaUsuario = null; }
  mantenerPantalla(false);
}

function calidad(acc) {
  if (acc <= 15) return ['buena', 'ok'];
  if (acc <= 50) return ['aceptable', ''];
  return ['baja: las paradas no se activan hasta mejorar', 'aviso'];
}

let ultimaPos = null;
function alPosicionar(pos) {
  const { latitude: lat, longitude: lng, accuracy } = pos.coords;
  ultimaPos = [lat, lng];
  const [txt, cls] = calidad(accuracy);
  const est = $('#estadoGps');
  est.textContent = `GPS activo · precisión ±${Math.round(accuracy)} m (${txt}) · ${new Date(pos.timestamp).toLocaleTimeString('es-AR')}`;
  est.className = `estado-gps ${cls}`;
  if (!capaUsuario) {
    circuloPrecision = L.circle([lat, lng], { radius: accuracy, color: '#2563eb', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(mapa);
    capaUsuario = L.circleMarker([lat, lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).addTo(mapa).bindTooltip('Vos');
  } else { capaUsuario.setLatLng([lat, lng]); circuloPrecision.setLatLng([lat, lng]).setRadius(accuracy); }
  const res = motor.actualizar({ lat, lng, accuracy });
  res.distancias.forEach((d, id) => distancias.set(id, d));
  for (const ev of res.eventos) if (ev.tipo === 'entrada') {
    const r = rep.activar(ev.spot);
    if (r === 'en-espera') toast(`“${ev.spot.titulo}” quedó en espera hasta que termine el audio actual.`, 'info');
  }
  pantalla._pintarLista?.();
}

function alErrorGps(err) {
  const est = $('#estadoGps');
  const msj = {
    1: 'Permiso de ubicación denegado. Activalo en la configuración del navegador para este sitio y volvé a intentar. Mientras tanto podés escuchar cada parada desde la lista.',
    2: 'No se pudo obtener la ubicación (señal GPS no disponible). Probá al aire libre y con el GPS del teléfono activado.',
    3: 'El GPS tarda en responder. Seguimos intentando…',
  }[err.code] || `Error de GPS: ${err.message}`;
  est.textContent = msj; est.className = `estado-gps ${err.code === 3 ? 'aviso' : 'error'}`;
  if (err.code === 1) { navigator.geolocation.clearWatch(watchId); watchId = null; $('#btnGps').textContent = '▶ Iniciar seguimiento GPS'; }
}

function centrarEnMi() {
  if (ultimaPos) mapa.setView(ultimaPos, Math.max(mapa.getZoom(), 17));
  else toast('Todavía no hay ubicación. Iniciá el seguimiento GPS.', 'aviso');
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && watchId != null) {
    toast('La app quedó en segundo plano: el GPS y el audio pueden pausarse.', 'aviso');
  } else if (document.visibilityState === 'visible' && $('#chkWake')?.checked) mantenerPantalla(true);
});

async function mantenerPantalla(si) {
  try {
    if (si) { wakeLock = await navigator.wakeLock.request('screen'); }
    else if (wakeLock) { await wakeLock.release(); wakeLock = null; const c = $('#chkWake'); if (c && watchId == null) c.checked = false; }
  } catch { toast('No se pudo mantener la pantalla encendida en este navegador.', 'aviso'); const c = $('#chkWake'); if (c) c.checked = false; }
}

// ---------- sin conexión ----------
async function guardarSinConexion(spots) {
  const urls = spots.flatMap((s) => [rutaMedio(s.audio), rutaMedio(s.imagen)]).filter(Boolean);
  if (!urls.length) return toast('Este recorrido no tiene audios ni imágenes.', 'info');
  try {
    const cache = await caches.open('audioguia-medios-v1');
    let ok = 0;
    for (const u of urls) { try { const r = await fetch(u); if (r.ok) { await cache.put(u, r); ok++; } } catch { /* sigue */ } }
    toast(ok === urls.length ? `Listo: ${ok} archivo(s) guardado(s) para usar sin conexión (el mapa de fondo puede no verse sin conexión).`
      : `Se guardaron ${ok} de ${urls.length} archivos. Reintentá con mejor conexión.`, ok === urls.length ? 'ok' : 'aviso', 8000);
  } catch (e) { toast(`No se pudo guardar: ${e.message}`, 'error'); }
}

iniciar();
