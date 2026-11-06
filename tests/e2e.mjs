// Prueba de punta a punta con Playwright + Chromium (GPS y micrófono simulados por el navegador de prueba).
// Uso: servir la carpeta en http://localhost:8080 (npm start) y luego: node tests/e2e.mjs
// Variables: BASE (default http://localhost:8080/), CAPTURAS=carpeta para guardar capturas.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright'); // instalado global o con: npm i -D playwright
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { crearZip, leerZip } from '../js/zip.js';

const BASE = process.env.BASE || 'http://localhost:8080/';
const CAPTURAS = process.env.CAPTURAS;
const resultados = [];
async function paso(nombre, fn) {
  try { await fn(); resultados.push(['OK', nombre]); console.log('✔', nombre); }
  catch (e) { resultados.push(['FALLA', nombre, e.message]); console.log('✘', nombre, '\n   ', e.message.split('\n').slice(0, 14).join('\n    ')); }
}

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
// Los mosaicos de OSM se reemplazan por un fondo liso: la prueba no depende de la red.
const tile = await (async () => { const p = await browser.newPage(); const b = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'); x.fillStyle = '#e8ece6'; x.fillRect(0, 0, 256, 256); x.strokeStyle = '#d3d9d0'; x.strokeRect(0, 0, 256, 256); return c.toDataURL('image/png').split(',')[1]; }); await p.close(); return Buffer.from(b, 'base64'); })();
async function nuevoContexto(opts = {}) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true, ...opts });
  await ctx.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ body: tile, contentType: 'image/png' }));
  return ctx;
}
const ctx = await nuevoContexto({ viewport: { width: 1280, height: 860 }, permissions: ['microphone', 'geolocation'] });
const page = await ctx.newPage();
const erroresConsola = [];
page.on('pageerror', (e) => erroresConsola.push(e.message));
page.on('dialog', (d) => d.accept());

const leerIDB = (pg) => pg.evaluate(() => new Promise((res, rej) => {
  const r = indexedDB.open('audioguia-db', 1);
  r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('proyecto'); g.onsuccess = () => res(g.result); g.onerror = rej; };
  r.onerror = rej;
}));
const esperarGuardado = (pg) => pg.waitForFunction(() => document.querySelector('#estadoGuardado')?.textContent.includes('Guardado'), null, { timeout: 5000 });
const panel = page.locator('#panel');

await paso('Admin abre y carga el contenido publicado (Recorrido ejemplo)', async () => {
  await page.goto(BASE + 'admin.html#spots');
  await page.getByRole('heading', { name: /Biblioteca de spots \(3\)/ }).waitFor({ timeout: 10000 });
  const p = await leerIDB(page);
  assert.equal(p.recorridos[0].titulo, 'Recorrido ejemplo');
});

let idNuevo;
await paso('A. Crear spot con título, coordenadas, radio y texto; adjuntar audio', async () => {
  await panel.getByRole('button', { name: '+ En el centro del mapa' }).click();
  await page.locator('#spotTitulo').fill('Spot de prueba compartido');
  await panel.getByLabel('Latitud').fill('-34.6079'); await panel.getByLabel('Latitud').blur();
  await panel.getByLabel('Longitud').fill('-58.3700'); await panel.getByLabel('Longitud').blur();
  await panel.getByLabel('Radio de entrada (m)').fill('30'); await panel.getByLabel('Radio de entrada (m)').blur();
  await panel.getByLabel(/Texto \/ guion/).fill('Texto de prueba del spot compartido.');
  await page.locator('#subirAudio').setInputFiles('data/media/ejemplo-audio-2.mp3');
  await panel.locator('audio.audio-admin').waitFor();
  await esperarGuardado(page);
  const p = await leerIDB(page);
  const s = p.spots.find((x) => x.titulo === 'Spot de prueba compartido');
  assert.ok(s, 'spot guardado'); idNuevo = s.id;
  assert.equal(s.lat, -34.6079); assert.equal(s.lng, -58.37);
  assert.equal(s.radioEntradaMetros, 30); assert.ok(s.radioSalidaMetros > 30);
  assert.equal(s.audio.mime, 'audio/mpeg');
  const dur = await panel.locator('audio.audio-admin').evaluate((a) => new Promise((r) => (a.readyState >= 1 ? r(a.duration) : a.addEventListener('loadedmetadata', () => r(a.duration)))));
  assert.ok(dur > 5, `duración ${dur}`);
});

