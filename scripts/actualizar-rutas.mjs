// Genera datos/rutas.json: la tabla que traduce el route_id del feed (un número
// como "10075") al nombre que ve la gente ("B10 · Portal Norte").
//
// El feed en vivo solo trae el número. Los nombres están en el GTFS estático,
// un zip de más de 100 MB que TransMilenio publica cada día. Este script baja
// el más reciente, saca routes.txt y guarda solo lo que el mapa necesita.
//
// Uso:  npm run rutas
import { createWriteStream } from "node:fs";
import { writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import yauzl from "yauzl";

const BUCKET = "gtfs-estaticos";

// agency_id en routes.txt -> a qué parte del sistema pertenece la ruta
const SISTEMAS = { 1: "Troncal", 2: "Alimentador", 3: "Zonal", 4: "Zonal", 5: "Zonal", 6: "Dual", 7: "Cable" };

// 1. Preguntar al bucket público qué zips hay y quedarse con el de fecha más nueva.
const lista = await (await fetch(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o?fields=items(name,size)`)).json();
const fecha = (n) => (n.match(/(\d{4})-?(\d{2})-?(\d{2})/) || []).slice(1).join("");
const zip = lista.items.filter((i) => i.name.endsWith(".zip")).sort((a, b) => fecha(a.name).localeCompare(fecha(b.name))).at(-1);
console.log(`Descargando ${zip.name} (${Math.round(zip.size / 1e6)} MB)...`);

// 2. Bajarlo a un archivo temporal.
const destino = join(tmpdir(), "gtfs-transmilenio.zip");
const r = await fetch(`https://storage.googleapis.com/${BUCKET}/${encodeURIComponent(zip.name)}`);
if (!r.ok) throw new Error(`No se pudo descargar: HTTP ${r.status}`);
await pipeline(Readable.fromWeb(r.body), createWriteStream(destino));

// 3. Sacar solo routes.txt del zip (sin descomprimir los 600 MB del resto).
const texto = await new Promise((ok, mal) => {
  yauzl.open(destino, { lazyEntries: true }, (err, z) => {
    if (err) return mal(err);
    z.on("entry", (e) => {
      if (e.fileName !== "routes.txt") return z.readEntry();
      z.openReadStream(e, (err2, s) => {
        if (err2) return mal(err2);
        const trozos = [];
        s.on("data", (t) => trozos.push(t)).on("end", () => ok(Buffer.concat(trozos).toString("utf8")));
      });
    });
    z.on("end", () => mal(new Error("El zip no trae routes.txt")));
    z.readEntry();
  });
});
await rm(destino);

// 4. Leer el CSV. Los nombres no traen comas ni comillas, así que basta con split.
const [cabecera, ...filas] = texto.replace(/^﻿/, "").trim().split(/\r?\n/);
const col = Object.fromEntries(cabecera.split(",").map((c, i) => [c, i]));
const rutas = {};
for (const fila of filas) {
  const c = fila.split(",");
  rutas[c[col.route_id]] = [c[col.route_short_name], c[col.route_long_name], SISTEMAS[c[col.agency_id]] || "Zonal"];
}
await writeFile(new URL("../datos/rutas.json", import.meta.url), JSON.stringify({ gtfs: zip.name, rutas }));
console.log(`Listo: ${Object.keys(rutas).length} rutas de ${zip.name} en datos/rutas.json`);
