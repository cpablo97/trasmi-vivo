# Transmi en vivo

Mapa de los buses de TransMilenio y el SITP de Bogotá, en vivo. Proyecto de aprendizaje, independiente y no afiliado a TransMilenio S.A.

## Cómo funciona

```
navegador ──▶ /api/buses (función de Netlify) ──▶ gtfs.transmilenio.gov.co/positions.pb
   ▲                    │
   └──── JSON liviano ◀─┘
```

| Archivo | Qué hace |
| --- | --- |
| `public/index.html` | La página: el mapa (MapLibre) que pide `/api/buses` cada 20 s y pinta un punto por bus. También pide las estaciones y troncales directamente a la API de ArcGIS de TransMilenio. |
| `netlify/functions/buses.mjs` | La función: baja el feed de TransMilenio (protobuf), lo convierte a JSON y le pone el nombre a cada ruta. |
| `datos/rutas.json` | Tabla `route_id` → nombre de ruta, sacada del GTFS estático oficial. |
| `scripts/actualizar-rutas.mjs` | Regenera esa tabla. |
| `dev.mjs` | Servidor local para probar sin Netlify. |
| `netlify.toml` | Le dice a Netlify qué carpeta publicar y dónde están las funciones. |

La función existe porque el feed de TransMilenio no acepta pedidos directos desde un navegador (no envía cabeceras CORS).

## Probar en tu computador

Necesitas Node 20.10 o más nuevo.

```bash
npm install
npm run dev
```

Abre http://localhost:8888.

## Publicar en Netlify

1. Sube este proyecto a un repositorio de GitHub.
2. En Netlify: **Add new site → Import an existing project** y elige el repositorio.
3. Deja los ajustes como vienen (los lee de `netlify.toml`) y pulsa **Deploy**.

Cada `git push` vuelve a publicar el sitio.

## Mantener los nombres de rutas al día

Si aparecen buses con ruta `?`, TransMilenio cambió los identificadores. Regenera la tabla y súbela:

```bash
npm run rutas
```

Descarga más de 100 MB, así que tarda un momento.

## Datos

TransMilenio S.A., datos abiertos GTFS y GTFS Realtime, licencia CC BY-SA 4.0. Mapa base © OpenStreetMap contributors © CARTO.