await paso('Validación: radio de salida menor que entrada muestra error y no se guarda', async () => {
  await panel.getByLabel('Radio de salida (m)').fill('10'); await panel.getByLabel('Radio de salida (m)').blur();
  await panel.getByText(/Debe ser mayor que el radio de entrada/).waitFor();
  const p = await leerIDB(page);
  assert.ok(p.spots.find((x) => x.id === idNuevo).radioSalidaMetros > 30);
});

await paso('B. Grabar audio con el micrófono y conservarlo al recargar', async () => {
  await panel.getByRole('button', { name: /Grabar con el micrófono/ }).click();
  await panel.getByText(/Grabando/).waitFor();
  await page.waitForTimeout(2200);
  await panel.getByRole('button', { name: '■ Detener' }).click();
  await panel.getByRole('button', { name: '✓ Guardar en el spot' }).click();
  await panel.getByText(/grabacion-.*WEBM|grabacion-.*M4A|grabacion-.*OGG/i).waitFor();
  await esperarGuardado(page);
  await page.reload();
  await panel.getByRole('heading', { name: /Biblioteca/ }).waitFor();
  await panel.getByRole('button', { name: /Spot de prueba compartido/ }).click();
  await panel.getByText(/grabacion-/).waitFor();
  const ok = await panel.locator('audio.audio-admin').first().evaluate((a) => new Promise((r) => { const t = setTimeout(() => r(false), 4000); if (a.readyState >= 1) { clearTimeout(t); r(true); } a.addEventListener('loadedmetadata', () => { clearTimeout(t); r(true); }); }));
  assert.ok(ok, 'la grabación recuperada se puede cargar');
});

await paso('Duplicar spot y eliminar la copia (con confirmación)', async () => {
  await panel.getByRole('button', { name: 'Duplicar' }).click();
  await page.locator('#spotH2', { hasText: '(copia)' }).waitFor();
  await panel.getByRole('button', { name: 'Eliminar spot' }).click();
  await panel.getByRole('heading', { name: /Biblioteca de spots \(4\)/ }).waitFor();
});

async function nuevoRecorridoConTrazado(nombre, puntos) {
  await page.getByRole('tab', { name: 'Recorridos' }).click();
  await panel.getByRole('button', { name: '+ Nuevo recorrido' }).click();
  await panel.getByLabel('Título').fill(nombre);
  const caja = await page.locator('#mapa').boundingBox();
  for (const [fx, fy] of puntos) await page.mouse.click(caja.x + caja.width * fx, caja.y + caja.height * fy);
  await panel.getByRole('button', { name: /Terminar de dibujar/ }).click();
  await panel.getByLabel('Buscar spot').fill('compartido');
  await panel.getByRole('button', { name: '+ Agregar' }).first().click();
  await panel.getByLabel('Estado').selectOption('publicado');
  await esperarGuardado(page);
}

await paso('C/D. Dos recorridos con trazados distintos que comparten un spot', async () => {
  await nuevoRecorridoConTrazado('Recorrido Uno', [[0.3, 0.3], [0.5, 0.4], [0.7, 0.3]]);
  await nuevoRecorridoConTrazado('Recorrido Dos', [[0.3, 0.7], [0.6, 0.75]]);
  const p = await leerIDB(page);
  const r1 = p.recorridos.find((r) => r.titulo === 'Recorrido Uno'), r2 = p.recorridos.find((r) => r.titulo === 'Recorrido Dos');
  assert.equal(r1.trazado.length, 3); assert.equal(r2.trazado.length, 2);
  assert.notDeepEqual(r1.trazado, r2.trazado);
  assert.deepEqual(r1.spotIds, [idNuevo]); assert.deepEqual(r2.spotIds, [idNuevo]);
});

await paso('D. Editar trazado: insertar punto intermedio y eliminar un vértice', async () => {
  await panel.getByRole('button', { name: '← Recorridos' }).click();
  await panel.getByRole('button', { name: /Recorrido Uno/ }).click();
  await page.locator('.vertice-medio').first().click();
  await esperarGuardado(page);
  let p = await leerIDB(page);
  assert.equal(p.recorridos.find((r) => r.titulo === 'Recorrido Uno').trazado.length, 4);
  await page.locator('.vertice').nth(1).click();
  await page.locator('.leaflet-popup').getByRole('button', { name: 'Eliminar punto' }).click();
  await esperarGuardado(page);
  p = await leerIDB(page);
  assert.equal(p.recorridos.find((r) => r.titulo === 'Recorrido Uno').trazado.length, 3);
});

