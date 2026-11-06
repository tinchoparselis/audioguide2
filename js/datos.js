// Carga del proyecto publicado (data/project.json) o local (IndexedDB, para vista previa).
import { normalizarProyecto, rutaMedio } from './model.js';
import * as db from './db.js';

export async function cargarPublicado() {
  let r;
  try { r = await fetch('data/project.json', { cache: 'no-cache' }); }
  catch { throw new Error('No se pudo descargar el contenido. Revisá tu conexión.'); }
  if (!r.ok) throw new Error(`No se encontró el contenido publicado (data/project.json, error ${r.status}).`);
  let raw;
  try { raw = await r.json(); } catch { throw new Error('El archivo data/project.json está dañado.'); }
  return normalizarProyecto(raw).proyecto;
}

export async function cargarLocal() {
  const raw = await db.leerProyecto();
  if (!raw) throw new Error('No hay datos locales en este navegador. Abrí primero el panel de administración.');
  return normalizarProyecto(raw).proyecto;
}

export const resolverPublicado = async (spot) => ({ url: rutaMedio(spot.audio) });

export async function resolverLocal(spot) {
  const blob = await db.leerMedio(spot.audio.id);
  if (!blob) throw new Error('El audio no está en el almacenamiento local de este navegador.');
  const url = URL.createObjectURL(blob);
  return { url, revocar: () => URL.revokeObjectURL(url) };
}

export async function urlImagen(spot, local) {
  if (!spot.imagen) return null;
  if (!local) return { url: rutaMedio(spot.imagen) };
  const blob = await db.leerMedio(spot.imagen.id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  return { url, revocar: () => URL.revokeObjectURL(url) };
}
