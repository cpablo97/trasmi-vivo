// Pruebas de la lógica de «Planear viaje» con una red de juguete.  npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { distancia, buscarOpciones, ubicarBus, estimar, buscarParadas, agruparParadas, paraderosCerca, indiceDeRutas, llegadas, sentidosDeParadero, sentidoMasCercano, vieneHacia, puntoCardinal, costado, rumboEntre } from "../public/viaje.js";

// Paradas sobre una avenida de sur a norte, una cada ~550 m (0.005° de latitud).
const P = (n) => [-74.1, 4.6 + n * 0.005, `Parada ${n}`];
const red = {
  paradas: { a: P(0), b: P(1), c: P(2), d: P(3), e: P(4), lejos: [-74.3, 4.9, "Otra ciudad"] },
  rutas: {
    norte: { c: "N1", d: "Norte", s: "Troncal", p: [["a", 0], ["b", 2], ["c", 4], ["d", 6], ["e", 8]] },
    sur: { c: "S1", d: "Sur", s: "Troncal", p: [["e", 0], ["d", 2], ["c", 4], ["b", 6], ["a", 8]] },
    // Circuito: sube por la avenida y vuelve por ella misma.
    circular: { c: "C1", d: "Circular", s: "Zonal", p: [["a", 0], ["b", 2], ["c", 4], ["d", 6], ["c", 10], ["b", 12], ["a", 14]] },
  },
};
const en = (n) => P(n).slice(0, 2);

test("distancia mide en metros", () => {
  const d = distancia(en(0), en(1));
  assert.ok(d > 540 && d < 565, `${d}`);
});

test("solo ofrece rutas en el sentido correcto", () => {
  const ops = buscarOpciones(red, en(1), en(3), 300, 300);
  assert.deepEqual(ops.map((o) => o.codigo).sort(), ["C1", "N1"]); // la S1 va al revés
  const n1 = ops.find((o) => o.codigo === "N1");
  assert.equal(n1.subir.id, "b");
  assert.equal(n1.bajar.id, "d");
  assert.equal(n1.viaje, 4);
});

test("en un circuito elige el tramo de vuelta cuando toca", () => {
  const c1 = buscarOpciones(red, en(3), en(1), 300, 300).find((o) => o.codigo === "C1");
  assert.equal(c1.iSubir, 3);
  assert.equal(c1.iBajar, 5);
  assert.equal(c1.viaje, 6);
});

test("sin rutas directas devuelve lista vacía", () => {
  assert.deepEqual(buscarOpciones(red, en(1), [-74.3, 4.9], 300, 300), []);
});

test("ubica un bus entre dos paradas", () => {
  const u = ubicarBus(red, red.rutas.norte, [-74.1, 4.6075]); // a mitad entre b y c
  assert.ok(Math.abs(u.minuto - 3) < 0.05, `${u.minuto}`);
});

test("un bus lejos de la ruta no cuenta", () => {
  assert.equal(ubicarBus(red, red.rutas.norte, [-74.2, 4.6]), null);
});

test("en un circuito el sentido es ambiguo hasta conocer el rumbo", () => {
  const pos = [-74.1, 4.6075];
  assert.equal(ubicarBus(red, red.rutas.circular, pos).ambiguo, true);
  assert.ok(Math.abs(ubicarBus(red, red.rutas.circular, pos, [0, 100]).minuto - 3) < 0.05); // va al norte
  assert.ok(Math.abs(ubicarBus(red, red.rutas.circular, pos, [0, -100]).minuto - 11) < 0.05); // va al sur
});

test("estima espera y total, e ignora el bus que ya pasó", () => {
  const [op] = buscarOpciones(red, en(2), en(4), 100, 100).filter((o) => o.codigo === "N1");
  const e = estimar(op, [{ minuto: 1 }, { minuto: 5 }, null]); // uno viene (a 3 min), otro ya pasó
  assert.equal(e.enCamino, 1);
  assert.equal(e.espera, 3);
  assert.equal(e.total, 3 + 4);
});

test("si no alcanzas el primer bus, cuenta el siguiente", () => {
  const [op] = buscarOpciones(red, [-74.1036, 4.61], en(4), 450, 100).filter((o) => o.codigo === "N1"); // ~400 m: 5 min a pie
  const e = estimar(op, [{ minuto: 3 }, { minuto: -4 }]); // llegan en 1 y 8 min
  assert.equal(e.espera, 8);
});

test("sin buses en camino no hay total", () => {
  const [op] = buscarOpciones(red, en(2), en(4), 100, 100).filter((o) => o.codigo === "N1");
  assert.equal(estimar(op, []).total, null);
});

