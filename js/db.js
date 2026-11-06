// Persistencia local en IndexedDB: el proyecto (JSON) y los archivos de medios (audio/imagen).
// Los medios se guardan como ArrayBuffer (más compatible con Safari que Blob).

const NOMBRE = 'audioguia-db';
let dbPromesa;

function abrir() {
  return new Promise((res, rej) => {
    if (!('indexedDB' in globalThis)) return rej(new Error('Este navegador no permite almacenamiento local (IndexedDB).'));
    const r = indexedDB.open(NOMBRE, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('media')) db.createObjectStore('media', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error || new Error('No se pudo abrir el almacenamiento local.'));
    r.onblocked = () => rej(new Error('El almacenamiento está bloqueado por otra pestaña. Cerrala y recargá.'));
  });
}
const db = () => (dbPromesa ??= abrir());

async function tx(store, modo, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, modo);
    let salida;
    const req = fn(t.objectStore(store));
    if (req) req.onsuccess = () => { salida = req.result; };
    t.oncomplete = () => res(salida);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('Operación cancelada'));
  });
}

export const leerProyecto = () => tx('kv', 'readonly', (s) => s.get('proyecto'));
export const guardarProyecto = (p) => tx('kv', 'readwrite', (s) => s.put(p, 'proyecto'));

/** Guarda un medio. blob: Blob/File. Devuelve el registro. */
export async function guardarMedio(id, blob, mime, nombre = '') {
  const data = await blob.arrayBuffer();
  const rec = { id, data, mime, nombre, bytes: data.byteLength };
  await tx('media', 'readwrite', (s) => s.put(rec));
  return rec;
}
export async function leerMedio(id) {
  const rec = await tx('media', 'readonly', (s) => s.get(id));
  if (!rec) return null;
  return new Blob([rec.data], { type: rec.mime });
}
export const borrarMedio = (id) => tx('media', 'readwrite', (s) => s.delete(id));
export const listarMedios = () => tx('media', 'readonly', (s) => s.getAllKeys());
export async function borrarTodo() {
  await tx('kv', 'readwrite', (s) => s.clear());
  await tx('media', 'readwrite', (s) => s.clear());
}
