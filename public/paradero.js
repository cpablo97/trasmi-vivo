// «Mi paradero»: qué buses vienen al paradero más cercano y cuánto les falta.
// Es la parte de pantalla; los cálculos están en viaje.js (agruparParadas,
// paraderosCerca, indiceDeRutas, llegadas). Usa de index.html: mapa, buses, rumbos,
// COLORES, plegar(), angosto, pedirUbicacion(), ponerYo(), pintarMapa(), cargarDatosViaje()
// y los enganches filtroViaje, eligiendoEnMapa, alLlegarBuses y salirDeModo.
(() => {
  const $ = (id) => document.getElementById(id);
  const MAX_LLEGADAS = 12;

  let V = null, red = null;
  let grupos = null;      // todos los paraderos (vagones de una estación ya agrupados)
  let indice = null;      // qué rutas pasan por cada parada
  let aqui = null;        // [lon, lat] de la persona
  let cercanos = [];      // los 4 paraderos más cercanos
  let paradero = null;    // el que se está mirando
  let resultado = null;   // { lista, porConfirmar } del último cálculo
  let calculado = 0;      // cuándo se hizo ese cálculo (para descontar el tiempo que pasa)
  let reloj = null;
  let eligiendo = false;

  const avisar = (texto) => ($("p-aviso").textContent = texto);
  const vacio = () => ({ type: "FeatureCollection", features: [] });

  // ---------- Entrar y salir ----------
  $("paradero-btn").addEventListener("click", async () => {
    salirDeModo?.(); // si estaba abierto «Planear viaje», cerrarlo
    salirDeModo = salir;
    $("panel").classList.add("paradero");
    $("paradero").hidden = false;
    plegar(false);
    mapa.triggerRepaint();
    if (!red) {
      avisar("Cargando rutas y paradas…");
      try {
        [V, red] = await cargarDatosViaje();
      } catch {
        return avisar("No se pudieron cargar las rutas. Revisa tu conexión e inténtalo de nuevo.");
      }
      grupos = V.agruparParadas(red);
      indice = V.indiceDeRutas(red);
      mapa.addSource("p-paradero", { type: "geojson", data: vacio() });
      mapa.addLayer({ id: "p-paradero", type: "circle", source: "p-paradero", paint: { "circle-radius": 9, "circle-color": "#fff", "circle-stroke-color": "#4fc3ff", "circle-stroke-width": 4 } }, "buses");
      mapa.addLayer({
        id: "p-paradero-nombre", type: "symbol", source: "p-paradero",
        layout: { "text-field": ["get", "nombre"], "text-size": 13, "text-font": ["Montserrat SemiBold", "Open Sans Bold"], "text-anchor": "top", "text-offset": [0, 1], "text-allow-overlap": true },
        paint: { "text-color": "#fff", "text-halo-color": "#0d1113", "text-halo-width": 2 },
      });
    }
    alLlegarBuses = calcular;
    // Entre un feed y el siguiente los minutos siguen bajando.
    reloj = setInterval(pintarLista, 15000);
    if (marcadorYo) ponerAqui(marcadorYo.getLngLat().toArray(), "Tu ubicación");
    else { avisar(""); ubicarme(); }
  });

  function salir() {
    salirDeModo = null;
    $("panel").classList.remove("paradero");
    $("paradero").hidden = true;
    elegirEnMapa(false);
    clearInterval(reloj);
    alLlegarBuses = null;
    filtroViaje = null;
    paradero = resultado = null;
    mapa.getSource("p-paradero")?.setData(vacio());
    pintarMapa(1);
  }
  $("p-salir").addEventListener("click", salir);

  // ---------- Dónde estoy ----------
  async function ubicarme() {
    avisar("Buscando tu ubicación…");
    try {
      const pos = await pedirUbicacion();
      avisar(fueraDeBogota(pos) ? "Estás fuera de Bogotá: los paraderos más cercanos quedan lejos." : "");
      ponerAqui(pos, "Tu ubicación");
    } catch (mensaje) {
      avisar(`${mensaje} También puedes marcar dónde estás en el mapa.`);
    }
  }
  $("p-ubicacion").addEventListener("click", ubicarme);

  function elegirEnMapa(si) {
    eligiendo = si;
    eligiendoEnMapa = si;
    $("p-mapa").setAttribute("aria-pressed", String(si));
    $("toque").hidden = !si;
    $("toque").textContent = si ? "Toca el mapa donde estás" : "";
    mapa.getCanvas().style.cursor = si ? "crosshair" : "";
    if (si) plegar(true);
  }
  $("p-mapa").addEventListener("click", () => elegirEnMapa(!eligiendo));
  mapa.on("click", (e) => {
    if (!eligiendo) return;
    elegirEnMapa(false);
    plegar(false);
    avisar("");
    ponerAqui([+e.lngLat.lng.toFixed(5), +e.lngLat.lat.toFixed(5)], "Punto en el mapa");
  });

  function ponerAqui(pos, nombre) {
    aqui = pos;
    ponerYo(pos);
    $("p-origen").textContent = nombre;
    cercanos = V.paraderosCerca(grupos, pos, 4);
    elegirParadero(cercanos[0]);
  }

  // ---------- Qué paradero ----------
  function elegirParadero(p) {
    paradero = p;
    // Botones para cambiar entre los paraderos cercanos.
    $("p-cercanos").replaceChildren(...cercanos.map((c) => {
      const boton = Object.assign(document.createElement("button"), { type: "button", textContent: `${c.nombre} · ${Math.round(c.metros / 10) * 10} m` });
      boton.setAttribute("aria-pressed", String(c === paradero));
      boton.onclick = () => elegirParadero(c);
      return boton;
    }));
    const titulo = $("p-titulo");
    titulo.textContent = p.nombre;
    titulo.appendChild(Object.assign(document.createElement("small"), { textContent: `a ${Math.max(1, Math.round(p.minutos))} min caminando (${Math.round(p.metros / 10) * 10} m)` }));
    mapa.getSource("p-paradero").setData({ type: "Feature", geometry: { type: "Point", coordinates: p.pos }, properties: { nombre: p.nombre } });
    calcular();
    // Encuadrar a la persona y al paradero, sin que el panel los tape.
    const panel = $("panel").getBoundingClientRect();
    const margen = angosto.matches ? { top: 60, bottom: panel.height + 40, left: 40, right: 40 } : { top: 80, bottom: 80, left: panel.width + 80, right: 80 };
    mapa.fitBounds(new maplibregl.LngLatBounds(aqui, aqui).extend(p.pos), { padding: margen, maxZoom: 15.5 });
  }

  // ---------- Qué buses vienen ----------
  // Se repite con cada feed nuevo.
  function calcular() {
    if (!paradero) return;
    resultado = V.llegadas(red, indice, paradero, buses, rumbos);
    calculado = Date.now();
    // En el mapa quedan solo los buses de la lista.
    filtroViaje = new Set(resultado.lista.slice(0, MAX_LLEGADAS).map((l) => l.bus || l.placa));
    pintarMapa(1);
    pintarLista();
  }

  function pintarLista() {
    if (!resultado) return;
    // Minutos que han pasado desde el cálculo: los buses siguieron avanzando.
    const pasado = (Date.now() - calculado) / 60000;
    const filas = resultado.lista.slice(0, MAX_LLEGADAS).map((l) => {
      const falta = Math.max(0, l.falta - pasado);
      const boton = Object.assign(document.createElement("button"), { type: "button", className: "llegada" });
      boton.style.setProperty("--c", COLORES[l.sistema] || "#888");
      const parte = (etiqueta, clase, texto) => boton.appendChild(Object.assign(document.createElement(etiqueta), { className: clase, textContent: texto }));

      const titulo = parte("span", "cod", l.codigo);
      titulo.appendChild(Object.assign(document.createElement("span"), { className: "dest", textContent: `  ${l.destino}` }));
      parte("strong", "tot", falta < 1 ? "llegando" : `~${Math.round(falta)} min`);

      // ¿Alcanzas a llegar caminando antes que el bus?
      const tarde = falta < paradero.minutos - 1;
      if (tarde) boton.classList.add("tarde");
      parte("small", "", `${l.paradas === 1 ? "a 1 parada" : `a ${l.paradas} paradas`} · bus ${l.bus || l.placa}${tarde ? " · llega antes que tú" : ""}`);

      boton.onclick = () => { plegar(true); mapa.flyTo({ center: l.pos, zoom: 15.5 }); };
      const li = document.createElement("li");
      li.appendChild(boton);
      return li;
    });
    $("p-llegadas").replaceChildren(...filas);
    $("p-nota").hidden = !filas.length;
    if (!/ubicación|fuera/i.test($("p-aviso").textContent)) {
      avisar(filas.length ? (resultado.porConfirmar ? `Hay ${resultado.porConfirmar} bus${resultado.porConfirmar > 1 ? "es" : ""} más cerca cuyo sentido aún se está confirmando.` : "")
        : resultado.porConfirmar ? "Hay buses cerca, pero aún se está confirmando hacia dónde van. Espera la próxima actualización."
        : "No hay buses que lleguen a este paradero en los próximos 30 minutos.");
    }
  }
})();
