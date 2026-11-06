// Modelo de datos: SPOT, RECORRIDO, CURSO. Validación, normalización y referencias.
import { uid, sanear, slugify, ahora, ID_RE, SLUG_RE } from './util.js';

export const FORMATO = 'audioguia-proyecto';
export const VERSION = 1;

export const LIMITES = {
  radioMin: 5, radioMax: 1000, salidaMax: 2000,
  tituloMax: 120, textoMax: 20000, descripcionMax: 2000,
  audioMaxBytes: 25 * 1024 * 1024, imagenMaxBytes: 8 * 1024 * 1024,
};

export const TILES_OSM = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  atribucion: '&copy; <a href="https://www.openstreetmap.org/copyright">colaboradores de OpenStreetMap</a>',
  maxZoom: 19,
};

const EXT_POR_MIME = {
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac',
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
  'audio/flac': 'flac', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
};
export const MIME_POR_EXT = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', webm: 'audio/webm', ogg: 'audio/ogg', oga: 'audio/ogg',
  wav: 'audio/wav', flac: 'audio/flac', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
};
export function mimeBase(mime) { return String(mime || '').split(';')[0].trim().toLowerCase(); }
export function extDeMime(mime, nombre = '') {
  const e = EXT_POR_MIME[mimeBase(mime)];
  if (e) return e;
  const m = /\.([a-z0-9]{2,5})$/i.exec(nombre);
  return m && MIME_POR_EXT[m[1].toLowerCase()] ? m[1].toLowerCase() : 'bin';
}
/** Ruta relativa (desde la raíz del sitio) de un medio publicado. */
export function rutaMedio(ref) { return ref ? `data/media/${ref.id}.${ref.ext}` : null; }

export function nuevoProyecto() {
  return {
    formato: FORMATO, version: VERSION, titulo: 'Mis audioguías', actualizado: ahora(),
    ajustes: { urlPublica: '', tiles: { ...TILES_OSM } },
    spots: [], recorridos: [], cursos: [],
  };
}

export function salidaSugerida(entrada) { return Math.round(entrada + Math.max(10, entrada * 0.5)); }

export function nuevoSpot(lat, lng, titulo = 'Nuevo spot') {
  const t = ahora();
  return {
    id: uid('spot'), titulo, lat: redondear(lat), lng: redondear(lng),
    radioEntradaMetros: 25, radioSalidaMetros: salidaSugerida(25),
    texto: '', audio: null, imagen: null, habilitado: true, creado: t, actualizado: t,
  };
}
export function nuevoRecorrido(titulo = 'Nuevo recorrido') {
  const t = ahora();
  return { id: uid('rec'), titulo, descripcion: '', trazado: [], spotIds: [], estado: 'borrador', creado: t, actualizado: t };
}
export function nuevoCurso(p, nombre = 'Nuevo curso') {
  const t = ahora();
  return { id: uid('curso'), nombre, enlaceId: slugUnico(p, slugify(nombre) || 'curso'), recorridoIds: [], creado: t, actualizado: t };
}

export const redondear = (n) => Math.round(Number(n) * 1e6) / 1e6;

export function slugUnico(p, base, exceptoId = null) {
  base = slugify(base) || 'curso';
  const usados = new Set(p.cursos.filter((c) => c.id !== exceptoId).map((c) => c.enlaceId));
  let s = base, i = 2;
  while (usados.has(s)) s = `${base.slice(0, 36)}-${i++}`;
  return s;
}

export function validarCoord(lat, lng) {
  const e = [];
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) e.push('La latitud debe ser un número entre -90 y 90.');
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) e.push('La longitud debe ser un número entre -180 y 180.');
  return e;
}

export function validarSpot(s) {
  const e = [];
  if (!s.titulo || !s.titulo.trim()) e.push('El título no puede estar vacío.');
  e.push(...validarCoord(s.lat, s.lng));
  const { radioMin, radioMax, salidaMax } = LIMITES;
  if (!Number.isFinite(s.radioEntradaMetros) || s.radioEntradaMetros < radioMin || s.radioEntradaMetros > radioMax)
    e.push(`El radio de entrada debe estar entre ${radioMin} y ${radioMax} m.`);
  if (!Number.isFinite(s.radioSalidaMetros) || s.radioSalidaMetros <= s.radioEntradaMetros || s.radioSalidaMetros > salidaMax)
    e.push(`El radio de salida debe ser mayor que el de entrada y como máximo ${salidaMax} m.`);
  return e;
}

