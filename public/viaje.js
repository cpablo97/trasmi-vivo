// Lógica de «Planear viaje». Aquí no hay mapa ni HTML: solo funciones que reciben
// datos y devuelven datos. Por eso se pueden probar con Node (npm test).
//
// La "red" es public/red.json:
//   red.paradas[id] = [lon, lat, nombre]
//   red.rutas[id]   = { c: "B10", d: "Portal Norte", s: "Troncal", p: [[idParada, minuto], ...] }
// p es el recorrido en orden; "minuto" es cuándo pasa el bus por esa parada,
// contado desde que sale de la primera, según el horario oficial.

const METROS_POR_MINUTO = 80; // paso normal caminando
const KX = 111320 * Math.cos((4.65 * Math.PI) / 180); // metros por grado de longitud en Bogotá
const KY = 110540; // metros por grado de latitud

// Convierte [lon, lat] a metros en un plano. A escala de ciudad la Tierra es
// prácticamente plana, así que no hace falta trigonometría esférica.
const plano = ([lon, lat]) => [lon * KX, lat * KY];

/** Metros entre dos puntos [lon, lat]. */
export function distancia(a, b) {
  const [ax, ay] = plano(a), [bx, by] = plano(b);
  return Math.hypot(ax - bx, ay - by);
}

/** Paradas a menos de `radio` metros de `punto`: Map idParada -> metros. */
export function cercanas(red, punto, radio) {
  const m = new Map();
  for (const id in red.paradas) {
    const d = distancia(red.paradas[id], punto);
    if (d <= radio) m.set(id, d);
  }
  return m;
}

/**
 * Rutas directas: pasan cerca del origen y DESPUÉS cerca del destino.
 * Devuelve una opción por ruta, con dónde subir y dónde bajar.
 */
export function buscarOpciones(red, origen, destino, radioOrigen, radioDestino) {
  const cercaOrigen = cercanas(red, origen, radioOrigen);
  const cercaDestino = cercanas(red, destino, radioDestino);
  const opciones = [];

  for (const id in red.rutas) {
    const ruta = red.rutas[id];
    let mejor = null;
    // mejorSubida: la mejor parada para subir vista hasta ahora en el recorrido.
    // Al avanzar en orden, cualquier bajada posterior queda automáticamente
    // "después" de ella; así se respeta el sentido, incluso en rutas circulares.
    let mejorSubida = null;
    ruta.p.forEach(([parada, minuto], i) => {
      const aDestino = cercaDestino.get(parada);
      if (aDestino !== undefined && mejorSubida) {
        const viaje = minuto - mejorSubida.minuto;
        const costo = mejorSubida.costo + minuto + aDestino / METROS_POR_MINUTO;
        if (viaje > 0 && (!mejor || costo < mejor.costo)) {
          mejor = { costo, iSubir: mejorSubida.i, iBajar: i, viaje, metrosIda: mejorSubida.metros, metrosLlegada: aDestino };
        }
      }
      const aOrigen = cercaOrigen.get(parada);
      if (aOrigen !== undefined) {
        // costo = caminar hasta ahí menos el minuto en que pasa el bus:
        // subir más adelante en el recorrido ahorra tiempo de viaje.
        const costo = aOrigen / METROS_POR_MINUTO - minuto;
        if (!mejorSubida || costo < mejorSubida.costo) mejorSubida = { costo, i, minuto, metros: aOrigen };
      }
    });
    if (!mejor) continue;

    const parada = (i) => { const pid = ruta.p[i][0]; return { id: pid, nombre: red.paradas[pid][2], pos: red.paradas[pid].slice(0, 2) }; };
    opciones.push({
      id,
      codigo: ruta.c, destino: ruta.d, sistema: ruta.s,
      iSubir: mejor.iSubir, iBajar: mejor.iBajar,
      subir: parada(mejor.iSubir), bajar: parada(mejor.iBajar),
      minutoSubir: ruta.p[mejor.iSubir][1],
      caminaIda: mejor.metrosIda / METROS_POR_MINUTO,       // minutos a pie hasta el paradero
      viaje: mejor.viaje,                                    // minutos en el bus
      caminaLlegada: mejor.metrosLlegada / METROS_POR_MINUTO, // minutos a pie hasta el centro del destino
    });
  }
  return opciones;
}

/**
 * ¿Por dónde va un bus dentro del recorrido de su ruta?
 *
 * El feed dice qué ruta lleva el bus, pero la parada que reporta no es fiable,
 * así que se usa su GPS: se busca el tramo (entre dos paradas seguidas) más
 * cercano. En rutas circulares un bus puede estar cerca de dos tramos, uno de
 * ida y otro de vuelta; ahí se desempata con su rumbo (hacia dónde se movió).
 *
 * Devuelve { minuto } (el minuto del horario equivalente a su posición),
 * { ambiguo: true, minutos: [...] } si no se puede saber el sentido todavía,
 * o null si el bus está lejos de la ruta.
 */
