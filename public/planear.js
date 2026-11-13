// «Planear viaje»: la parte de pantalla. Conecta el formulario del panel y el mapa
// con la lógica de viaje.js. Usa cosas que define index.html: mapa, buses, rumbos,
// COLORES, plegar(), angosto, pedirUbicacion(), ponerYo(), pintarMapa() y los
// enganches filtroViaje, eligiendoEnMapa y alLlegarBuses.
(() => {
  const $ = (id) => document.getElementById(id);
  const MAX_OPCIONES = 12;

  let V = null;          // las funciones de viaje.js
  let red = null;        // public/red.json
  let origen = null;     // [lon, lat]
  let destino = null;    // [lon, lat]
  let todas = [];        // lo que devuelve V.buscarOpciones: todas las rutas directas posibles
  let opciones = [];     // las que se muestran: operando ahora y sin variantes repetidas, con .est y .sirven
  let elegida = null;    // id de la ruta que la persona tocó en la lista
  let eligiendo = null;  // "origen" | "destino" mientras se espera un toque en el mapa
  let marcaDestino = null;

  const metros = (m) => (m < 1000 ? `${m} m` : `${(m / 1000).toLocaleString("es-CO")} km`);
  const min = (m) => `${Math.max(1, Math.round(m))} min`;
  const avisar = (texto) => ($("v-aviso").textContent = texto);

  // ---------- Entrar y salir ----------
  $("planear").addEventListener("click", async () => {
    salirDeModo?.(); // si estaba abierto «Mi paradero», cerrarlo
    salirDeModo = salir;
    $("panel").classList.add("viaje");
    $("viaje").hidden = false;
    plegar(false);
    mapa.triggerRepaint();
    if (!red) {
      avisar("Cargando rutas y paradas…");
      try {
        [V, red] = await cargarDatosViaje(); // definida en index.html; la comparten los dos modos
      } catch {
        return avisar("No se pudieron cargar las rutas. Revisa tu conexión e inténtalo de nuevo.");
      }
      prepararCapas();
    }
    alLlegarBuses = estimarTodo;
    if (marcadorYo && !origen) ponerOrigen(marcadorYo.getLngLat().toArray(), "Tu ubicación");
    calcular();
  });

  function salir() {
    salirDeModo = null;
    $("panel").classList.remove("viaje");
    $("viaje").hidden = true;
    elegirEnMapa(null);
    alLlegarBuses = null;
    filtroViaje = null;
    elegida = null;
    for (const fuente of ["v-zonas", "v-tramo", "v-paradas"]) mapa.getSource(fuente)?.setData(vacio());
    marcaDestino?.remove();
    marcaDestino = null;
    destino = null;
    $("v-destino").textContent = "Sin definir";
    $("v-opciones").replaceChildren();
    pintarMapa(1);
  }
  $("v-salir").addEventListener("click", salir);

  // ---------- Origen y destino ----------
  function ponerOrigen(pos, nombre) {
    origen = pos;
    ponerYo(pos);
    $("v-origen").textContent = nombre;
    calcular(true);
  }
  function ponerDestino(pos, nombre) {
    destino = pos;
    if (!marcaDestino) marcaDestino = new maplibregl.Marker({ element: Object.assign(document.createElement("div"), { className: "destino" }), anchor: "bottom-left" });
    marcaDestino.setLngLat(pos).addTo(mapa);
    $("v-destino").textContent = nombre;
    calcular(true);
  }

  $("v-ubicacion").addEventListener("click", async () => {
    avisar("Buscando tu ubicación…");
    try {
      const pos = await pedirUbicacion();
      avisar(fueraDeBogota(pos) ? "Estás fuera de Bogotá: no hay rutas cerca de ti." : "");
      ponerOrigen(pos, "Tu ubicación");
    } catch (mensaje) {
      avisar(`${mensaje} También puedes elegir el origen en el mapa.`);
    }
  });

  // Elegir tocando el mapa: se activa un modo de espera y el siguiente toque marca el punto.
  function elegirEnMapa(cual) {
    eligiendo = cual;
    eligiendoEnMapa = !!cual; // le avisa a index.html que no abra globos de buses o estaciones
    $("v-origen-mapa").setAttribute("aria-pressed", String(cual === "origen"));
    $("v-destino-mapa").setAttribute("aria-pressed", String(cual === "destino"));
    $("toque").hidden = !cual;
    $("toque").textContent = cual ? `Toca el mapa para marcar tu ${cual}` : "";
    mapa.getCanvas().style.cursor = cual ? "crosshair" : "";
    if (cual) plegar(true); // en móvil: despejar el mapa
  }
  $("v-origen-mapa").addEventListener("click", () => elegirEnMapa(eligiendo === "origen" ? null : "origen"));
  $("v-destino-mapa").addEventListener("click", () => elegirEnMapa(eligiendo === "destino" ? null : "destino"));
  mapa.on("click", (e) => {
    if (!eligiendo) return;
    const pos = [+e.lngLat.lng.toFixed(5), +e.lngLat.lat.toFixed(5)];
    const cual = eligiendo;
    elegirEnMapa(null);
    plegar(false);
    if (cual === "origen") ponerOrigen(pos, "Punto en el mapa");
    else ponerDestino(pos, "Punto en el mapa");
  });

  // Buscar el destino por nombre.
  $("v-buscar").addEventListener("input", () => {
    const lista = red ? V.buscarParadas(red, $("v-buscar").value) : [];
    $("v-sugerencias").replaceChildren(...lista.map((p) => {
      const boton = Object.assign(document.createElement("button"), { type: "button", textContent: p.nombre });
      boton.onclick = () => {
        $("v-buscar").value = "";
        $("v-sugerencias").replaceChildren();
        ponerDestino(p.pos, p.nombre);
      };
      return boton;
    }));
  });

  for (const id of ["v-ro", "v-rd"]) {
    $(id).addEventListener("input", () => {
      $(`${id}-txt`).textContent = metros(+$(id).value);
      calcular();
    });
  }

  // ---------- Calcular ----------
  // 1) Qué rutas sirven. Cambia solo si cambian origen, destino o radios.
  function calcular(encuadrar = false) {
    if (!red) return;
    const ro = +$("v-ro").value, rd = +$("v-rd").value;
    dibujarZonas(ro, rd);
    $("v-nota").hidden = true;
    if (!origen || !destino) {
      todas = opciones = [];
      filtroViaje = null;
      $("v-opciones").replaceChildren();
      if (!$("v-aviso").textContent || /^(Elige|No hay|Cargando)/.test($("v-aviso").textContent)) {
        avisar(!origen ? "Elige desde dónde sales: tu ubicación o un punto en el mapa." : "Elige a dónde vas: busca una estación o marca un punto en el mapa.");
      }
      return pintarMapa(1);
    }
    todas = V.buscarOpciones(red, origen, destino, ro, rd);
    estimarTodo();
    $("v-nota").hidden = !opciones.length;
    if (encuadrar) encuadrarViaje();
  }

  // 2) Dónde van los buses de esas rutas y cuánto tarda cada opción. Se repite con cada feed.
  function estimarTodo() {
    if (!origen || !destino) return;
    const porRuta = new Map(); // route_id -> buses
    for (const b of buses) { if (!porRuta.has(b[8])) porRuta.set(b[8], []); porRuta.get(b[8]).push(b); }

    // El horario trae variantes que hoy no operan (festivos, ciclovía...). Si una ruta
    // no tiene ningún bus en toda la ciudad, se da por no operativa en este momento.
    opciones = todas.filter((op) => porRuta.has(op.id));
    for (const op of opciones) {
      op.sirven = [];
      const ubicados = (porRuta.get(op.id) || []).map((b) => {
        const id = b[5] || b[6];
        const u = V.ubicarBus(red, red.rutas[op.id], [b[0], b[1]], rumbos.get(id));
        if (!u) return null;
        // Sirve si todavía no pasó por tu paradero (o si aún no se sabe su sentido y podría servir).
        if (u.ambiguo ? u.minutos.some((m) => m < op.minutoSubir) : u.minuto < op.minutoSubir) op.sirven.push(id);
        return { ...u, hace_s: b[7] };
      });
      op.est = V.estimar(op, ubicados);
    }
    // Orden: primero las que tienen bus en camino, por tiempo total; después el resto.
    opciones.sort((a, b) => (a.est.total ?? 1e6 + a.est.sinEspera) - (b.est.total ?? 1e6 + b.est.sinEspera));
    // Varias variantes de una misma ruta (mismo código): dejar solo la mejor.
    const codigos = new Set();
    opciones = opciones.filter((op) => !codigos.has(op.codigo) && codigos.add(op.codigo));
    if (!opciones.some((o) => o.id === elegida)) elegida = null;
    avisar(opciones.length ? ""
      : todas.length ? "Hay rutas directas, pero ninguna tiene buses circulando en este momento."
      : "No hay rutas directas entre esos dos puntos. Prueba con más distancia a pie o una zona de destino más grande.");
    pintarLista();
    filtrarBuses();
  }

  function filtrarBuses() {
    const visibles = elegida ? opciones.filter((o) => o.id === elegida) : opciones.slice(0, MAX_OPCIONES);
    filtroViaje = new Set(visibles.flatMap((o) => o.sirven));
    pintarMapa(1);
  }

  // ---------- Lista ----------
  function pintarLista() {
    const lista = opciones.slice(0, MAX_OPCIONES).map((op) => {
      const boton = Object.assign(document.createElement("button"), { type: "button", className: "opcion" });
      boton.style.setProperty("--c", COLORES[op.sistema] || "#888");
      boton.setAttribute("aria-pressed", String(op.id === elegida));
      const parte = (etiqueta, clase, texto) => boton.appendChild(Object.assign(document.createElement(etiqueta), { className: clase, textContent: texto }));

      const titulo = parte("span", "cod", op.codigo);
      titulo.appendChild(Object.assign(document.createElement("span"), { className: "dest", textContent: `  ${op.destino}` }));
      parte("strong", "tot", op.est.total === null ? "—" : `~${min(op.est.total)}`);

      const bus = op.est.espera !== null ? `bus en ~${min(op.est.espera)}`
        : op.est.porConfirmar ? "bus cerca, confirmando su sentido…"
        : "sin buses en camino ahora";
      parte("small", "", `Camina ${min(op.caminaIda)} a ${op.subir.nombre} · ${bus} · ${min(op.viaje)} de viaje · baja en ${op.bajar.nombre}`);

      boton.onclick = () => {
        elegida = elegida === op.id ? null : op.id;
        pintarLista();
        dibujarTramo();
        filtrarBuses();
        if (elegida) { plegar(true); encuadrarViaje(); }
      };
      const li = document.createElement("li");
      li.appendChild(boton);
      return li;
    });
    if (opciones.length > MAX_OPCIONES) {
      lista.push(Object.assign(document.createElement("li"), { id: "v-nota", textContent: `Y ${opciones.length - MAX_OPCIONES} rutas más lentas que no se muestran.` }));
    }
    $("v-opciones").replaceChildren(...lista);
    dibujarTramo();
  }

  // ---------- Dibujos en el mapa ----------
  const vacio = () => ({ type: "FeatureCollection", features: [] });

  function prepararCapas() {
    for (const fuente of ["v-zonas", "v-tramo", "v-paradas"]) mapa.addSource(fuente, { type: "geojson", data: vacio() });
    // "buses" como segundo argumento: todo esto queda debajo de los buses.
    mapa.addLayer({ id: "v-zonas", type: "fill", source: "v-zonas", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.1 } }, "buses");
    mapa.addLayer({ id: "v-zonas-borde", type: "line", source: "v-zonas", paint: { "line-color": ["get", "color"], "line-width": 1.5, "line-dasharray": [2, 2] } }, "buses");
    mapa.addLayer({ id: "v-tramo-borde", type: "line", source: "v-tramo", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#fff", "line-width": 8 } }, "buses");
    mapa.addLayer({ id: "v-tramo", type: "line", source: "v-tramo", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 5 } }, "buses");
    mapa.addLayer({ id: "v-paradas", type: "circle", source: "v-paradas", paint: { "circle-radius": 7, "circle-color": "#fff", "circle-stroke-color": "#12171a", "circle-stroke-width": 3 } }, "buses");
    mapa.addLayer({
      id: "v-paradas-nombre", type: "symbol", source: "v-paradas",
      layout: { "text-field": ["get", "texto"], "text-size": 13, "text-font": ["Montserrat SemiBold", "Open Sans Bold"], "text-anchor": "left", "text-offset": [1, 0], "text-allow-overlap": true },
      paint: { "text-color": "#fff", "text-halo-color": "#0d1113", "text-halo-width": 2 },
    });
  }

  function dibujarZonas(ro, rd) {
    const zonas = [];
    if (origen) zonas.push({ ...V.circulo(origen, ro), properties: { color: "#4fc3ff" } });
    if (destino) zonas.push({ ...V.circulo(destino, rd), properties: { color: "#ff5470" } });
    mapa.getSource("v-zonas").setData({ type: "FeatureCollection", features: zonas });
  }

  // La ruta elegida: línea de parada en parada desde donde subes hasta donde bajas.
  function dibujarTramo() {
    const op = opciones.find((o) => o.id === elegida);
    if (!op) {
      mapa.getSource("v-tramo").setData(vacio());
      mapa.getSource("v-paradas").setData(vacio());
      return;
    }
    const puntos = red.rutas[op.id].p.slice(op.iSubir, op.iBajar + 1).map(([parada]) => red.paradas[parada].slice(0, 2));
    mapa.getSource("v-tramo").setData({ type: "Feature", geometry: { type: "LineString", coordinates: puntos }, properties: { color: COLORES[op.sistema] || "#888" } });
    const punto = (p, texto) => ({ type: "Feature", geometry: { type: "Point", coordinates: p.pos }, properties: { texto } });
    mapa.getSource("v-paradas").setData({ type: "FeatureCollection", features: [punto(op.subir, `Sube: ${op.subir.nombre}`), punto(op.bajar, `Baja: ${op.bajar.nombre}`)] });
  }

  // Mover el mapa para que se vean origen, destino y la ruta elegida, sin que el panel los tape.
  function encuadrarViaje() {
    if (!origen || !destino) return;
    const caja = new maplibregl.LngLatBounds(origen, origen).extend(destino);
    const op = opciones.find((o) => o.id === elegida);
    if (op) {
      for (const [parada] of red.rutas[op.id].p.slice(op.iSubir, op.iBajar + 1)) caja.extend(red.paradas[parada].slice(0, 2));
      // Incluir también los buses que vienen y ya están cerca (a menos de 4 km del paradero).
      const sirven = new Set(op.sirven);
      for (const b of buses) if (sirven.has(b[5] || b[6]) && V.distancia([b[0], b[1]], op.subir.pos) < 4000) caja.extend([b[0], b[1]]);
    }
    const panel = $("panel").getBoundingClientRect();
    const margen = angosto.matches
      ? { top: 60, bottom: panel.height + 40, left: 40, right: 40 }
      : { top: 60, bottom: 60, left: panel.width + 60, right: 60 };
    mapa.fitBounds(caja, { padding: margen, maxZoom: 15 });
  }
})();