await paso('C. Radio editado una sola vez se refleja en ambos recorridos', async () => {
  await panel.getByRole('button', { name: 'Editar Spot de prueba compartido' }).click();
  await panel.getByLabel('Radio de entrada (m)').fill('55'); await panel.getByLabel('Radio de entrada (m)').blur();
  await esperarGuardado(page);
  const p = await leerIDB(page);
  assert.equal(p.spots.filter((s) => s.titulo === 'Spot de prueba compartido').length, 1, 'no se duplica');
  for (const t of ['Recorrido Uno', 'Recorrido Dos']) {
    const r = p.recorridos.find((x) => x.titulo === t);
    assert.equal(p.spots.find((s) => s.id === r.spotIds[0]).radioEntradaMetros, 55);
  }
  await panel.getByText(/Usado en: Recorrido Uno, Recorrido Dos/).waitFor();
});

await paso('Eliminar un recorrido no borra el spot compartido', async () => {
  await page.getByRole('tab', { name: 'Recorridos' }).click();
  if (await panel.getByRole('button', { name: '← Recorridos' }).isVisible()) await panel.getByRole('button', { name: '← Recorridos' }).click();
  await panel.getByRole('button', { name: '+ Nuevo recorrido' }).click();
  await panel.getByLabel('Buscar spot').fill('compartido');
  await panel.getByRole('button', { name: '+ Agregar' }).first().click();
  await panel.getByRole('button', { name: 'Eliminar recorrido' }).click();
  await esperarGuardado(page);
  const p = await leerIDB(page);
  assert.ok(p.spots.some((s) => s.id === idNuevo));
  assert.equal(p.recorridos.length, 3);
});

let url1, url2;
await paso('E. Dos cursos con recorridos distintos y enlaces/QR separados', async () => {
  await page.getByRole('tab', { name: 'Cursos' }).click();
  for (const [nombre, rec, slug] of [['Historia 3A', 'Recorrido Uno', 'historia-3a'], ['Geografía 4B', 'Recorrido Dos', 'geografia-4b']]) {
    await panel.getByRole('button', { name: '+ Nuevo curso' }).click();
    await panel.getByLabel('Nombre del curso').fill(nombre);
    await panel.getByLabel('Identificador del enlace').fill(slug);
    await panel.getByLabel('Identificador del enlace').blur();
    await panel.getByLabel(rec).check();
    await panel.locator('img.qr').waitFor();
    const url = await panel.getByLabel('Enlace para estudiantes').inputValue();
    if (!url1) url1 = url; else url2 = url;
    await panel.getByRole('button', { name: '← Cursos' }).click();
  }
  assert.match(url1, /\?curso=historia-3a$/); assert.match(url2, /\?curso=geografia-4b$/);
  assert.notEqual(url1, url2);
});

await paso('Identificador de curso duplicado es rechazado', async () => {
  await panel.getByRole('button', { name: /Geografía 4B/ }).click();
  await panel.getByLabel('Identificador del enlace').fill('historia-3a'); await panel.getByLabel('Identificador del enlace').blur();
  await panel.getByText('Ese identificador ya lo usa otro curso.').waitFor();
  await esperarGuardado(page);
  const p = await leerIDB(page);
  assert.deepEqual(p.cursos.map((c) => [c.nombre, c.enlaceId]).slice(-2), [['Historia 3A', 'historia-3a'], ['Geografía 4B', 'geografia-4b']]);
});