export const recorridosQueUsan = (p, spotId) => p.recorridos.filter((r) => r.spotIds.includes(spotId));
export const cursosQueUsan = (p, recId) => p.cursos.filter((c) => c.recorridoIds.includes(recId));
export const buscarSpot = (p, id) => p.spots.find((s) => s.id === id);
export const buscarRecorrido = (p, id) => p.recorridos.find((r) => r.id === id);

export function mediosReferenciados(p) {
  const ids = new Set();
  for (const s of p.spots) { if (s.audio) ids.add(s.audio.id); if (s.imagen) ids.add(s.imagen.id); }
  return ids;
}

/** Revisa integridad: ids duplicados, referencias rotas, enlaces repetidos, datos inválidos. */
export function validarProyecto(p) {
  const errores = [], avisos = [];
  const dup = (lista, nombre) => {
    const vistos = new Set();
    for (const x of lista) { if (vistos.has(x.id)) errores.push(`ID duplicado en ${nombre}: ${x.id}`); vistos.add(x.id); }
    return vistos;
  };
  const spotIds = dup(p.spots, 'spots'), recIds = dup(p.recorridos, 'recorridos'); dup(p.cursos, 'cursos');
  for (const s of p.spots) {
    const es = validarSpot(s);
    if (es.length) errores.push(`Spot “${s.titulo || s.id}”: ${es.join(' ')}`);
    if (!s.audio) avisos.push(`Spot “${s.titulo}” no tiene audio (el texto igual se muestra).`);
    if (!s.texto?.trim()) avisos.push(`Spot “${s.titulo}” no tiene texto.`);
  }
  for (const r of p.recorridos) {
    for (const id of r.spotIds) if (!spotIds.has(id)) errores.push(`El recorrido “${r.titulo}” referencia un spot inexistente (${id}).`);
    if (new Set(r.spotIds).size !== r.spotIds.length) errores.push(`El recorrido “${r.titulo}” repite un spot.`);
    if (!r.spotIds.length) avisos.push(`El recorrido “${r.titulo}” no tiene spots.`);
    if (r.trazado.length === 1) avisos.push(`El trazado de “${r.titulo}” tiene un solo punto.`);
  }
  const slugs = new Set();
  for (const c of p.cursos) {
    for (const id of c.recorridoIds) if (!recIds.has(id)) errores.push(`El curso “${c.nombre}” referencia un recorrido inexistente (${id}).`);
    if (!SLUG_RE.test(c.enlaceId)) errores.push(`El enlace del curso “${c.nombre}” no es válido.`);
    if (slugs.has(c.enlaceId)) errores.push(`El enlace “${c.enlaceId}” está repetido en dos cursos.`);
    slugs.add(c.enlaceId);
    if (!c.recorridoIds.length) avisos.push(`El curso “${c.nombre}” no tiene recorridos asignados.`);
    const borr = c.recorridoIds.map((id) => buscarRecorrido(p, id)).filter((r) => r && r.estado !== 'publicado');
    if (borr.length) avisos.push(`El curso “${c.nombre}” tiene recorridos en borrador (los estudiantes no los ven): ${borr.map((r) => r.titulo).join(', ')}.`);
  }
  return { errores, avisos };
}

/** Elimina referencias rotas y duplicadas. Devuelve cuántas se quitaron. */
export function repararReferencias(p) {
  let n = 0;
  const spotIds = new Set(p.spots.map((s) => s.id)), recIds = new Set(p.recorridos.map((r) => r.id));
  for (const r of p.recorridos) {
    const limpio = [...new Set(r.spotIds.filter((id) => spotIds.has(id)))];
    n += r.spotIds.length - limpio.length; r.spotIds = limpio;
  }
  for (const c of p.cursos) {
    const limpio = [...new Set(c.recorridoIds.filter((id) => recIds.has(id)))];
    n += c.recorridoIds.length - limpio.length; c.recorridoIds = limpio;
  }
  return n;
}

const num = (v) => (typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v));
function refMedio(m, tipo) {
  if (!m || typeof m !== 'object') return null;
  const id = String(m.id || ''), ext = String(m.ext || '').toLowerCase();
  if (!ID_RE.test(id) || !/^[a-z0-9]{2,5}$/.test(ext)) return null;
  const mime = mimeBase(m.mime) || MIME_POR_EXT[ext] || '';
  if (!mime.startsWith(tipo + '/')) return null;
  return { id, ext, mime, nombre: sanear(m.nombre, 200), bytes: Number(m.bytes) || 0 };
}

