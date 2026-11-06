// Exportación (respaldo / sitio listo para publicar) e importación de proyectos.
import { crearZip, leerZip } from './zip.js';
import { normalizarProyecto, rutaMedio, MIME_POR_EXT } from './model.js';
import * as db from './db.js';

async function archivosDeDatos(p, { faltantes }) {
  const archivos = [{ nombre: 'data/project.json', datos: JSON.stringify(p, null, 2) }];
  const vistos = new Set();
  for (const s of p.spots) for (const ref of [s.audio, s.imagen]) {
    if (!ref || vistos.has(ref.id)) continue;
    vistos.add(ref.id);
    const blob = await db.leerMedio(ref.id);
    if (blob) archivos.push({ nombre: rutaMedio(ref), datos: blob });
    else faltantes.push(`${s.titulo}: ${ref.nombre || ref.id}`);
  }
  return archivos;
}

/** ZIP con data/project.json + data/media/*. Sirve como respaldo y para actualizar un sitio ya publicado. */
export async function exportarDatos(p) {
  const faltantes = [];
  const archivos = await archivosDeDatos(p, { faltantes });
  return { blob: await crearZip(archivos), faltantes };
}

/** ZIP con TODO el sitio (app + datos), listo para subir a un repositorio de GitHub Pages. */
export async function exportarSitio(p) {
  const faltantes = [];
  const lista = [...self.APP_FILES.filter((f) => f !== './'), ...self.DOC_FILES];
  const archivos = [];
  for (const f of lista) {
    try {
      const r = await fetch(f, { cache: 'no-cache' });
      if (!r.ok) throw new Error(r.status);
      archivos.push({ nombre: f, datos: await r.blob() });
    } catch { if (self.APP_FILES.includes(f)) faltantes.push(`archivo de la app: ${f}`); }
  }
  if (!archivos.some((a) => a.nombre === '.nojekyll')) archivos.push({ nombre: '.nojekyll', datos: '' });
  archivos.push(...(await archivosDeDatos(p, { faltantes })));
  return { blob: await crearZip(archivos), faltantes };
}

/** Lee un .zip (exportado) o un .json. Devuelve {proyecto, avisos, medios: Map(id → {blob, mime, nombre})} */
export async function leerImportacion(file) {
  if (/\.json$/i.test(file.name) || file.type === 'application/json') {
    let raw; try { raw = JSON.parse(await file.text()); } catch { throw new Error('El JSON no es válido.'); }
    const { proyecto, avisos } = normalizarProyecto(raw);
    avisos.push('Se importó sólo el JSON: los audios e imágenes no vienen incluidos. Usá un ZIP para traerlos.');
    return { proyecto, avisos, medios: new Map() };
  }
  const zip = await leerZip(file);
  const claveJson = [...zip.keys()].find((k) => /(^|\/)project\.json$/.test(k));
  if (!claveJson) throw new Error('El ZIP no contiene un archivo project.json.');
  const prefijo = claveJson.slice(0, -'project.json'.length); // p.ej. "data/" o "mi-sitio/data/"
  let raw; try { raw = JSON.parse(new TextDecoder().decode(zip.get(claveJson))); } catch { throw new Error('project.json está dañado.'); }
  const { proyecto, avisos } = normalizarProyecto(raw);
  const medios = new Map();
  for (const s of proyecto.spots) for (const campo of ['audio', 'imagen']) {
    const ref = s[campo];
    if (!ref) continue;
    const nombre = prefijo + rutaMedio(ref).slice('data/'.length);
    const bytes = zip.get(nombre);
    if (bytes) medios.set(ref.id, { blob: new Blob([bytes], { type: ref.mime || MIME_POR_EXT[ref.ext] }), mime: ref.mime, nombre: ref.nombre });
    else { avisos.push(`Falta el archivo ${nombre} (spot “${s.titulo}”); se quitó la referencia.`); s[campo] = null; }
  }
  return { proyecto, avisos, medios };
}

/** Descarga el proyecto publicado junto a la app (data/) para sembrar el editor. */
export async function leerPublicado() {
  const r = await fetch('data/project.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error(`No se encontró data/project.json (${r.status}).`);
  const { proyecto, avisos } = normalizarProyecto(await r.json());
  const medios = new Map();
  for (const s of proyecto.spots) for (const campo of ['audio', 'imagen']) {
    const ref = s[campo];
    if (!ref || medios.has(ref.id)) continue;
    try {
      const m = await fetch(rutaMedio(ref));
      if (!m.ok) throw new Error();
      medios.set(ref.id, { blob: await m.blob(), mime: ref.mime, nombre: ref.nombre });
    } catch { avisos.push(`No se pudo descargar ${rutaMedio(ref)}; se quitó la referencia.`); s[campo] = null; }
  }
  return { proyecto, avisos, medios };
}

/** Reemplaza el proyecto local por uno importado (borra lo anterior). */
export async function aplicarImportacion({ proyecto, medios }) {
  await db.borrarTodo();
  for (const [id, m] of medios) await db.guardarMedio(id, m.blob, m.mime, m.nombre);
  await db.guardarProyecto(proyecto);
}