const log = page.locator('.log');
await paso('F. Simulador: entrada, permanencia, histéresis, salida, cola y reingreso sin bucles', async () => {
  await page.getByRole('tab', { name: 'Simulador GPS' }).click();
  await page.locator('#insigniaSim').waitFor();
  await page.locator('#simRec').selectOption({ label: 'Recorrido ejemplo' });
  await panel.getByRole('radio', { name: 'Automático', exact: true }).check();
  const fila = (n) => panel.locator('tbody tr', { hasText: n });
  await fila('Spot ficticio A').getByRole('button', { name: /^Ir al centro/ }).click();
  await log.getByText(/ENTRADA a “Spot ficticio A.*reproducción automática/).waitFor();
  await page.waitForFunction(() => document.querySelector('.rep-estado')?.dataset.estado === 'reproduciendo', null, { timeout: 5000 });
  // Permanencia y zona de histéresis: no hay nuevos eventos
  await fila('Spot ficticio A').getByRole('button', { name: /zona de histéresis/ }).click();
  assert.equal(await log.getByText(/ENTRADA a “Spot ficticio A/).count(), 1);
  assert.match(await fila('Spot ficticio A').textContent(), /DENTRO/);
  // Entrar a B mientras suena A → en espera
  await fila('Spot ficticio B').getByRole('button', { name: /^Ir al centro/ }).click();
  await log.getByText(/ENTRADA a “Spot ficticio B.*EN ESPERA/).waitFor();
  assert.match(await fila('Spot ficticio A').textContent(), /FUERA/);
  await panel.getByText('En espera (1)').waitFor();
  // Salir de B y reingresar: no se duplica en la cola
  await fila('Spot ficticio B').getByRole('button', { name: /^Salir/ }).click();
  await log.getByText(/SALIDA de “Spot ficticio B/).waitFor();
  await fila('Spot ficticio B').getByRole('button', { name: /^Ir al centro/ }).click();
  await log.getByText(/ENTRADA a “Spot ficticio B.*no se duplica/).waitFor();
  // Al terminar A (6 s), B arranca solo
  await page.waitForFunction(() => document.querySelector('.rep-titulo')?.textContent.includes('Spot ficticio B') && document.querySelector('.rep-estado').dataset.estado === 'reproduciendo', null, { timeout: 12000 });
  // Reingreso a A tras salir: vuelve a activarse (y queda en espera porque suena B)
  await fila('Spot ficticio A').getByRole('button', { name: /^Ir al centro/ }).click();
  await log.getByText(/ENTRADA a “Spot ficticio A.*EN ESPERA/).waitFor();
  assert.equal(await log.getByText(/ENTRADA a “Spot ficticio A/).count(), 2);
  if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/admin-simulador.png` });
});

await paso('F. Precisión mala: las lecturas se ignoran', async () => {
  await panel.getByRole('button', { name: 'Reiniciar estados' }).click();
  await page.locator('#simPrec').fill('100');
  await panel.locator('tbody tr', { hasText: 'Spot ficticio C' }).getByRole('button', { name: /^Ir al centro/ }).click();
  await panel.getByText(/IGNORADA por baja precisión/).waitFor();
  assert.match(await panel.locator('tbody tr', { hasText: 'Spot ficticio C' }).textContent(), /FUERA/);
});

let zipSitio;
await paso('H (parcial). Exportar sitio completo y datos como ZIP', async () => {
  await page.getByRole('tab', { name: 'Proyecto' }).click();
  await panel.getByText('Sin errores.').waitFor();
  const [d1] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: /Sitio completo/ }).click()]);
  zipSitio = await readFile(await d1.path());
  const m = await leerZip(new Blob([zipSitio]));
  for (const f of ['index.html', 'admin.html', 'sw.js', 'js/admin.js', 'vendor/leaflet/leaflet.js', 'data/project.json', 'README.md', '.nojekyll']) assert.ok(m.has(f), `falta ${f}`);
  const p = JSON.parse(new TextDecoder().decode(m.get('data/project.json')));
  const s = p.spots.find((x) => x.titulo === 'Spot de prueba compartido');
  assert.ok(m.has(`data/media/${s.audio.id}.${s.audio.ext}`), 'incluye la grabación');
  const [d2] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: /Sólo datos/ }).click()]);
  const m2 = await leerZip(new Blob([await readFile(await d2.path())]));
  assert.ok(m2.has('data/project.json') && !m2.has('index.html'));
  if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/admin-proyecto.png` });
});

await paso('Importar: rechaza archivo inválido con mensaje claro', async () => {
  await page.locator('#importar').setInputFiles({ name: 'malo.json', mimeType: 'application/json', buffer: Buffer.from('{"hola":1}') });
  await page.getByText(/No se pudo importar: El archivo no es un proyecto/).waitFor();
});

