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
 * Devuelve { minuto, i } (el minuto del horario equivalente a su posición y el
 * índice de la última parada que dejó atrás),
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
    candidatos.push({ d, minuto, dx, dy, i });
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
  const mejor = buenos.reduce((a, b) => (b.d < a.d ? b : a));
  // i = índice de la última parada por la que ya pasó.
  // rumbo = hacia dónde apunta el tramo por el que va (0 = norte, 90 = oriente).
  return { minuto: mejor.minuto, i: mejor.i, rumbo: (Math.atan2(mejor.dx, mejor.dy) * 180 / Math.PI + 360) % 360 };
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

// "Museo Nacional A - 2 ó 5" y "Portal 80 T-2" son vagones o plataformas de una
// estación: se les quita ese sufijo para tratar la estación como un solo lugar.
export const nombreLimpio = (nombre) => nombre.replace(/\s+(?:[A-H]|T\d?)\s*-\s*.*$/, "").replace(/\s+T-?\d+$/, "").replace(/^Estación\s+/i, "");

/** Busca estaciones y paraderos por nombre, sin importar tildes ni mayúsculas. */
export function buscarParadas(red, texto, limite = 8) {
  const q = simple(texto.trim());
  if (q.length < 2) return [];
  const vistos = new Map();
  for (const id in red.paradas) {
    const [lon, lat, nombre] = red.paradas[id];
    // "Museo Nacional A - 2 ó 5" y "Museo Nacional B - 7" son vagones de la misma
    // estación: se quita el sufijo del vagón para mostrarla una sola vez.
    const limpio = nombreLimpio(nombre);
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

// ---------------------------------------------------------------------------
// «Mi paradero»: qué buses vienen a un paradero y cuánto les falta.
// ---------------------------------------------------------------------------

/**
 * Lista de "paraderos" entre los que la persona puede elegir.
 *
 * - Los vagones de una estación troncal ("Museo Nacional A - 2 ó 5", "... B - 7")
 *   se juntan en un solo paradero: a la estación se entra una sola vez.
 * - Los paraderos de calle NO se juntan aunque se llamen igual: el de cada costado
 *   sirve a buses que van en sentidos opuestos, y hay que poder elegir entre ellos.
 *
 * Devuelve [{ nombre, pos: [lon, lat], ids: [idParada, ...], estacion: true|false }].
 */
export function agruparParadas(red) {
  const estaciones = new Map(); // nombre limpio -> grupos de vagones
  const paraderos = [];
  for (const id in red.paradas) {
    const [lon, lat, nombre] = red.paradas[id];
    const limpio = nombreLimpio(nombre);
    if (limpio === nombre) { // no tenía sufijo de vagón: es un paradero de calle
      paraderos.push({ nombre, pos: [lon, lat], ids: [id], estacion: false });
      continue;
    }
    const clave = simple(limpio);
    if (!estaciones.has(clave)) estaciones.set(clave, []);
    const grupos = estaciones.get(clave);
    // Mismo nombre y a menos de 300 m: es la misma estación.
    let grupo = grupos.find((g) => distancia(g.pos, [lon, lat]) < 300);
    if (!grupo) grupos.push((grupo = { nombre: limpio, pos: [lon, lat], ids: [], estacion: true }));
    grupo.ids.push(id);
  }
  return [...estaciones.values()].flat().concat(paraderos);
}

// ---------- Sentidos y costados ----------

/** Rumbo de a hacia b en grados: 0 = norte, 90 = oriente, 180 = sur, 270 = occidente. */
export function rumboEntre(a, b) {
  const [ax, ay] = plano(a), [bx, by] = plano(b);
  return (Math.atan2(bx - ax, by - ay) * 180 / Math.PI + 360) % 360;
}

const CARDINALES = ["norte", "nororiente", "oriente", "suroriente", "sur", "suroccidente", "occidente", "noroccidente"];
const FLECHAS = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];
const octante = (grados) => Math.round((((grados % 360) + 360) % 360) / 45) % 8;

/** "norte", "suroriente"... para un rumbo en grados. */
export const puntoCardinal = (grados) => CARDINALES[octante(grados)];
/** La flecha que corresponde a ese rumbo. */
export const flecha = (grados) => FLECHAS[octante(grados)];

/**
 * En qué costado de la vía queda un paradero cuyos buses van hacia `grados`.
 * En Colombia se circula por la derecha y los buses abren a la derecha, así que
 * el paradero está a la derecha del sentido de marcha: si los buses van al norte,
 * el paradero queda en el costado oriental.
 */
export const costado = (grados) => ["oriental", "suroriental", "sur", "suroccidental", "occidental", "noroccidental", "norte", "nororiental"][octante(grados)];

/** Hacia dónde sale una ruta después de la parada número i de su recorrido. */
function rumboAlSalir(red, ruta, i) {
  const p = ruta.p;
  // En la última parada no hay "siguiente": se usa el tramo con el que llega.
  const [a, b] = i < p.length - 1 ? [i, i + 1] : [i - 1, i];
  return rumboEntre(red.paradas[p[a][0]], red.paradas[p[b][0]]);
}

/**
 * Hacia dónde van los buses que paran en un paradero.
 * Un paradero de calle suele tener un solo sentido; una estación troncal, dos.
 * Devuelve [{ grados, nombre, flecha, rutas }] del sentido con más rutas al de menos.
 */
export function sentidosDeParadero(red, indice, paradero) {
  const porOctante = new Map();
  let total = 0;
  for (const id of paradero.ids) {
    for (const { ruta, i } of indice.get(id) || []) {
      const o = octante(rumboAlSalir(red, red.rutas[ruta], i));
      porOctante.set(o, (porOctante.get(o) || 0) + 1);
      total++;
    }
  }
  // "Sur" y "suroccidente" en una misma avenida son el mismo sentido para quien espera
  // el bus: los rumbos vecinos se juntan con el que más rutas tiene.
  const grupos = [];
  for (const [o, n] of [...porOctante].sort((a, b) => b[1] - a[1])) {
    const vecino = grupos.find((g) => [1, 7].includes((g.principal - o + 8) % 8));
    if (vecino) { vecino.rutas += n; vecino.x += n * Math.sin(o * Math.PI / 4); vecino.y += n * Math.cos(o * Math.PI / 4); }
    else grupos.push({ principal: o, rutas: n, x: n * Math.sin(o * Math.PI / 4), y: n * Math.cos(o * Math.PI / 4) });
  }
  return grupos
    .filter((g) => g.rutas / total >= 0.2) // ignorar sentidos que solo toma alguna ruta suelta
    .sort((a, b) => b.rutas - a.rutas)
    .map((g) => {
      const grados = (Math.atan2(g.x, g.y) * 180 / Math.PI + 360) % 360; // promedio del grupo
      return { grados, nombre: puntoCardinal(grados), flecha: flecha(grados), rutas: g.rutas };
    });
}

/** De una lista de sentidos, el más parecido a un rumbo en grados. */
export function sentidoMasCercano(sentidos, grados) {
  const diferencia = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  return sentidos.reduce((mejor, s) => (!mejor || diferencia(s.grados, grados) < diferencia(mejor.grados, grados) ? s : mejor), null);
}

/** Los `n` paraderos más cercanos a un punto, con metros y minutos a pie. */
export function paraderosCerca(grupos, punto, n = 4) {
  return grupos
    .map((g) => ({ ...g, metros: distancia(g.pos, punto) }))
    .sort((a, b) => a.metros - b.metros)
    .slice(0, n)
    .map((g) => ({ ...g, minutos: g.metros / METROS_POR_MINUTO }));
}

/** Para cada parada, qué rutas pasan por ella: Map idParada -> [{ ruta, i, minuto }]. */
export function indiceDeRutas(red) {
  const indice = new Map();
  for (const ruta in red.rutas) {
    red.rutas[ruta].p.forEach(([parada, minuto], i) => {
      if (!indice.has(parada)) indice.set(parada, []);
      indice.get(parada).push({ ruta, i, minuto });
    });
  }
  return indice;
}

/**
 * Buses que vienen hacia un paradero, del que llega primero al último.
 * `buses` es la lista de /api/buses; `rumbos` es Map idBus -> [dx, dy].
 * Devuelve { lista: [{ codigo, destino, sistema, bus, placa, pos, falta, paradas, sentido, rumbo }], porConfirmar }.
 */
export function llegadas(red, indice, paradero, buses, rumbos = new Map(), maxMin = 30) {
  // Por cada ruta, los momentos del recorrido en que pasa por este paradero.
  // Casi siempre es uno; en una ruta circular pueden ser dos (ida y vuelta).
  const pasadas = new Map();
  for (const id of paradero.ids) {
    for (const { ruta, i, minuto } of indice.get(id) || []) {
      if (!pasadas.has(ruta)) pasadas.set(ruta, []);
      pasadas.get(ruta).push({ i, minuto });
    }
  }
  for (const lista of pasadas.values()) lista.sort((a, b) => a.minuto - b.minuto);

  const lista = [];
  let porConfirmar = 0;
  for (const b of buses) {
    const veces = pasadas.get(b[8]); // b[8] = route_id
    if (!veces) continue;
    const ruta = red.rutas[b[8]];
    const u = ubicarBus(red, ruta, [b[0], b[1]], rumbos.get(b[5] || b[6]));
    if (!u) continue;
    if (u.ambiguo) {
      // No se sabe su sentido todavía; cuenta solo si en alguno de los dos podría venir.
      if (veces.some((v) => u.minutos.some((m) => v.minuto > m && v.minuto - m <= maxMin))) porConfirmar++;
      continue;
    }
    // La primera pasada por el paradero que el bus todavía tiene por delante.
    const proxima = veces.find((v) => v.minuto > u.minuto);
    if (!proxima) continue; // ya pasó
    // El dato tiene b[7] segundos de viejo: el bus ya avanzó ese tiempo.
    const falta = Math.max(0, proxima.minuto - u.minuto - (b[7] || 0) / 60);
    if (falta > maxMin) continue;
    lista.push({
      codigo: ruta.c, destino: ruta.d, sistema: ruta.s,
      bus: b[5], placa: b[6], pos: [b[0], b[1]],
      falta,                    // minutos de horario hasta el paradero
      paradas: proxima.i - u.i, // cuántas paradas le faltan, contando esta
      sentido: rumboAlSalir(red, ruta, proxima.i), // hacia dónde sigue después de este paradero
      rumbo: u.rumbo,           // hacia dónde va el bus en este momento
    });
  }
  lista.sort((a, b) => a.falta - b.falta);
  return { lista, porConfirmar };
}