test("busca paradas sin tildes y sin repetir vagones", () => {
  const r = { paradas: { 1: [0, 0, "Museo Nacional A - 2 ó 5"], 2: [0, 0, "Museo Nacional B - 7"], 3: [0, 0, "Estación Héroes"] } };
  assert.deepEqual(buscarParadas(r, "museo").map((p) => p.nombre), ["Museo Nacional"]);
  assert.deepEqual(buscarParadas(r, "heroes").map((p) => p.nombre), ["Héroes"]);
});

// ---------- «Mi paradero» ----------
// Un bus de /api/buses: [lon, lat, ruta, destino, sistema, bus, placa, hace_s, route_id]
const bus = (lat, ruta, id, hace_s = 0) => [-74.1, lat, "", "", "", id, "", hace_s, ruta];

test("agrupa los vagones de una estación, pero no homónimos lejanos", () => {
  const r = { paradas: {
    1: [-74.07, 4.615, "Museo Nacional A - 2 ó 5"], 2: [-74.0702, 4.6152, "Museo Nacional B - 7"],
    3: [-74.15, 4.70, "Museo Nacional"], 4: [-74.09, 4.65, "Portal 80 T-2"],
  } };
  const g = agruparParadas(r);
  assert.equal(g.length, 3);
  assert.deepEqual(g.find((x) => x.ids.length === 2).ids.sort(), ["1", "2"]);
  assert.ok(g.some((x) => x.nombre === "Portal 80"));
});

test("ordena los paraderos por cercanía y calcula la caminata", () => {
  const cerca = paraderosCerca(agruparParadas(red), [-74.1, 4.6099], 2); // casi sobre la parada 2, un poco al sur
  assert.deepEqual(cerca.map((p) => p.nombre), ["Parada 2", "Parada 1"]);
  assert.ok(Math.abs(cerca[1].minutos - 542 / 80) < 0.2, `${cerca[1].minutos}`);
});

test("lista los buses que vienen, del más cercano al más lejano", () => {
  const indice = indiceDeRutas(red);
  const paradero = agruparParadas(red).find((g) => g.nombre === "Parada 2"); // parada c
  const { lista } = llegadas(red, indice, paradero, [
    bus(4.6025, "norte", "N-lejos"),   // a mitad entre a y b: minuto 1, faltan 3
    bus(4.6075, "norte", "N-cerca"),   // a mitad entre b y c: minuto 3, falta 1
    bus(4.6125, "norte", "N-paso"),    // ya pasó por c
    bus(4.6175, "sur", "S-viene"),     // la ruta sur llega a c en su minuto 4; va en el 1
  ]);
  assert.deepEqual(lista.map((l) => l.bus), ["N-cerca", "N-lejos", "S-viene"]);
  assert.equal(lista[0].paradas, 1);
  assert.ok(Math.abs(lista[1].falta - 3) < 0.05);
});

test("descuenta lo viejo que es el dato del bus", () => {
  const indice = indiceDeRutas(red);
  const paradero = agruparParadas(red).find((g) => g.nombre === "Parada 2");
  const { lista } = llegadas(red, indice, paradero, [bus(4.6025, "norte", "x", 60)]);
  assert.ok(Math.abs(lista[0].falta - 2) < 0.05);
});

test("en un circuito usa el rumbo y cuenta aparte los buses sin sentido conocido", () => {
  const indice = indiceDeRutas(red);
  const paradero = agruparParadas(red).find((g) => g.nombre === "Parada 1"); // b: minutos 2 y 12 del circuito
  const b = bus(4.6075, "circular", "c1"); // entre b y c: minuto 3 (ida) o 11 (vuelta)
  // Sin rumbo: se lista como dudoso, con el tiempo que tardaría si viene (1 min de vuelta).
  const sinRumbo = llegadas(red, indice, paradero, [b]);
  assert.equal(sinRumbo.porConfirmar, 1);
  assert.equal(sinRumbo.lista[0].dudoso, true);
  assert.ok(Math.abs(sinRumbo.lista[0].falta - 1) < 0.05);
  assert.equal(sinRumbo.lista[0].rumbo, undefined);
  const alSur = llegadas(red, indice, paradero, [b], new Map([["c1", [0, -100]]]));
  assert.ok(Math.abs(alSur.lista[0].falta - 1) < 0.05, `${alSur.lista[0]?.falta}`); // ya viene de vuelta
  const alNorte = llegadas(red, indice, paradero, [b], new Map([["c1", [0, 100]]]));
  // Va subiendo: pasaría por b solo después de llegar a d y devolverse. Va en contravía: no se muestra.
  assert.deepEqual(alNorte.lista, []);
});