// ---------------- Estudiante ----------------
const movil = await nuevoContexto({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['geolocation'], geolocation: { latitude: -34.6100, longitude: -58.3750, accuracy: 8 } });
const est = await movil.newPage();
est.on('pageerror', (e) => erroresConsola.push(e.message));

await paso('Estudiante: sin enlace pide el código del curso', async () => {
  await est.goto(BASE);
  await est.getByRole('heading', { name: 'Entrá con el enlace de tu curso' }).waitFor();
  await est.getByLabel('Código del curso').fill('curso-inexistente');
  await est.getByRole('button', { name: 'Entrar' }).click();
  await est.getByText(/No encontramos el curso/).waitFor();
});

await paso('Estudiante: el enlace del curso lista sus recorridos publicados', async () => {
  await est.goto(BASE + '?curso=curso-ejemplo');
  await est.getByRole('button', { name: /Recorrido ejemplo/ }).click();
  await est.getByRole('heading', { name: 'Recorrido ejemplo' }).waitFor();
  assert.equal(await est.locator('.lista-spots li').count(), 3);
  if (CAPTURAS) await est.screenshot({ path: `${CAPTURAS}/estudiante-recorrido.png` });
});

await paso('I. Texto accesible sin GPS ni audio', async () => {
  await est.getByRole('button', { name: /Spot ficticio B/ }).click();
  await est.getByRole('dialog').getByText(/Segunda parada de ejemplo/).waitFor();
  if (CAPTURAS) await est.screenshot({ path: `${CAPTURAS}/estudiante-texto.png` });
  await est.getByRole('button', { name: 'Cerrar' }).click();
});

await paso('G. Preferencia manual/automático se conserva al recargar', async () => {
  await est.getByLabel(' Avisarme y reproduzco yo').check();
  await est.reload();
  await est.getByRole('heading', { name: 'Recorrido ejemplo' }).waitFor();
  assert.ok(await est.getByLabel(' Avisarme y reproduzco yo').isChecked());
});

await paso('GPS (emulado por el navegador): lejos → sin activación; al llegar → aviso y audio listo (modo manual)', async () => {
  await est.getByRole('button', { name: /Iniciar seguimiento GPS/ }).click();
  await est.getByText(/GPS activo · precisión ±8 m/).waitFor();
  assert.equal(await est.locator('#llegada').isHidden(), true);
  await movil.setGeolocation({ latitude: -34.60840, longitude: -58.37320, accuracy: 8 });
  await est.getByText('Llegaste a: Spot ficticio A (ejemplo)').waitFor({ timeout: 10000 });
  await est.getByText('Para escuchar (1)').waitFor();
  await est.locator('.lista-spots li.dentro', { hasText: 'Spot ficticio A' }).waitFor();
  await est.getByRole('button', { name: 'Reproducir Spot ficticio A (ejemplo)' }).click();
  await est.waitForFunction(() => document.querySelector('.rep-estado')?.dataset.estado === 'reproduciendo', null, { timeout: 5000 });
  if (CAPTURAS) await est.screenshot({ path: `${CAPTURAS}/estudiante-gps.png`, fullPage: true });
});

await paso('J. Permiso de ubicación denegado: mensaje claro', async () => {
  const sinPermiso = await nuevoContexto({ viewport: { width: 390, height: 844 } });
  const p2 = await sinPermiso.newPage();
  await p2.goto(BASE + '?curso=curso-ejemplo&recorrido=rec-ejemplo');
  await p2.getByRole('button', { name: /Iniciar seguimiento GPS/ }).click();
  await p2.getByText(/Permiso de ubicación denegado/).waitFor({ timeout: 10000 });
  await sinPermiso.close();
});

await paso('Vista previa local muestra los cursos creados en el admin', async () => {
  const p3 = await ctx.newPage();
  await p3.goto(BASE + '?fuente=local&curso=historia-3a');
  await p3.getByRole('button', { name: /Recorrido Uno/ }).click();
  await p3.getByRole('button', { name: /Spot de prueba compartido/ }).waitFor();
});

await paso('Sin errores de JavaScript en consola', async () => { assert.deepEqual(erroresConsola, []); });

await browser.close();
const fallas = resultados.filter((r) => r[0] !== 'OK');
console.log(`\n${resultados.length - fallas.length}/${resultados.length} pasos OK`);
process.exit(fallas.length ? 1 : 0);
