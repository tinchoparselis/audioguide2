// Ayudas de Leaflet compartidas.
/* global L */
import { TILES_OSM } from './model.js';

export function crearMapa(el, ajustes, opciones = {}) {
  const t = ajustes?.tiles?.url ? ajustes.tiles : TILES_OSM;
  const mapa = L.map(el, { zoomControl: true, ...opciones });
  const capa = L.tileLayer(t.url, { maxZoom: t.maxZoom || 19, attribution: t.atribucion || TILES_OSM.atribucion });
  let avisado = false;
  capa.on('tileerror', () => { if (!avisado) { avisado = true; el.dispatchEvent(new CustomEvent('tiles-error', { bubbles: true })); } });
  capa.addTo(mapa);
  mapa.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  mapa.setView([-34.6037, -58.3816], 13);
  return mapa;
}

export function iconoSpot(etiqueta, clase = '') {
  return L.divIcon({
    className: `spot-icono ${clase}`,
    html: `<span>${String(etiqueta).replace(/[^0-9A-Za-z+✓•]/g, '').slice(0, 3)}</span>`,
    iconSize: [30, 30], iconAnchor: [15, 15],
  });
}

export function encuadrar(mapa, puntos, zoomMax = 17) {
  const validos = puntos.filter((p) => p && isFinite(p[0]) && isFinite(p[1]));
  if (!validos.length) return;
  if (validos.length === 1) mapa.setView(validos[0], Math.min(zoomMax, 17));
  else mapa.fitBounds(L.latLngBounds(validos), { padding: [30, 30], maxZoom: zoomMax });
}
