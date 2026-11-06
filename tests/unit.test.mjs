// Pruebas unitarias (Node 18+): node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MotorProximidad, distanciaMetros, puntoAlEste, puntoEnTrazado, largoTrazado } from '../js/geo.js';
import * as M from '../js/model.js';
import { crearZip, leerZip, crc32 } from '../js/zip.js';

const spot = { id: 'spot-test', titulo: 'T', lat: -34.6, lng: -58.4, radioEntradaMetros: 20, radioSalidaMetros: 35, habilitado: true };
const a = (m) => { const [lat, lng] = puntoAlEste(spot.lat, spot.lng, m); return { lat, lng, accuracy: 5 }; };

test('distancia y punto al este son consistentes', () => {
  const p = a(100);
  assert.ok(Math.abs(distanciaMetros(spot.lat, spot.lng, p.lat, p.lng) - 100) < 0.5);
});

test('entrada, permanencia, salida y reingreso con histéresis', () => {
  const m = new MotorProximidad(); m.setSpots([spot]);
  const tipos = (pos) => m.actualizar(pos).eventos.map((e) => e.tipo).join(',');
  assert.equal(tipos(a(100)), '');            // lejos
  assert.equal(tipos(a(15)), 'entrada');      // entra
  assert.equal(tipos(a(10)), '');             // permanece: sin repetir
  assert.equal(tipos(a(30)), '');             // zona de histéresis (20–35): sigue dentro, sin evento
  assert.equal(tipos(a(18)), '');             // vuelve al radio: NO re-dispara
  assert.equal(tipos(a(36)), 'salida');       // sale más allá del radio de salida
  assert.equal(tipos(a(30)), '');             // entre radios desde afuera: no entra
  assert.equal(tipos(a(19)), 'entrada');      // reingreso: dispara otra vez
});

test('ruido GPS alrededor del borde no genera disparos repetidos', () => {
  const m = new MotorProximidad(); m.setSpots([spot]);
  let entradas = 0;
  for (const d of [25, 19, 22, 18, 24, 21, 17, 26, 20, 23, 19]) entradas += m.actualizar(a(d)).eventos.filter((e) => e.tipo === 'entrada').length;
  assert.equal(entradas, 1);
});

test('lecturas con mala precisión se ignoran', () => {
  const m = new MotorProximidad({ precisionMaxima: 50 }); m.setSpots([spot]);
  const r = m.actualizar({ ...a(5), accuracy: 80 });
  assert.equal(r.eventos.length, 0); assert.deepEqual(r.ignorados, ['spot-test']);
  assert.equal(m.actualizar({ ...a(5), accuracy: 10 }).eventos.length, 1);
});

test('spots deshabilitados no se activan', () => {
  const m = new MotorProximidad(); m.setSpots([{ ...spot, habilitado: false }]);
  assert.equal(m.actualizar(a(0)).eventos.length, 0);
});

test('interpolación sobre trazado', () => {
  const tr = [[spot.lat, spot.lng], puntoAlEste(spot.lat, spot.lng, 200)];
  assert.ok(Math.abs(largoTrazado(tr) - 200) < 1);
  const p = puntoEnTrazado(tr, 50);
  assert.ok(Math.abs(distanciaMetros(spot.lat, spot.lng, p[0], p[1]) - 50) < 1);
});

test('validación de spot', () => {
  const s = M.nuevoSpot(-34.6, -58.4);
  assert.deepEqual(M.validarSpot(s), []);
  assert.ok(M.validarSpot({ ...s, lat: 95 }).length);
  assert.ok(M.validarSpot({ ...s, radioSalidaMetros: s.radioEntradaMetros }).length);
  assert.ok(M.validarSpot({ ...s, titulo: '  ' }).length);
});

test('proyecto de ejemplo: válido, “Recorrido ejemplo”, sin errores', async () => {
  const raw = JSON.parse(await readFile(new URL('../data/project.json', import.meta.url)));
  const { proyecto, avisos } = M.normalizarProyecto(raw);
  assert.equal(avisos.length, 0);
  assert.equal(proyecto.recorridos[0].titulo, 'Recorrido ejemplo');
  assert.deepEqual(M.validarProyecto(proyecto).errores, []);
});

test('normalización: descarta duplicados, referencias rotas y rutas de medios peligrosas', () => {
  const raw = {
    formato: M.FORMATO, version: 1,
    spots: [
      { id: 'spot-uno', titulo: 'A\u0007', lat: '-34,6', lng: -58.4, radioEntradaMetros: 20, radioSalidaMetros: 10, audio: { id: '../../x', ext: 'mp3', mime: 'audio/mpeg' } },
      { id: 'spot-uno', titulo: 'dup', lat: 0, lng: 0 },
      { id: 'spot-dos', titulo: 'B', lat: 200, lng: 0 },
    ],
    recorridos: [{ id: 'rec-uno', titulo: 'R', trazado: [[0, 0], ['x', 1]], spotIds: ['spot-uno', 'spot-x', 'spot-uno'] }],
    cursos: [{ id: 'curso-uno', nombre: 'C', enlaceId: 'Mal Slug', recorridoIds: ['rec-uno', 'rec-nada'] }],
  };
  const { proyecto: p } = M.normalizarProyecto(raw);
  assert.equal(p.spots.length, 1);
  assert.equal(p.spots[0].titulo, 'A');
  assert.equal(p.spots[0].lat, -34.6);
  assert.ok(p.spots[0].radioSalidaMetros > p.spots[0].radioEntradaMetros);
  assert.equal(p.spots[0].audio, null);
  assert.deepEqual(p.recorridos[0].spotIds, ['spot-uno']);
  assert.equal(p.recorridos[0].trazado.length, 1);
  assert.deepEqual(p.cursos[0].recorridoIds, ['rec-uno']);
  assert.equal(p.cursos[0].enlaceId, 'c');
  assert.throws(() => M.normalizarProyecto({ formato: 'otro' }));
});

test('spot compartido: un solo objeto referenciado por dos recorridos', () => {
  const p = M.nuevoProyecto();
  const s = M.nuevoSpot(-34.6, -58.4); p.spots.push(s);
  const r1 = M.nuevoRecorrido('R1'), r2 = M.nuevoRecorrido('R2');
  r1.spotIds.push(s.id); r2.spotIds.push(s.id); p.recorridos.push(r1, r2);
  M.buscarSpot(p, r1.spotIds[0]).radioEntradaMetros = 60;
  assert.equal(M.buscarSpot(p, r2.spotIds[0]).radioEntradaMetros, 60);
  assert.equal(M.recorridosQueUsan(p, s.id).length, 2);
});

test('slugs únicos por curso', () => {
  const p = M.nuevoProyecto();
  const c1 = M.nuevoCurso(p, 'Historia 3°A'); p.cursos.push(c1);
  const c2 = M.nuevoCurso(p, 'Historia 3°A'); p.cursos.push(c2);
  assert.equal(c1.enlaceId, 'historia-3-a');
  assert.notEqual(c1.enlaceId, c2.enlaceId);
});

test('ZIP: ida y vuelta', async () => {
  const z = await crearZip([{ nombre: 'data/project.json', datos: '{"a":"ñ"}' }, { nombre: 'data/media/x.bin', datos: new Uint8Array([1, 2, 3]) }]);
  const m = await leerZip(z);
  assert.equal(new TextDecoder().decode(m.get('data/project.json')), '{"a":"ñ"}');
  assert.deepEqual([...m.get('data/media/x.bin')], [1, 2, 3]);
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});