/** Convierte datos importados/publicados en un proyecto limpio. Lanza error si el formato no corresponde. */
export function normalizarProyecto(raw) {
  if (!raw || typeof raw !== 'object' || raw.formato !== FORMATO) throw new Error('El archivo no es un proyecto de audioguías válido.');
  if (raw.version > VERSION) throw new Error('El proyecto fue creado con una versión más nueva de la app.');
  const avisos = [];
  const p = nuevoProyecto();
  p.titulo = sanear(raw.titulo, LIMITES.tituloMax) || p.titulo;
  p.actualizado = String(raw.actualizado || ahora());
  const aj = raw.ajustes || {};
  p.ajustes.urlPublica = /^https?:\/\//i.test(aj.urlPublica || '') ? sanear(aj.urlPublica, 500) : '';
  if (aj.tiles && /^https:\/\/[^\s"'<>]+\{z\}[^\s"'<>]*$/.test(aj.tiles.url || '')) {
    p.ajustes.tiles = { url: aj.tiles.url, atribucion: sanear(aj.tiles.atribucion, 500), maxZoom: Math.min(22, Number(aj.tiles.maxZoom) || 19) };
  }
  const ids = new Set();
  const idOk = (id, tipo) => {
    if (!ID_RE.test(String(id || ''))) { avisos.push(`Se descartó un ${tipo} con ID inválido.`); return false; }
    if (ids.has(id)) { avisos.push(`Se descartó un ${tipo} con ID duplicado (${id}).`); return false; }
    ids.add(id); return true;
  };
  for (const s of Array.isArray(raw.spots) ? raw.spots : []) {
    if (!idOk(s.id, 'spot')) continue;
    const spot = {
      id: s.id, titulo: sanear(s.titulo, LIMITES.tituloMax).trim() || 'Spot sin título',
      lat: redondear(num(s.lat)), lng: redondear(num(s.lng)),
      radioEntradaMetros: Math.round(num(s.radioEntradaMetros)), radioSalidaMetros: Math.round(num(s.radioSalidaMetros)),
      texto: sanear(s.texto, LIMITES.textoMax), audio: refMedio(s.audio, 'audio'), imagen: refMedio(s.imagen, 'image'),
      habilitado: s.habilitado !== false, creado: String(s.creado || ahora()), actualizado: String(s.actualizado || ahora()),
    };
    if (validarCoord(spot.lat, spot.lng).length) { avisos.push(`Se descartó el spot “${spot.titulo}”: coordenadas inválidas.`); continue; }
    if (!(spot.radioEntradaMetros >= LIMITES.radioMin && spot.radioEntradaMetros <= LIMITES.radioMax)) spot.radioEntradaMetros = 25;
    if (!(spot.radioSalidaMetros > spot.radioEntradaMetros && spot.radioSalidaMetros <= LIMITES.salidaMax)) spot.radioSalidaMetros = salidaSugerida(spot.radioEntradaMetros);
    p.spots.push(spot);
  }
  for (const r of Array.isArray(raw.recorridos) ? raw.recorridos : []) {
    if (!idOk(r.id, 'recorrido')) continue;
    const trazado = (Array.isArray(r.trazado) ? r.trazado : [])
      .map((pt) => [redondear(num(pt?.[0])), redondear(num(pt?.[1]))])
      .filter(([a, b]) => !validarCoord(a, b).length);
    p.recorridos.push({
      id: r.id, titulo: sanear(r.titulo, LIMITES.tituloMax).trim() || 'Recorrido sin título',
      descripcion: sanear(r.descripcion, LIMITES.descripcionMax), trazado,
      spotIds: (Array.isArray(r.spotIds) ? r.spotIds : []).map(String),
      estado: r.estado === 'publicado' ? 'publicado' : 'borrador',
      creado: String(r.creado || ahora()), actualizado: String(r.actualizado || ahora()),
    });
  }
  const slugs = new Set();
  for (const c of Array.isArray(raw.cursos) ? raw.cursos : []) {
    if (!idOk(c.id, 'curso')) continue;
    let enlace = SLUG_RE.test(c.enlaceId || '') ? c.enlaceId : slugify(c.nombre) || 'curso';
    while (slugs.has(enlace)) enlace = `${enlace.slice(0, 36)}-${Math.floor(Math.random() * 99)}`;
    slugs.add(enlace);
    p.cursos.push({
      id: c.id, nombre: sanear(c.nombre, LIMITES.tituloMax).trim() || 'Curso sin nombre', enlaceId: enlace,
      recorridoIds: (Array.isArray(c.recorridoIds) ? c.recorridoIds : []).map(String),
      creado: String(c.creado || ahora()), actualizado: String(c.actualizado || ahora()),
    });
  }
  const rotas = repararReferencias(p);
  if (rotas) avisos.push(`Se quitaron ${rotas} referencia(s) rota(s) o duplicada(s).`);
  return { proyecto: p, avisos };
}