export function ubicarBus(red, ruta, pos, rumbo) {
  const [px, py] = plano(pos);
  const candidatos = [];
  let menor = Infinity;

  for (let i = 0; i < ruta.p.length - 1; i++) {
    const [ax, ay] = plano(red.paradas[ruta.p[i][0]]);
    const [bx, by] = plano(red.paradas[ruta.p[i + 1][0]]);
    const dx = bx - ax, dy = by - ay, largo2 = dx * dx + dy * dy;
    // t = en qué fracción del tramo cae el bus (0 = primera parada, 1 = segunda).
    const t = largo2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / largo2)) : 0;
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    const minuto = ruta.p[i][1] + t * (ruta.p[i + 1][1] - ruta.p[i][1]);
    candidatos.push({ d, minuto, dx, dy });
    if (d < menor) menor = d;
  }
  if (menor > 400) return null; // va para el patio, o por un desvío

  // Tramos casi tan cercanos como el mejor.
  let buenos = candidatos.filter((c) => c.d <= menor + 80);
  const disperso = (lista) => Math.max(...lista.map((c) => c.minuto)) - Math.min(...lista.map((c) => c.minuto)) > 3;

  if (disperso(buenos) && rumbo) {
    // Quedarse con los tramos que apuntan hacia donde se mueve el bus.
    const [rx, ry] = rumbo, r = Math.hypot(rx, ry);
    const alineados = buenos.filter((c) => (c.dx * rx + c.dy * ry) / ((Math.hypot(c.dx, c.dy) || 1) * r) > 0.3);
    if (alineados.length) buenos = alineados;
  }
  if (disperso(buenos)) return { ambiguo: true, minutos: buenos.map((c) => c.minuto) };
  return { minuto: buenos.reduce((a, b) => (b.d < a.d ? b : a)).minuto };
}

/**
 * Tiempo total de una opción según los buses de esa ruta que vienen en camino.
 * `buses` = lo que devolvió ubicarBus para cada bus de la ruta, más hace_s.
 */
export function estimar(opcion, buses) {
  // Llegadas al paradero, en minutos desde ahora, de los buses que aún no pasaron.
  const llegadas = [];
  let porConfirmar = 0;
  for (const b of buses) {
    if (!b) continue;
    if (b.ambiguo) { if (b.minutos.some((m) => m < opcion.minutoSubir)) porConfirmar++; continue; }
    // El dato tiene hace_s segundos: el bus ya avanzó ese tiempo.
    const falta = opcion.minutoSubir - b.minuto - (b.hace_s || 0) / 60;
    if (b.minuto < opcion.minutoSubir) llegadas.push(Math.max(0, falta));
  }
  llegadas.sort((a, b) => a - b);
  // El primer bus que llega cuando ya estás en el paradero.
  const bus = llegadas.find((m) => m >= opcion.caminaIda - 1);
  const resto = opcion.viaje + opcion.caminaLlegada;
  return {
    enCamino: llegadas.length,
    porConfirmar,
    espera: bus === undefined ? null : bus, // minutos hasta que pasa tu bus
    total: bus === undefined ? null : Math.max(bus, opcion.caminaIda) + resto,
    // Sin bus a la vista, al menos se sabe cuánto dura una vez te subes.
    sinEspera: opcion.caminaIda + resto,
  };
}

const simple = (texto) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Busca estaciones y paraderos por nombre, sin importar tildes ni mayúsculas. */
export function buscarParadas(red, texto, limite = 8) {
  const q = simple(texto.trim());
  if (q.length < 2) return [];
  const vistos = new Map();
  for (const id in red.paradas) {
    const [lon, lat, nombre] = red.paradas[id];
    // "Museo Nacional A - 2 ó 5" y "Museo Nacional B - 7" son vagones de la misma
    // estación: se quita el sufijo del vagón para mostrarla una sola vez.
    const limpio = nombre.replace(/\s+(?:[A-H]|T\d?)\s*-\s*.*$/, "").replace(/^Estación\s+/i, "");
    const clave = simple(limpio);
    if (!clave.includes(q) || vistos.has(clave)) continue;
    vistos.set(clave, { nombre: limpio, pos: [lon, lat], empieza: clave.startsWith(q) });
  }
  return [...vistos.values()].sort((a, b) => b.empieza - a.empieza || a.nombre.length - b.nombre.length).slice(0, limite);
}

/** Polígono circular en GeoJSON (para dibujar un radio en el mapa). */
export function circulo([lon, lat], radio, puntos = 64) {
  const anillo = [];
  for (let i = 0; i <= puntos; i++) {
    const a = (i / puntos) * 2 * Math.PI;
    anillo.push([lon + (radio * Math.cos(a)) / KX, lat + (radio * Math.sin(a)) / KY]);
  }
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [anillo] }, properties: {} };
}
