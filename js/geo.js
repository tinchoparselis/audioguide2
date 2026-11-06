// Distancias y motor de proximidad con histéresis (compartido por estudiante y simulador).

const R = 6371008.8; // radio medio terrestre en metros
const rad = (g) => (g * Math.PI) / 180;

export function distanciaMetros(lat1, lng1, lat2, lng2) {
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Punto a `metros` hacia el este de (lat,lng). Útil para manijas de radio. */
export function puntoAlEste(lat, lng, metros) {
  return [lat, lng + (metros / (R * Math.cos(rad(lat)))) * (180 / Math.PI)];
}

/** Interpola posición a lo largo de una polilínea [[lat,lng],...] a `d` metros del inicio. */
export function puntoEnTrazado(trazado, d) {
  let acum = 0;
  for (let i = 1; i < trazado.length; i++) {
    const [a, b] = [trazado[i - 1], trazado[i]];
    const seg = distanciaMetros(a[0], a[1], b[0], b[1]);
    if (acum + seg >= d) {
      const t = seg ? (d - acum) / seg : 0;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    acum += seg;
  }
  return trazado.length ? trazado[trazado.length - 1] : null;
}

export function largoTrazado(trazado) {
  let t = 0;
  for (let i = 1; i < trazado.length; i++) t += distanciaMetros(trazado[i - 1][0], trazado[i - 1][1], trazado[i][0], trazado[i][1]);
  return t;
}

/**
 * Motor de proximidad.
 * - Un spot pasa a "dentro" cuando la distancia <= radioEntradaMetros.
 * - Vuelve a "fuera" sólo cuando la distancia > radioSalidaMetros (histéresis):
 *   el ruido del GPS cerca del borde no genera disparos repetidos.
 * - Las lecturas con precisión peor que max(precisionMaxima, radioEntrada) se ignoran para ese spot.
 * - Reingreso: tras salir más allá del radio de salida, volver a entrar genera otro evento 'entrada'.
 */
export class MotorProximidad {
  constructor({ precisionMaxima = 50 } = {}) {
    this.precisionMaxima = precisionMaxima;
    this.estado = new Map(); // id -> true (dentro) | false (fuera)
    this.spots = [];
  }
  setSpots(spots) {
    this.spots = spots.filter((s) => s && s.habilitado !== false);
    const ids = new Set(this.spots.map((s) => s.id));
    for (const id of [...this.estado.keys()]) if (!ids.has(id)) this.estado.delete(id);
  }
  reiniciar() { this.estado.clear(); }
  estaDentro(id) { return this.estado.get(id) === true; }

  /** pos: {lat, lng, accuracy}. Devuelve {distancias: Map, eventos: [{tipo, spot, distancia}], ignorados: [ids]} */
  actualizar(pos) {
    const res = { distancias: new Map(), eventos: [], ignorados: [] };
    for (const s of this.spots) {
      const d = distanciaMetros(pos.lat, pos.lng, s.lat, s.lng);
      res.distancias.set(s.id, d);
      const limite = Math.max(this.precisionMaxima, s.radioEntradaMetros);
      if (pos.accuracy != null && pos.accuracy > limite) { res.ignorados.push(s.id); continue; }
      const dentro = this.estado.get(s.id) === true;
      if (!dentro && d <= s.radioEntradaMetros) {
        this.estado.set(s.id, true);
        res.eventos.push({ tipo: 'entrada', spot: s, distancia: d });
      } else if (dentro && d > s.radioSalidaMetros) {
        this.estado.set(s.id, false);
        res.eventos.push({ tipo: 'salida', spot: s, distancia: d });
      } else if (!this.estado.has(s.id)) {
        this.estado.set(s.id, false);
      }
    }
    // Si se entra a varios a la vez, primero el más cercano.
    res.eventos.sort((a, b) => (a.tipo === b.tipo ? a.distancia - b.distancia : a.tipo === 'entrada' ? -1 : 1));
    return res;
  }
}
