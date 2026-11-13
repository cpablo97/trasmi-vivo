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
| `public/index.html` | La página: el mapa (MapLibre) que pide `/api/buses` cada 10 s y pinta un punto por bus. También pide las estaciones y troncales directamente a la API de ArcGIS de TransMilenio. |
| `netlify/functions/buses.mjs` | La función: baja el feed de TransMilenio (protobuf), lo convierte a JSON y le pone el nombre a cada ruta. |
| `public/planear.js` | La pantalla de «Planear viaje»: formulario, lista de opciones y dibujos en el mapa. |
| `public/paradero.js` | La pantalla de «Mi paradero»: paraderos cercanos y lista de buses que vienen. |
| `public/viaje.js` | La lógica de «Planear viaje» y «Mi paradero», sin mapa ni HTML: qué rutas sirven, por dónde va cada bus, cuánto tarda. |
| `public/red.json` | Las paradas y el recorrido de cada ruta con sus minutos de horario. Generado. |
| `datos/rutas.json` | Tabla `route_id` → nombre de ruta, sacada del GTFS estático oficial. Generado. |
| `scripts/actualizar-rutas.mjs` | Regenera esos dos archivos. |
| `tests/viaje.test.mjs` | Pruebas de la lógica (`npm test`). |
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

## Planear viaje

Eliges de dónde sales (tu ubicación o un punto en el mapa) y una zona de destino (un punto o una estación, con un radio). La página muestra las rutas **directas** que pasan cerca de ti y después por esa zona, y en el mapa deja solo los buses de esas rutas que todavía no han pasado por tu paradero.

Cómo se calcula el tiempo de cada opción:

1. **Caminar** hasta el paradero: distancia en línea recta a 80 m por minuto.
2. **Esperar**: se ubica cada bus de la ruta dentro de su recorrido con su GPS y se cuentan los minutos de horario que le faltan para llegar a tu paradero.
3. **Viajar**: minutos de horario entre el paradero donde subes y donde bajas.
4. **Caminar** desde donde bajas hasta el centro de la zona de destino.

Límites:

- Solo rutas directas; no propone transbordos.
- Los tiempos salen del horario oficial, no del tráfico del momento.
- En rutas circulares (muchas zonales) no se sabe el sentido de un bus hasta verlo moverse, así que durante el primer minuto algunos aparecen como «confirmando su sentido».
- Una ruta sin ningún bus circulando se considera fuera de servicio y no se muestra.

## Mi paradero

Responde «¿qué buses vienen a mi paradero y cuánto les falta?» sin elegir destino. Toma tu ubicación (o un punto en el mapa), busca los cuatro paraderos más cercanos y, para el que elijas, lista los buses que llegan en los próximos 30 minutos.

TransMilenio no publica horas de llegada por parada (su feed `tripupdates.pb` solo dice si un viaje está programado, añadido o cancelado), así que se calculan aquí:

1. Los vagones de una estación se tratan como un solo paradero (`agruparParadas`).
2. Para cada ruta que pasa por el paradero, se ubica cada bus dentro del recorrido con su GPS (`ubicarBus`).
3. Lo que falta = minutos de horario entre la posición del bus y el paradero, menos lo viejo que sea el dato.

**Sentidos y costados.** Cada paradero muestra hacia dónde van sus buses (flecha y punto cardinal), calculado con el tramo que sigue a esa parada en cada ruta. Los paraderos de calle no se agrupan aunque se llamen igual, porque el de cada costado sirve a un sentido distinto; si hay uno cercano para el sentido contrario, la página lo ofrece. El costado se deduce de que los buses circulan y abren por la derecha (buses hacia el norte → costado oriental). En estaciones con dos sentidos se puede filtrar la lista por sentido. En el mapa, los paraderos cercanos y los buses que vienen llevan una flecha.

Tiene los mismos límites que «Planear viaje»: usa el horario y no el tráfico, y en rutas circulares hay que ver moverse al bus para saber su sentido.

## Mantener los datos al día

TransMilenio publica un GTFS nuevo cada día y a veces cambia los identificadores de las rutas. Si aparecen buses con ruta `?` o «Planear viaje» deja de encontrar rutas que existen, regenera los datos y súbelos:

```bash
npm run rutas
```

Descarga más de 100 MB y tarda cerca de un minuto. Actualiza `datos/rutas.json` y `public/red.json`.

## Datos

TransMilenio S.A., datos abiertos GTFS y GTFS Realtime, licencia CC BY-SA 4.0. Mapa base © OpenStreetMap contributors © CARTO.
