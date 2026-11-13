// Genera los dos archivos de datos que salen del GTFS estático de TransMilenio
// (un zip de más de 100 MB que publican cada día):
//
//   datos/rutas.json   route_id -> nombre de la ruta. Lo usa la función de Netlify
//                      para ponerle nombre a cada bus del feed en vivo.
//   public/red.json    las paradas y, por cada ruta, su lista ordenada de paradas
//                      con el minuto del horario en que pasa. Lo usa «Planear viaje».
//
// Uso:  npm run rutas                 (descarga el zip más reciente)
//       npm run rutas -- ruta/al.zip  (usa un zip ya descargado)
import { createWriteStream } from "node:fs";
import { writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import yauzl from "yauzl";

const BUCKET = "gtfs-estaticos";
// agency_id en routes.txt -> a qué parte del sistema pertenece la ruta
const SISTEMAS = { 1: "Troncal", 2: "Alimentador", 3: "Zonal", 4: "Zonal", 5: "Zonal", 6: "Dual", 7: "Cable" };

// ---------- 1. Conseguir el zip ----------
let archivo = process.argv[2];
let nombreZip = archivo;
const descargado = !archivo;
if (descargado) {
  // Preguntar al bucket público qué zips hay y quedarse con el de fecha más nueva.
  const lista = await (await fetch(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o?fields=items(name,size)`)).json();
  const fecha = (n) => (n.match(/(\d{4})-?(\d{2})-?(\d{2})/) || []).slice(1).join("");
  const zip = lista.items.filter((i) => i.name.endsWith(".zip")).sort((a, b) => fecha(a.name).localeCompare(fecha(b.name))).at(-1);
  console.log(`Descargando ${zip.name} (${Math.round(zip.size / 1e6)} MB)...`);
  archivo = join(tmpdir(), "gtfs-transmilenio.zip");
  nombreZip = zip.name;
  const r = await fetch(`https://storage.googleapis.com/${BUCKET}/${encodeURIComponent(zip.name)}`);
  if (!r.ok) throw new Error(`No se pudo descargar: HTTP ${r.status}`);
  await pipeline(Readable.fromWeb(r.body), createWriteStream(archivo));
}

// ---------- 2. Leer un archivo del zip fila por fila ----------
// Nunca se carga un archivo entero en memoria: stop_times.txt pesa 579 MB.
// porFila recibe un objeto { columna: valor } por cada línea del CSV.
function leer(nombre, porFila) {
  return new Promise((ok, mal) => {
    yauzl.open(archivo, { lazyEntries: true }, (err, zip) => {
      if (err) return mal(err);
      zip.on("entry", (entrada) => {
        if (entrada.fileName !== nombre) return zip.readEntry();
        zip.openReadStream(entrada, async (err2, flujo) => {
          if (err2) return mal(err2);
          let columnas = null;
          for await (const linea of createInterface({ input: flujo, crlfDelay: Infinity })) {
            // Los valores de este GTFS no traen comas ni comillas, así que basta con split.
            const celdas = linea.replace(/^﻿/, "").split(",");
            if (!columnas) columnas = celdas;
            else if (linea) porFila(Object.fromEntries(columnas.map((c, i) => [c, celdas[i]])));
          }
          zip.close();
          ok();
        });
      });
      zip.on("end", () => mal(new Error(`El zip no trae ${nombre}`)));
      zip.readEntry();
    });
  });
}
const segundos = (hhmmss) => { const [h, m, s] = hhmmss.split(":").map(Number); return h * 3600 + m * 60 + s; };

// ---------- 3. Rutas y paradas ----------
const rutas = {}; // route_id -> [código, destino, sistema]
await leer("routes.txt", (f) => { rutas[f.route_id] = [f.route_short_name, f.route_long_name, SISTEMAS[f.agency_id] || "Zonal"]; });

const todasLasParadas = {}; // stop_id -> [lon, lat, nombre]
await leer("stops.txt", (f) => { todasLasParadas[f.stop_id] = [+(+f.stop_lon).toFixed(5), +(+f.stop_lat).toFixed(5), f.stop_name.trim().replace(/\s+/g, " ")]; });

const rutaDelViaje = new Map(); // trip_id -> route_id
await leer("trips.txt", (f) => rutaDelViaje.set(f.trip_id, f.route_id));
console.log(`${Object.keys(rutas).length} rutas, ${Object.keys(todasLasParadas).length} paradas, ${rutaDelViaje.size} viajes programados.`);

// ---------- 4. Un viaje representativo por ruta ----------
// Cada ruta tiene cientos de viajes al día con las mismas paradas pero distinta
// duración (hora pico, noche...). Se elige el de duración mediana: ni el más
// rápido ni el más lento.
console.log("Leyendo horarios (primera pasada: cuánto dura cada viaje)...");
const extremos = new Map(); // trip_id -> [primera hora, última hora]
await leer("stop_times.txt", (f) => {
  const t = segundos(f.arrival_time), e = extremos.get(f.trip_id);
  if (!e) extremos.set(f.trip_id, [t, t]);
  else { if (t < e[0]) e[0] = t; if (t > e[1]) e[1] = t; }
});
const viajesPorRuta = {};
for (const [viaje, [a, b]] of extremos) (viajesPorRuta[rutaDelViaje.get(viaje)] ||= []).push([b - a, viaje]);
const elegido = new Map(); // trip_id representativo -> route_id
for (const [ruta, viajes] of Object.entries(viajesPorRuta)) {
  viajes.sort((x, y) => x[0] - y[0]);
  elegido.set(viajes[Math.floor(viajes.length / 2)][1], ruta);
}

console.log("Leyendo horarios (segunda pasada: las paradas de cada viaje elegido)...");
const recorridos = {}; // route_id -> [[secuencia, stop_id, segundos]]
await leer("stop_times.txt", (f) => {
  const ruta = elegido.get(f.trip_id);
  if (ruta) (recorridos[ruta] ||= []).push([+f.stop_sequence, f.stop_id, segundos(f.arrival_time)]);
});

// ---------- 5. Armar y guardar ----------
const red = { gtfs: nombreZip.split("/").pop(), paradas: {}, rutas: {} };
for (const [ruta, filas] of Object.entries(recorridos)) {
  if (!rutas[ruta]) continue;
  filas.sort((a, b) => a[0] - b[0]);
  const salida = filas[0][2];
  const [c, d, s] = rutas[ruta];
  // p = [stop_id, minutos desde que el bus sale de la primera parada]
  red.rutas[ruta] = { c, d, s, p: filas.map(([, parada, t]) => [parada, +((t - salida) / 60).toFixed(1)]) };
  // Solo se guardan las paradas por las que pasa alguna ruta.
  for (const [, parada] of filas) if (todasLasParadas[parada]) red.paradas[parada] = todasLasParadas[parada];
}

await writeFile(new URL("../datos/rutas.json", import.meta.url), JSON.stringify({ gtfs: red.gtfs, rutas }));
await writeFile(new URL("../public/red.json", import.meta.url), JSON.stringify(red));
if (descargado) await rm(archivo);
console.log(`Listo (${red.gtfs}): ${Object.keys(rutas).length} rutas en datos/rutas.json; ${Object.keys(red.rutas).length} recorridos y ${Object.keys(red.paradas).length} paradas en public/red.json`);
