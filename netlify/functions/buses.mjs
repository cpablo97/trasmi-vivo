// Función de Netlify: el intermediario entre tu página y TransMilenio.
//
// Por qué existe: el feed de posiciones no deja que un navegador lo lea
// directamente (no envía cabeceras CORS) y viene en protobuf, un formato
// binario. Esta función corre en los servidores de Netlify, lo descarga,
// lo traduce a JSON liviano y se lo entrega a la página en /api/buses.
import GtfsRealtime from "gtfs-realtime-bindings";
import tabla from "../../datos/rutas.json" with { type: "json" };

const FEED = "https://gtfs.transmilenio.gov.co/positions.pb";
const { FeedMessage } = GtfsRealtime.transit_realtime;

// Esta es la lógica; no sabe nada de Netlify, así que se puede probar sola.
export async function leerBuses() {
  const respuesta = await fetch(FEED, { signal: AbortSignal.timeout(15000) });
  if (!respuesta.ok) throw new Error(`TransMilenio respondió HTTP ${respuesta.status}`);

  // decode() convierte los bytes en objetos: una "entity" por cada bus.
  const feed = FeedMessage.decode(new Uint8Array(await respuesta.arrayBuffer()));
  const ahora = Number(feed.header.timestamp);

  const buses = [];
  for (const { vehicle: v } of feed.entity) {
    if (!v?.position) continue;
    const [codigo, destino, sistema] = tabla.rutas[v.trip?.routeId] || ["?", "", "Zonal"];
    // Un arreglo por bus en vez de un objeto: la respuesta pesa la mitad.
    buses.push([
      +v.position.longitude.toFixed(5),
      +v.position.latitude.toFixed(5),
      codigo, // "B10"
      destino, // "Portal Norte"
      sistema, // "Troncal", "Zonal", "Alimentador", "Dual"
      v.vehicle?.label || "", // número interno del bus
      v.vehicle?.licensePlate || "",
      ahora - Number(v.timestamp), // hace cuántos segundos reportó
      v.trip?.routeId || "", // identificador de la ruta en el GTFS; lo usa «Planear viaje»
    ]);
  }
  return {
    campos: ["lon", "lat", "ruta", "destino", "sistema", "bus", "placa", "hace_s", "route_id"],
    actualizado: ahora * 1000,
    buses,
    fuente: "TransMilenio S.A., datos abiertos GTFS Realtime (CC BY-SA 4.0)",
  };
}

// Esto es lo que Netlify ejecuta en cada visita a /api/buses.
export default async () => {
  try {
    return Response.json(await leerBuses(), {
      headers: {
        // El navegador siempre pregunta de nuevo...
        "Cache-Control": "public, max-age=0, must-revalidate",
        // ...pero la red de Netlify guarda la respuesta 15 s. Así, aunque haya
        // mil personas mirando el mapa, a TransMilenio le llegan 4 pedidos por minuto.
        "Netlify-CDN-Cache-Control": "public, max-age=15",
      },
    });
  } catch (error) {
    return Response.json({ error: `No se pudo leer el feed: ${error.message}` }, { status: 502 });
  }
};

export const config = { path: "/api/buses" };
