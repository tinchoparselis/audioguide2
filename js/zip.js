// ZIP mínimo sin dependencias. Escribe sin compresión (STORE); lee STORE y DEFLATE
// (DEFLATE vía DecompressionStream, disponible en navegadores actuales).

const TABLA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLA[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function aBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(await data.arrayBuffer());
}

function fechaDos(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** archivos: [{nombre, datos: string|Uint8Array|Blob}] → Blob application/zip */
export async function crearZip(archivos) {
  const partes = [], central = [];
  let offset = 0;
  const { time, date } = fechaDos();
  for (const a of archivos) {
    const nombre = new TextEncoder().encode(a.nombre);
    const datos = await aBytes(a.datos);
    const crc = crc32(datos);
    const loc = new DataView(new ArrayBuffer(30));
    loc.setUint32(0, 0x04034b50, true); loc.setUint16(4, 20, true); loc.setUint16(6, 0x0800, true);
    loc.setUint16(8, 0, true); loc.setUint16(10, time, true); loc.setUint16(12, date, true);
    loc.setUint32(14, crc, true); loc.setUint32(18, datos.length, true); loc.setUint32(22, datos.length, true);
    loc.setUint16(26, nombre.length, true); loc.setUint16(28, 0, true);
    partes.push(new Uint8Array(loc.buffer), nombre, datos);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true); cen.setUint16(12, time, true); cen.setUint16(14, date, true);
    cen.setUint32(16, crc, true); cen.setUint32(20, datos.length, true); cen.setUint32(24, datos.length, true);
    cen.setUint16(28, nombre.length, true); cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), nombre);
    offset += 30 + nombre.length + datos.length;
  }
  const tamCentral = central.reduce((s, x) => s + x.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, archivos.length, true); fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, tamCentral, true); fin.setUint32(16, offset, true);
  return new Blob([...partes, ...central, new Uint8Array(fin.buffer)], { type: 'application/zip' });
}

/** Lee un ZIP → Map(nombre → Uint8Array). */
export async function leerZip(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('El archivo no es un ZIP válido.');
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const salida = new Map();
  const dec = new TextDecoder();
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP dañado (directorio central).');
    const metodo = dv.getUint16(p + 10, true), comp = dv.getUint32(p + 20, true);
    const ln = dv.getUint16(p + 28, true), lx = dv.getUint16(p + 30, true), lc = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const nombre = dec.decode(buf.subarray(p + 46, p + 46 + ln));
    p += 46 + ln + lx + lc;
    if (nombre.endsWith('/')) continue;
    const inicio = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    const crudo = buf.subarray(inicio, inicio + comp);
    if (metodo === 0) salida.set(nombre, crudo.slice());
    else if (metodo === 8) {
      if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador no puede descomprimir ZIP comprimidos. Usá un ZIP exportado por la app.');
      const s = new Blob([crudo]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      salida.set(nombre, new Uint8Array(await new Response(s).arrayBuffer()));
    } else throw new Error(`Método de compresión no soportado en “${nombre}”.`);
  }
  return salida;
}
