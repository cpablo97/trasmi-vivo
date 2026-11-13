// Servidor local para probar sin Netlify:  npm run dev  ->  http://localhost:8888
// Sirve la carpeta public/ y responde /api/buses con la misma lógica de la función.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, normalize } from "node:path";
import { leerBuses } from "./netlify/functions/buses.mjs";

const PUERTO = process.env.PORT || 8888;
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8" };
let cache = { hasta: 0, cuerpo: "" }; // mismo caché de 15 s que hace Netlify

createServer(async (req, res) => {
  const ruta = new URL(req.url, "http://localhost").pathname;
  try {
    if (ruta === "/api/buses") {
      if (Date.now() > cache.hasta) cache = { hasta: Date.now() + 15000, cuerpo: JSON.stringify(await leerBuses()) };
      return res.writeHead(200, { "Content-Type": TIPOS[".json"] }).end(cache.cuerpo);
    }
    // Cualquier otro pedido es un archivo de public/. normalize() impide salirse con "../".
    const archivo = normalize(ruta === "/" ? "/index.html" : ruta);
    const cuerpo = await readFile(new URL(`./public${archivo}`, import.meta.url)).catch(() => null);
    if (!cuerpo || !TIPOS[extname(archivo)]) return res.writeHead(404).end("No existe");
    res.writeHead(200, { "Content-Type": TIPOS[extname(archivo)] }).end(cuerpo);
  } catch (error) {
    res.writeHead(502, { "Content-Type": TIPOS[".json"] }).end(JSON.stringify({ error: error.message }));
  }
}).listen(PUERTO, () => console.log(`Mapa en http://localhost:${PUERTO}`));
