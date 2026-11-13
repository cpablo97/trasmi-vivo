// Servidor local para probar sin Netlify:  npm run dev  ->  http://localhost:8888
// Sirve la carpeta public/ y responde /api/buses con la misma lógica de la función.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { leerBuses } from "./netlify/functions/buses.mjs";

const PUERTO = process.env.PORT || 8888;
let cache = { hasta: 0, cuerpo: "" }; // mismo caché de 15 s que hace Netlify

createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/buses")) {
      if (Date.now() > cache.hasta) cache = { hasta: Date.now() + 15000, cuerpo: JSON.stringify(await leerBuses()) };
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" }).end(cache.cuerpo);
    } else if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(await readFile(new URL("./public/index.html", import.meta.url)));
    } else {
      res.writeHead(404).end("No existe");
    }
  } catch (error) {
    res.writeHead(502, { "Content-Type": "application/json" }).end(JSON.stringify({ error: error.message }));
  }
}).listen(PUERTO, () => console.log(`Mapa en http://localhost:${PUERTO}`));