// ---------- Sentidos y costados ----------
test("no junta paraderos de calle aunque se llamen igual", () => {
  const r = { paradas: { 1: [-74.1, 4.6, "Calle 100"], 2: [-74.1003, 4.6, "Calle 100"] } }; // uno por costado
  assert.equal(agruparParadas(r).length, 2);
});

test("rumbos, puntos cardinales y costados", () => {
  assert.ok(Math.abs(rumboEntre(en(0), en(1))) < 0.01); // de sur a norte
  assert.equal(puntoCardinal(0), "norte");
  assert.equal(puntoCardinal(200), "sur");
  assert.equal(puntoCardinal(315), "noroccidente");
  // Se circula por la derecha: el paradero queda a la derecha del sentido de marcha.
  assert.equal(costado(0), "oriental");
  assert.equal(costado(180), "occidental");
  assert.equal(costado(90), "sur");
  assert.equal(costado(270), "norte");
  assert.equal(costado(225), "noroccidental"); // buses hacia el suroccidente
});

test("dice hacia dónde van los buses de un paradero", () => {
  const unSentido = { paradas: red.paradas, rutas: { norte: red.rutas.norte } };
  const g1 = agruparParadas(unSentido).find((g) => g.nombre === "Parada 2");
  assert.deepEqual(sentidosDeParadero(unSentido, indiceDeRutas(unSentido), g1).map((s) => s.nombre), ["norte"]);
  // Con rutas en los dos sentidos por la misma parada, salen los dos.
  const g2 = agruparParadas(red).find((g) => g.nombre === "Parada 2");
  assert.deepEqual(sentidosDeParadero(red, indiceDeRutas(red), g2).map((s) => s.nombre).sort(), ["norte", "sur"]);
});

test("cada llegada trae el sentido en que sigue y el rumbo del bus", () => {
  const paradero = agruparParadas(red).find((g) => g.nombre === "Parada 2");
  const { lista } = llegadas(red, indiceDeRutas(red), paradero, [bus(4.6075, "norte", "n"), bus(4.6175, "sur", "s")]);
  assert.equal(puntoCardinal(lista.find((l) => l.bus === "n").sentido), "norte");
  assert.equal(puntoCardinal(lista.find((l) => l.bus === "s").sentido), "sur");
  assert.equal(puntoCardinal(lista.find((l) => l.bus === "s").rumbo), "sur");
});

test("junta rumbos vecinos en un solo sentido y asigna cada llegada al más parecido", () => {
  // Una avenida que va al norte con una curva: unas rutas salen al norte y otras al nororiente.
  const r = {
    paradas: { x: [-74.1, 4.6, "X"], n: [-74.1, 4.605, "N"], ne: [-74.096, 4.604, "NE"], s: [-74.1, 4.595, "S"] },
    rutas: {
      r1: { c: "1", d: "", s: "", p: [["x", 0], ["n", 2]] }, r2: { c: "2", d: "", s: "", p: [["x", 0], ["n", 2]] },
      r3: { c: "3", d: "", s: "", p: [["x", 0], ["ne", 2]] }, r4: { c: "4", d: "", s: "", p: [["x", 0], ["s", 2]] },
    },
  };
  const paradero = agruparParadas(r).find((g) => g.nombre === "X");
  const sentidos = sentidosDeParadero(r, indiceDeRutas(r), paradero);
  assert.deepEqual(sentidos.map((s) => [s.nombre, s.rutas]), [["norte", 3], ["sur", 1]]);
  assert.equal(sentidoMasCercano(sentidos, 60).nombre, "norte");
  assert.equal(sentidoMasCercano(sentidos, 200).nombre, "sur");
});

test("un bus que llega por una calle transversal sí cuenta; uno en contravía no", () => {
  const ruta = red.rutas.norte, u = (rumbo) => ({ minuto: 1, i: 0, rumbo });
  assert.equal(vieneHacia(red, ruta, 2, u(0)), true);    // mismo sentido
  assert.equal(vieneHacia(red, ruta, 2, u(90)), true);   // viene de una transversal y va a girar
  assert.equal(vieneHacia(red, ruta, 2, u(180)), false); // sentido contrario
});

test("limita los paraderos a un radio, pero nunca devuelve una lista vacía", () => {
  const g = agruparParadas(red), desde = [-74.1, 4.6099]; // junto a la parada 2
  assert.deepEqual(paraderosCerca(g, desde, 10, 600).map((p) => p.nombre), ["Parada 2", "Parada 1", "Parada 3"]);
  assert.deepEqual(paraderosCerca(g, desde, 2, 600).map((p) => p.nombre), ["Parada 2", "Parada 1"]); // tope de cantidad
  assert.deepEqual(paraderosCerca(g, [-74.11, 4.61], 10, 100).map((p) => p.nombre), ["Parada 2"]); // nada a 100 m: el más cercano
});
