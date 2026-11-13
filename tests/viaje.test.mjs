// Pruebas de la lógica de «Planear viaje» con una red de juguete.  npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { distancia, buscarOpciones, ubicarBus, estimar, buscarParadas } from "../public/viaje.js";

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
