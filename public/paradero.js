// «Mi paradero»: qué buses vienen al paradero más cercano, cuánto les falta y
// hacia dónde van. Es la parte de pantalla; los cálculos están en viaje.js
// (agruparParadas, paraderosCerca, sentidosDeParadero, llegadas...).
// Usa de index.html: mapa, buses, rumbos, COLORES, plegar(), angosto,
// pedirUbicacion(), ponerYo(), repintar(), cargarDatosViaje() y los enganches
// filtroViaje, rumboDeBus, eligiendoEnMapa, alLlegarBuses y salirDeModo.
(() => {
  const $ = (id) => document.getElementById(id);
  const MAX_LLEGADAS = 12;
  const MAX_BOTONES = 12;   // paraderos que se listan como botones, para que el panel no se vuelva interminable
  const MAX_EN_MAPA = 80;   // paraderos que se dibujan en el mapa

  let V = null, red = null;
  let grupos = null;      // todos los paraderos (vagones de una estación ya agrupados)
  let indice = null;      // qué rutas pasan por cada parada
  let aqui = null;        // [lon, lat] de la persona
  let cercanos = [];      // los paraderos más cercanos, cada uno con sus .sentidos
  let paradero = null;    // el que se está mirando
  let sentido = null;     // en estaciones con dos sentidos: el que la persona filtró ("norte"...) o null
  let resultado = null;   // { lista, porConfirmar } del último cálculo
  let calculado = 0;      // cuándo se hizo ese cálculo (para descontar el tiempo que pasa)
  let reloj = null;
  let eligiendo = false;

  const avisar = (texto) => ($("p-aviso").textContent = texto);
  const vacio = () => ({ type: "FeatureCollection", features: [] });
  const a10 = (m) => `${Math.round(m / 10) * 10} m`;
  const crear = (etiqueta, props) => Object.assign(document.createElement(etiqueta), props);

  // ---------- Entrar y salir ----------
  $("paradero-btn").addEventListener("click", async () => {
    salirDeModo?.(); // si estaba abierto «Planear viaje», cerrarlo
    salirDeModo = salir;
    elegirBus(null); // cierra el globo o la selección que viniera del mapa general
    $("panel").classList.add("paradero");
    $("paradero").hidden = false;
    $("p-ajustes").open = !marcadorYo; // sin ubicación todavía: mostrar cómo darla
    plegar(false);
    alPlegar = encuadrar;
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
      prepararCapas();
    }
    alLlegarBuses = calcular;
    // Si el bus se elige tocándolo en el mapa, resaltar su fila y traerla a la vista.
    alElegirBus = (id) => {
      pintarLista();
      if (id) document.querySelector(`.llegada[data-bus="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
    };
    // Entre un feed y el siguiente los minutos siguen bajando.
    reloj = setInterval(pintarLista, 15000);
    if (marcadorYo) ponerAqui(marcadorYo.getLngLat().toArray(), "Tu ubicación");
    else { avisar(""); ubicarme(); }
  });

  function salir() {
    salirDeModo = null;
    $("paradero").hidden = true;
    elegirEnMapa(false);
    clearInterval(reloj);
    alLlegarBuses = null;
    alElegirBus = null;
    alPlegar = null;
    $("resumen").textContent = "";
    $("panel").classList.remove("paradero");
    plegar($("panel").classList.contains("plegado")); // refresca el texto del botón
    filtroViaje = null;
    rumboDeBus = null;
    busesDudosos = null;
    paradero = resultado = sentido = null;
    mapa.getSource("p-paraderos")?.setData(vacio());
    mapa.getSource("p-radio")?.setData(vacio());
    repintar();
  }
  $("p-salir").addEventListener("click", salir);

  // Los paraderos cercanos en el mapa: un círculo cada uno, con una flecha que señala
  // hacia dónde van sus buses. El elegido se ve más grande y con su nombre.
  function prepararCapas() {
    mapa.addSource("p-radio", { type: "geojson", data: vacio() });
    mapa.addLayer({ id: "p-radio", type: "fill", source: "p-radio", paint: { "fill-color": "#4fc3ff", "fill-opacity": 0.07 } }, "buses");
    mapa.addLayer({ id: "p-radio-borde", type: "line", source: "p-radio", paint: { "line-color": "#4fc3ff", "line-width": 1.5, "line-dasharray": [2, 2] } }, "buses");
    mapa.addSource("p-paraderos", { type: "geojson", data: vacio() });
    mapa.addLayer({
      id: "p-paraderos", type: "circle", source: "p-paraderos",
      paint: {
        "circle-radius": ["case", ["get", "elegido"], 10, 7],
        "circle-color": ["case", ["get", "elegido"], "#fff", "#12171a"],
        "circle-stroke-color": ["case", ["get", "elegido"], "#4fc3ff", "#e8ecea"],
        "circle-stroke-width": ["case", ["get", "elegido"], 4, 2],
      },
    }, "buses");
    mapa.addLayer({
      id: "p-paraderos-flecha", type: "symbol", source: "p-paraderos", filter: ["has", "rumbo"],
      layout: { "icon-image": "flecha", "icon-rotate": ["get", "rumbo"], "icon-rotation-alignment": "map", "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-size": 1.5 },
    }, "buses");
    mapa.addLayer({
      id: "p-paraderos-nombre", type: "symbol", source: "p-paraderos", filter: ["get", "elegido"],
      layout: { "text-field": ["get", "nombre"], "text-size": 13, "text-font": ["Montserrat SemiBold", "Open Sans Bold"], "text-anchor": "top", "text-offset": [0, 1.4], "text-allow-overlap": true },
      paint: { "text-color": "#fff", "text-halo-color": "#0d1113", "text-halo-width": 2 },
    });
    // Tocar un paradero en el mapa lo elige.
    mapa.on("click", "p-paraderos", (e) => {
      if (eligiendo) return;
      e.originalEvent.busTocado = true; // que no se abra el globo de la estación de debajo
      const tocado = cercanos[e.features[0].properties.n];
      if (tocado) elegirParadero(tocado, false);
    });
    mapa.on("mouseenter", "p-paraderos", () => (mapa.getCanvas().style.cursor = "pointer"));
    mapa.on("mouseleave", "p-paraderos", () => (mapa.getCanvas().style.cursor = eligiendo ? "crosshair" : ""));
  }

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
    $("p-ajustes").open = false; // ya hay ubicación: dejar el espacio para la lista de buses
    buscarCercanos(false);
  }

  // Los paraderos que están dentro del radio que marca el control deslizante.
  function buscarCercanos(conservar) {
    const radio = +$("p-radio").value;
    const todos = V.paraderosCerca(grupos, aqui, Infinity, radio);
    const antes = paradero?.ids[0];
    cercanos = todos.slice(0, MAX_EN_MAPA);
    // Hacia dónde van los buses de cada uno.
    for (const c of cercanos) c.sentidos = V.sentidosDeParadero(red, indice, c);

    const fuera = cercanos[0].metros > radio; // no había ninguno dentro del radio
    $("p-cuantos").textContent = fuera ? `No hay paraderos a ${a10(radio)} o menos. Este es el más cercano, a ${a10(cercanos[0].metros)}.`
      : todos.length > MAX_BOTONES ? `${todos.length} paraderos en ese radio. Aquí abajo están los ${MAX_BOTONES} más cercanos; en el mapa puedes tocar cualquiera.`
      : `${todos.length} ${todos.length === 1 ? "paradero" : "paraderos"} en ese radio.`;
    // El círculo del radio en el mapa.
    mapa.getSource("p-radio").setData({ ...V.circulo(aqui, radio), properties: {} });

    // Al mover el control se conserva el paradero que se estaba mirando, si sigue en la lista.
    const mismo = conservar && cercanos.find((c) => c.ids[0] === antes);
    elegirParadero(mismo || cercanos[0], true);
  }
  $("p-radio").addEventListener("input", () => {
    $("p-radio-txt").textContent = a10(+$("p-radio").value);
    if (aqui) buscarCercanos(true);
  });

  // ---------- Qué paradero ----------
  // Texto corto del sentido: "↑ norte" o "↑↓ norte y sur".
  const flechas = (p) => p.sentidos.map((s) => s.flecha).join("");
  const hacia = (p) => new Intl.ListFormat("es", { type: "conjunction" }).format(p.sentidos.map((s) => s.nombre)); // "norte, sur y oriente"

  function elegirParadero(p, conEncuadre) {
    paradero = p;
    sentido = null;

    // Botones para cambiar entre los paraderos cercanos, cada uno con su flecha.
    // Se listan los más cercanos; si el elegido (tocado en el mapa) está más lejos, se añade.
    const enBotones = cercanos.slice(0, MAX_BOTONES);
    if (!enBotones.includes(p)) enBotones.push(p);
    $("p-cercanos").replaceChildren(...enBotones.map((c) => {
      const boton = crear("button", { type: "button", textContent: `${flechas(c)} ${c.nombre} · ${a10(c.metros)}` });
      boton.setAttribute("aria-pressed", String(c === paradero));
      boton.setAttribute("aria-label", `${c.nombre}, buses hacia el ${hacia(c)}, a ${a10(c.metros)}`);
      boton.onclick = () => elegirParadero(c, true);
      return boton;
    }));

    // Título: nombre, costado y sentido.
    const titulo = $("p-titulo");
    titulo.textContent = p.nombre;
    const unSentido = p.sentidos.length === 1 ? p.sentidos[0] : null;
    const donde = !p.sentidos.length ? "Paradero"
      : p.estacion || !unSentido ? `${p.estacion ? "Estación" : "Paradero"} con buses hacia el ${hacia(p)}`
      : `Costado ${V.costado(unSentido.grados)} · buses hacia el ${unSentido.nombre}`;
    titulo.appendChild(crear("small", { textContent: `${donde} · a ${Math.max(1, Math.round(p.minutos))} min caminando (${a10(p.metros)})` }));

    // ¿Hay cerca un paradero que sirva al sentido contrario? Ofrecerlo.
    const opuesto = unSentido && cercanos.find((c) => c !== p && c.sentidos.length === 1
      && Math.abs(((c.sentidos[0].grados - unSentido.grados + 540) % 360) - 180) >= 135 // ángulo entre ambos sentidos
      && V.distancia(c.pos, p.pos) < 400);
    $("p-otro").hidden = !opuesto;
    if (opuesto) {
      $("p-otro").textContent = `¿Vas hacia el ${opuesto.sentidos[0].nombre}? Usa el paradero del otro costado: ${opuesto.nombre}, a ${a10(opuesto.metros)} de ti.`;
      $("p-otro").onclick = () => elegirParadero(opuesto, true);
    }

    pintarSentidos();
    pintarParaderos();
    calcular();
    if (conEncuadre) { $("mas").scrollTop = 0; encuadrar(); } // paradero nuevo: la lista se ve desde arriba
  }

  // Que se vean la persona, los paraderos cercanos y el círculo del radio, sin que el panel los tape.
  function encuadrar() {
    if (!aqui) return;
    const caja = new maplibregl.LngLatBounds(aqui, aqui);
    for (const c of cercanos) caja.extend(c.pos);
    for (const punto of V.circulo(aqui, +$("p-radio").value, 8).geometry.coordinates[0]) caja.extend(punto);
    mapa.fitBounds(caja, { padding: margenMapa(), maxZoom: 16.5 });
  }

  // En una estación con buses en dos sentidos: botones para ver solo uno.
  function pintarSentidos() {
    const varios = paradero.sentidos.length > 1;
    $("p-sentidos").replaceChildren(...(varios ? [null, ...paradero.sentidos] : []).map((s) => {
      const boton = crear("button", { type: "button", textContent: s ? `${s.flecha} Hacia el ${s.nombre}` : "Todos" });
      boton.setAttribute("aria-pressed", String((s?.nombre ?? null) === sentido));
      boton.onclick = () => { sentido = s?.nombre ?? null; pintarSentidos(); filtrar(); };
      return boton;
    }));
  }

  function pintarParaderos() {
    mapa.getSource("p-paraderos").setData({
      type: "FeatureCollection",
      features: cercanos.map((c, n) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: c.pos },
        // rumbo solo si el paradero tiene un único sentido: es lo que dibuja la flecha.
        properties: { n, nombre: c.nombre, elegido: c === paradero, ...(c.sentidos.length === 1 && { rumbo: Math.round(c.sentidos[0].grados) }) },
      })),
    });
  }

  // ---------- Qué buses vienen ----------
  // Se repite con cada feed nuevo.
  function calcular() {
    if (!paradero) return;
    resultado = V.llegadas(red, indice, paradero, buses, rumbos);
    calculado = Date.now();
    filtrar();
  }

  // Las llegadas que se muestran: las del sentido elegido (si hay filtro), hasta el máximo.
  // Cada llegada pertenece al sentido del paradero que más se parece a su rumbo.
  const visibles = () => resultado.lista.filter((l) => !sentido || V.sentidoMasCercano(paradero.sentidos, l.sentido)?.nombre === sentido).slice(0, MAX_LLEGADAS);

  function filtrar() {
    const lista = visibles();
    // En el mapa quedan solo esos buses, cada uno con una flecha hacia donde va.
    filtroViaje = new Set(lista.map((l) => l.bus || l.placa));
    // Los de sentido desconocido no llevan flecha: van en ámbar.
    rumboDeBus = new Map(lista.filter((l) => !l.dudoso).map((l) => [l.bus || l.placa, Math.round(l.rumbo)]));
    busesDudosos = new Set(lista.filter((l) => l.dudoso).map((l) => l.bus || l.placa));
    repintar();
    pintarLista();
  }

  function pintarLista() {
    if (!resultado) return;
    // Minutos que han pasado desde el cálculo: los buses siguieron avanzando.
    const pasado = (Date.now() - calculado) / 60000;
    const filas = visibles().map((l) => {
      const falta = Math.max(0, l.falta - pasado);
      const boton = crear("button", { type: "button", className: "llegada" });
      boton.style.setProperty("--c", COLORES[l.sistema] || "#888");
      const parte = (etiqueta, clase, texto) => boton.appendChild(crear(etiqueta, { className: clase, textContent: texto }));

      const titulo = parte("span", "cod", l.codigo);
      titulo.appendChild(crear("span", { className: "dest", textContent: `  ${l.destino}` }));
      if (l.dudoso) boton.classList.add("dudosa");
      // Con signo de pregunta: es el tiempo que tardaría SI viene hacia acá.
      parte("strong", "tot", (falta < 1 ? "llegando" : `~${Math.round(falta)} min`) + (l.dudoso ? " ?" : ""));

      // ¿Alcanzas a llegar caminando antes que el bus?
      const tarde = !l.dudoso && falta < paradero.minutos - 1;
      if (tarde) boton.classList.add("tarde");
      const detalle = parte("small", "", "");
      if (l.dudoso) {
        detalle.appendChild(crear("span", { className: "duda", textContent: "Sentido por confirmar" }));
        detalle.append(` · si viene, sigue hacia el ${V.puntoCardinal(l.sentido)} · bus ${l.bus || l.placa}`);
      } else {
        detalle.appendChild(crear("span", { className: "fle", textContent: V.flecha(l.sentido) }));
        detalle.append(`sigue hacia el ${V.puntoCardinal(l.sentido)} · ${l.paradas === 1 ? "a 1 parada" : `a ${l.paradas} paradas`} · bus ${l.bus || l.placa}${tarde ? " · llega antes que tú" : ""}`);
      }

      // Elegir el bus: se resalta esta fila y, en el mapa, el bus queda con un aro blanco.
      const id = l.bus || l.placa;
      boton.dataset.bus = id;
      boton.setAttribute("aria-pressed", String(id === busElegido));
      boton.onclick = () => {
        if (id === busElegido) return elegirBus(null); // tocar de nuevo lo suelta
        elegirBus(id);
        plegar(true);
        mapa.flyTo({ center: l.pos, zoom: 15.5 });
      };
      const li = document.createElement("li");
      li.appendChild(boton);
      return li;
    });
    $("p-llegadas").replaceChildren(...filas);
    // Resumen para cuando la hoja está plegada: paradero, sentido y el próximo bus.
    const primero = visibles()[0];
    const cuando = !primero ? "sin buses por ahora"
      : `${primero.codigo} ${primero.falta - pasado < 1 ? "llegando" : `en ~${Math.round(primero.falta - pasado)} min`}${primero.dudoso ? " ?" : ""}`;
    $("resumen").textContent = `${paradero.nombre} ${flechas(paradero)} · ${cuando}`;
    $("p-nota").hidden = !filas.length;
    $("p-leyenda").hidden = !visibles().some((l) => l.dudoso);
    if (!/ubicación|fuera/i.test($("p-aviso").textContent)) {
      avisar(filas.length ? ""
        : sentido ? `No hay buses hacia el ${sentido} que lleguen en los próximos 30 minutos.`
        : "No hay buses que lleguen a este paradero en los próximos 30 minutos.");
    }
  }
})();
