(function () {
  const ROOT_ID = "jisr-global-teletipo";
  const JSON_URL = "https://joaquinzapatagarcia.github.io/teletipo-jisr-global-personal/jisr-indices-global-personal.json";

  const fallbackData = {
    proyecto: "TELETIPO GLOBAL PERSONAL INDEXES",
    actualizado: "2026-07-04T09:00:00+02:00",
    titular: "El mundo no está roto, pero cada decisión cuesta más margen.",
    lectura_jisr: "La ventaja no está en acertarlo todo, sino en llegar sobrio cuando el entorno se vuelve caro, ruidoso y emocional.",
    posicion_personal: { ipp: 28, ive: 75 },
    indices: [
      { id: "igp", sigla: "IGP", nombre: "Indice Geopolitico", valor: 82, nivel: "Alto", tendencia: "estable", categoria: "mundo", lectura: "Hay desescalada verbal, pero la paz sigue siendo provisional.", senal: "Conflictos abiertos, negociacion fragil y riesgo de eventos laterales.", accion_jisr: "Mantener prudencia antes de asumir que el riesgo geopolitico ha desaparecido." },
      { id: "ieg", sigla: "IEG", nombre: "Indice Economico Global", valor: 61, nivel: "Al alza", tendencia: "sube", categoria: "economia", lectura: "El crecimiento no se rompe, pero el contexto se ha vuelto mas caro y mas incierto.", senal: "Actividad resistente con menor margen para hogares, empresas y gobiernos.", accion_jisr: "Distinguir fortaleza real de simple inercia economica." },
      { id: "iecv", sigla: "IECv", nombre: "Indice de Energia y Coste de Vida", valor: 68, nivel: "Alto", tendencia: "estable", categoria: "energia", lectura: "El petroleo ya no esta en los picos de marzo, pero sigue lo bastante alto como para contaminar inflacion y expectativas.", senal: "Energia todavia cara y sensible a rutas, seguros y decisiones politicas.", accion_jisr: "No construir planes familiares o empresariales con energia barata como supuesto central." },
      { id: "icsl", sigla: "ICSL", nombre: "Indice de Logistica y Suministro", valor: 73, nivel: "Alto", tendencia: "estable", categoria: "suministro", lectura: "Ormuz se mueve, si, pero lentamente y bajo riesgo; eso sigue siendo friccion.", senal: "Rutas logisticas funcionales pero vulnerables a incidentes y encarecimiento.", accion_jisr: "Valorar disponibilidad, plazos y redundancia como parte del coste real." },
      { id: "imf", sigla: "IMF", nombre: "Indice Monetario-Financiero", valor: 70, nivel: "Alto", tendencia: "sube", categoria: "finanzas", lectura: "La energia ha reabierto la puerta a mas subidas de tipos en EE. UU. y mantiene tension en Europa.", senal: "Mercados dependientes de bancos centrales y expectativas de inflacion.", accion_jisr: "Evitar decisiones apalancadas cuando el precio del dinero vuelve a endurecerse." },
      { id: "icsp", sigla: "ICSP", nombre: "Indice de Clima Social", valor: 67, nivel: "Alto", tendencia: "estable", categoria: "sociedad", lectura: "No domina el panico, pero si un cansancio global que empuja a decisiones peores.", senal: "Fatiga social, malestar economico y menor tolerancia a la incertidumbre.", accion_jisr: "No confundir tranquilidad aparente con estabilidad profunda." },
      { id: "ics", sigla: "ICS", nombre: "Indice de Ciberseguridad", valor: 68, nivel: "Alto y creciente", tendencia: "sube", categoria: "seguridad", lectura: "La guerra fisica ya convive con una guerra digital permanente.", senal: "Aumento de ataques a proveedores, pymes, servicios criticos e identidad digital.", accion_jisr: "Tratar la higiene digital como seguridad familiar y empresarial basica." },
      { id: "isfl", sigla: "ISFL", nombre: "Indice de Seguridad Familiar Local", valor: 26, nivel: "Moderado", tendencia: "estable", categoria: "familia", lectura: "Riesgo fisico bajo; riesgo economico y psicologico por entorno caro y volatil.", senal: "La tension llega mas por coste de vida, agenda mental y decisiones mal calibradas.", accion_jisr: "Proteger caja, energia personal y rutinas domesticas." },
      { id: "ipp", sigla: "IPP", nombre: "Indice de Presion Personal", valor: 28, nivel: "Baja", tendencia: "estable", categoria: "personal", lectura: "La presion personal es baja: sigues llegando a la coyuntura con margen.", senal: "Hay capacidad de espera, lectura y seleccion de oportunidades sin urgencia excesiva.", accion_jisr: "Proteger el margen y no convertir una buena posicion en precipitacion." },
      { id: "ive", sigla: "IVE", nombre: "Indice de Ventaja Estrategica", valor: 75, nivel: "Alto", tendencia: "sube", categoria: "personal", lectura: "Tu sobriedad vale mas precisamente porque el mundo esta menos sobrio.", senal: "La ventaja nace de combinar criterio, paciencia, relato y ejecucion.", accion_jisr: "Convertir lectura del mundo en productos, sesiones y decisiones concretas." }
    ]
  };

  let data = fallbackData;
  let indices = fallbackData.indices.slice();
  let selectedIndex = 0;
  let timer = null;

  function clampScore(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(100, Math.round(number)));
  }

  function formatDate(value) {
    if (!value) return "Sin fecha";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("es-ES", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(date);
  }

  function formatScheduledUpdate(value) {
    if (!value) return "Sin fecha";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const slot = new Date(date);
    const minutes = (date.getHours() * 60) + date.getMinutes();

    if (minutes >= (20 * 60) + 7) {
      slot.setHours(20, 7, 0, 0);
    } else if (minutes >= (8 * 60) + 7) {
      slot.setHours(8, 7, 0, 0);
    } else {
      slot.setDate(slot.getDate() - 1);
      slot.setHours(20, 7, 0, 0);
    }

    return `${formatDate(slot)} · ${String(slot.getHours()).padStart(2, "0")}:${String(slot.getMinutes()).padStart(2, "0")}`;
  }

  function withAccents(value) {
    return String(value || "")
      .replace(/\bIndice\b/g, "Índice")
      .replace(/\bindice\b/g, "índice")
      .replace(/\bIndices\b/g, "Índices")
      .replace(/\bindices\b/g, "índices")
      .replace(/\bGeopolitico\b/g, "Geopolítico")
      .replace(/\bgeopolitico\b/g, "geopolítico")
      .replace(/\bEconomico\b/g, "Económico")
      .replace(/\beconomico\b/g, "económico")
      .replace(/\bEnergia\b/g, "Energía")
      .replace(/\benergia\b/g, "energía")
      .replace(/\bLogistica\b/g, "Logística")
      .replace(/\blogistica\b/g, "logística")
      .replace(/\bPresion\b/g, "Presión")
      .replace(/\bpresion\b/g, "presión")
      .replace(/\bTension\b/g, "Tensión")
      .replace(/\btension\b/g, "tensión")
      .replace(/\bSENAL\b/g, "SEÑAL")
      .replace(/\bSenal\b/g, "Señal")
      .replace(/\bsenal\b/g, "señal")
      .replace(/\bAccion\b/g, "Acción")
      .replace(/\baccion\b/g, "acción")
      .replace(/\bPosicion\b/g, "Posición")
      .replace(/\bposicion\b/g, "posición")
      .replace(/\bdecision\b/g, "decisión")
      .replace(/\bdecisiones\b/g, "decisiones")
      .replace(/\bmas\b/g, "más")
      .replace(/\bpublicas\b/g, "públicas")
      .replace(/\bpublicos\b/g, "públicos")
      .replace(/\bfriccion\b/g, "fricción")
      .replace(/\binflacion\b/g, "inflación")
      .replace(/\bpoliticas\b/g, "políticas")
      .replace(/\btodavia\b/g, "todavía")
      .replace(/\bfisico\b/g, "físico")
      .replace(/\bfisica\b/g, "física")
      .replace(/\bpsicologico\b/g, "psicológico")
      .replace(/\bvolatil\b/g, "volátil")
      .replace(/\bseleccion\b/g, "selección")
      .replace(/\bprecipitacion\b/g, "precipitación")
      .replace(/\bbasica\b/g, "básica")
      .replace(/\bprospeccion\b/g, "prospección")
      .replace(/\bejecucion\b/g, "ejecución")
      .replace(/\bfinanciacion\b/g, "financiación")
      .replace(/\bexposicion\b/g, "exposición")
      .replace(/\bfragil\b/g, "frágil")
      .replace(/\bcriticos\b/g, "críticos")
      .replace(/\bcriticas\b/g, "críticas")
      .replace(/\bpequena\b/g, "pequeña")
      .replace(/\butiles\b/g, "útiles")
      .replace(/\bautomatica\b/g, "automática")
      .replace(/\barticulos\b/g, "artículos")
      .replace(/\bsobrerreaccionar\b/g, "sobrerreaccionar")
      .replace(/\breaccion\b/g, "reacción");
  }

  function average(items) {
    if (!items.length) return 0;
    return Math.round(items.reduce((sum, item) => sum + clampScore(item.valor), 0) / items.length);
  }

  function injectStyle() {
    if (document.getElementById("jisr-global-teletipo-style")) return;
    const style = document.createElement("style");
    style.id = "jisr-global-teletipo-style";
    style.textContent = `
      #${ROOT_ID}{--jisr-bg:#fbfbfa;--jisr-fg:#111;--jisr-muted:#666;--jisr-line:#dedbd4;--jisr-soft:#f1eee8;box-sizing:border-box;position:relative;left:50%;width:100vw;max-width:100vw;margin-left:-50vw;margin-right:-50vw;color:var(--jisr-fg);background:transparent;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace;font-size:16px;line-height:1.45;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
      #${ROOT_ID} *,#${ROOT_ID} *:before,#${ROOT_ID} *:after{box-sizing:border-box}
      #${ROOT_ID} .jisr-panel{width:min(1240px,calc(100vw - 40px));margin:0 auto;border:1px solid var(--jisr-line);border-radius:8px;background:var(--jisr-bg);padding:22px}
      #${ROOT_ID} .jisr-top,#${ROOT_ID} .jisr-controls,#${ROOT_ID} .jisr-meta,#${ROOT_ID} .jisr-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
      #${ROOT_ID} .jisr-top{justify-content:space-between;padding-bottom:12px;margin-bottom:18px;border-bottom:1px solid var(--jisr-line)}
      #${ROOT_ID} .jisr-brand{text-transform:uppercase;letter-spacing:.08em;font-weight:600}
      #${ROOT_ID} .jisr-dot{display:inline-block;width:8px;height:8px;margin-right:6px;border-radius:999px;background:var(--jisr-fg)}
      #${ROOT_ID} button{font:inherit}
      #${ROOT_ID} .jisr-btn{border:1px solid var(--jisr-line);background:var(--jisr-soft);color:var(--jisr-fg);border-radius:6px;padding:8px 10px;font-size:15px;line-height:1.2;cursor:pointer}
      #${ROOT_ID} .jisr-btn-primary,#${ROOT_ID} .jisr-btn[aria-pressed=true]{background:var(--jisr-fg);color:var(--jisr-bg);border-color:var(--jisr-fg)}
      #${ROOT_ID} .jisr-meta,#${ROOT_ID} .jisr-label{color:var(--jisr-muted)}
      #${ROOT_ID} .jisr-title{margin:14px 0 8px;max-width:980px;font-size:clamp(27px,3vw,42px);line-height:1.08;font-weight:600;letter-spacing:-.01em}
      #${ROOT_ID} .jisr-reading{max-width:980px;margin:0 0 18px;font-size:clamp(16px,1.35vw,19px)}
      #${ROOT_ID} .jisr-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:16px 0}
      #${ROOT_ID} .jisr-stat{border-top:1px solid var(--jisr-line);padding-top:10px;min-width:0}
      #${ROOT_ID} .jisr-stat strong{display:block;font-size:clamp(24px,2.5vw,34px);line-height:1.05;font-weight:600}
      #${ROOT_ID} .jisr-selected{display:grid;grid-template-columns:minmax(160px,260px) 1fr;gap:18px;border-top:1px solid var(--jisr-line);border-bottom:1px solid var(--jisr-line);padding:18px 0;margin:18px 0 14px}
      #${ROOT_ID} .jisr-score{display:grid;gap:8px;align-content:start}
      #${ROOT_ID} .jisr-score-number{font-size:clamp(58px,9vw,100px);line-height:.95;font-weight:600;letter-spacing:-.06em}
      #${ROOT_ID} .jisr-bar{width:100%;height:9px;border:1px solid var(--jisr-line);border-radius:999px;overflow:hidden;background:#fff}
      #${ROOT_ID} .jisr-bar span{display:block;width:0;height:100%;background:var(--jisr-fg);transition:width 240ms ease}
      #${ROOT_ID} .jisr-index-name{margin:0 0 8px;font-size:clamp(21px,2vw,30px);line-height:1.12;font-weight:600}
      #${ROOT_ID} .jisr-index-reading{margin:0 0 12px;font-size:clamp(16px,1.25vw,18px)}
      #${ROOT_ID} .jisr-note{margin:10px 0 0;border-left:2px solid var(--jisr-fg);padding-left:12px}
      #${ROOT_ID} .jisr-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-top:16px}
      #${ROOT_ID} .jisr-tile{appearance:none;width:100%;min-height:88px;text-align:left;border:1px solid var(--jisr-line);background:#fff;color:var(--jisr-fg);border-radius:8px;padding:10px;cursor:pointer}
      #${ROOT_ID} .jisr-tile[aria-pressed=true]{background:var(--jisr-fg);color:var(--jisr-bg);border-color:var(--jisr-fg)}
      #${ROOT_ID} .jisr-tile-value{display:flex;justify-content:space-between;gap:8px;margin-bottom:6px;font-weight:600}
      #${ROOT_ID} .jisr-tile-name{display:block;color:inherit;opacity:.72;font-size:12px;line-height:1.25}
      #${ROOT_ID}[data-focus=true] .jisr-grid{display:none}
      @media(max-width:860px){#${ROOT_ID} .jisr-stats,#${ROOT_ID} .jisr-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:620px){#${ROOT_ID} .jisr-panel{width:calc(100vw - 20px);padding:14px}#${ROOT_ID} .jisr-controls,#${ROOT_ID} .jisr-btn{width:100%}#${ROOT_ID} .jisr-selected,#${ROOT_ID} .jisr-grid,#${ROOT_ID} .jisr-stats{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function buildHtml() {
    return `
      <div class="jisr-panel">
        <div class="jisr-top">
          <div class="jisr-brand"><span class="jisr-dot" aria-hidden="true"></span>TELETIPO GLOBAL PERSONAL INDEXES</div>
          <div class="jisr-controls">
            <button class="jisr-btn jisr-btn-primary" type="button" data-action="refresh">Actualizar</button>
            <button class="jisr-btn" type="button" data-action="random">Aleatorio</button>
            <button class="jisr-btn" type="button" data-action="auto" aria-pressed="false">Auto</button>
            <button class="jisr-btn" type="button" data-action="focus" aria-pressed="false">Foco</button>
          </div>
        </div>
        <article aria-live="polite" aria-atomic="true">
          <div class="jisr-meta"><span data-field="status">Última actualización</span><span>|</span><span data-field="updated">04/07/2026 · 08:07</span><span>|</span><span data-field="position">IPP 28 · IVE 75</span></div>
          <h2 class="jisr-title" data-field="headline"></h2>
          <p class="jisr-reading" data-field="global-reading"></p>
          <div class="jisr-stats" aria-label="Resumen JISR">
            <div class="jisr-stat"><span class="jisr-label">Tensión actual</span><strong data-field="world-score">--</strong></div>
            <div class="jisr-stat"><span class="jisr-label">Índice más alto</span><strong data-field="highest-score">--</strong></div>
            <div class="jisr-stat"><span class="jisr-label">Presión</span><strong data-field="ipp-score">--</strong></div>
            <div class="jisr-stat"><span class="jisr-label">Ventaja</span><strong data-field="ive-score">--</strong></div>
          </div>
          <div class="jisr-selected">
            <div class="jisr-score">
              <div class="jisr-score-number" data-field="selected-value">--</div>
              <div class="jisr-bar" aria-hidden="true"><span data-field="selected-bar"></span></div>
              <div class="jisr-row"><span data-field="selected-code">---</span><span>|</span><span data-field="selected-level">Nivel</span><span>|</span><span data-field="selected-trend">Tendencia</span></div>
            </div>
            <div>
              <h3 class="jisr-index-name" data-field="selected-name">Índice JISR</h3>
              <p class="jisr-index-reading" data-field="selected-reading"></p>
              <p class="jisr-note"><span class="jisr-label">Señal:</span> <span data-field="selected-signal">--</span></p>
              <p class="jisr-note"><span class="jisr-label">Acción JISR:</span> <span data-field="selected-action">--</span></p>
            </div>
          </div>
        </article>
        <div class="jisr-grid" data-field="grid" aria-label="Índices JISR"></div>
      </div>
    `;
  }

  function findIndexById(id) {
    return indices.find((item) => item.id === id || String(item.sigla || "").toLowerCase() === id);
  }

  function render(root, sourceLabel) {
    indices = Array.isArray(data.indices) ? data.indices.slice() : fallbackData.indices.slice();
    selectedIndex = Math.min(selectedIndex, indices.length - 1);
    const fields = Object.fromEntries(Array.from(root.querySelectorAll("[data-field]")).map((el) => [el.dataset.field, el]));
    const worldItems = indices.filter((item) => item.categoria !== "personal");
    const highest = indices.reduce((current, item) => clampScore(item.valor) > clampScore(current.valor) ? item : current, indices[0]);
    const ipp = findIndexById("ipp") || findIndexById("icp");
    const ive = findIndexById("ive");
    const item = indices[selectedIndex] || indices[0];
    const score = clampScore(item.valor);

    fields.status.textContent = sourceLabel || "Última actualización";
    fields.updated.textContent = formatScheduledUpdate(data.actualizado);
    fields.position.textContent = `IPP ${ipp ? clampScore(ipp.valor) : "--"} · IVE ${ive ? clampScore(ive.valor) : "--"}`;
    fields.headline.textContent = withAccents(data.titular || "Tablero de Índices JISR");
    fields["global-reading"].textContent = withAccents(data.lectura_jisr || "");
    fields["world-score"].textContent = average(worldItems);
    fields["highest-score"].textContent = highest ? `${highest.sigla} ${clampScore(highest.valor)}` : "--";
    fields["ipp-score"].textContent = ipp ? clampScore(ipp.valor) : "--";
    fields["ive-score"].textContent = ive ? clampScore(ive.valor) : "--";
    fields["selected-value"].textContent = score;
    fields["selected-bar"].style.width = `${score}%`;
    fields["selected-code"].textContent = item.sigla || item.id || "--";
    fields["selected-level"].textContent = withAccents(item.nivel || "Sin nivel");
    fields["selected-trend"].textContent = withAccents(`Tendencia ${item.tendencia || "sin dato"}`);
    fields["selected-name"].textContent = withAccents(item.nombre || "Índice JISR");
    fields["selected-reading"].textContent = withAccents(item.lectura || "");
    fields["selected-signal"].textContent = withAccents(item.senal || "Sin señal definida.");
    fields["selected-action"].textContent = withAccents(item.accion_jisr || "Sin acción definida.");

    fields.grid.replaceChildren();
    indices.forEach((indexItem, index) => {
      const button = document.createElement("button");
      button.className = "jisr-tile";
      button.type = "button";
      button.dataset.index = String(index);
      button.setAttribute("aria-pressed", String(index === selectedIndex));
      button.innerHTML = `<span class="jisr-tile-value"><span>${indexItem.sigla || indexItem.id || "--"}</span><span>${clampScore(indexItem.valor)}</span></span><span class="jisr-tile-name">${withAccents(indexItem.nivel || indexItem.nombre || "")}</span>`;
      fields.grid.appendChild(button);
    });
  }

  async function loadData(root) {
    root.querySelector('[data-field="status"]').textContent = "Actualizando...";
    try {
      const response = await fetch(`${JSON_URL}?v=${Date.now()}`);
      if (!response.ok) throw new Error("No se pudo leer el JSON");
      data = await response.json();
      render(root, "Última actualización");
    } catch (error) {
      data = fallbackData;
      render(root, "Modo prototipo");
    }
  }

  function init(attempt) {
    const root = document.getElementById(ROOT_ID);
    if (!root) {
      if ((attempt || 0) < 20) window.setTimeout(() => init((attempt || 0) + 1), 100);
      return;
    }
    if (root.dataset.jisrStarted === "true") return;
    root.dataset.jisrStarted = "true";
    injectStyle();
    root.innerHTML = buildHtml();
    render(root, "Última actualización");

    root.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]");
      const tile = event.target.closest("[data-index]");

      if (tile) {
        selectedIndex = Number(tile.dataset.index);
        render(root, root.querySelector('[data-field="status"]').textContent);
        return;
      }

      if (!action) return;
      const kind = action.dataset.action;
      if (kind === "refresh") loadData(root);
      if (kind === "random") {
        selectedIndex = Math.floor(Math.random() * indices.length);
        render(root, root.querySelector('[data-field="status"]').textContent);
      }
      if (kind === "focus") {
        const enabled = action.getAttribute("aria-pressed") !== "true";
        action.setAttribute("aria-pressed", String(enabled));
        root.dataset.focus = String(enabled);
      }
      if (kind === "auto") {
        const enabled = action.getAttribute("aria-pressed") !== "true";
        action.setAttribute("aria-pressed", String(enabled));
        if (enabled) {
          timer = window.setInterval(() => {
            selectedIndex = Math.floor(Math.random() * indices.length);
            render(root, root.querySelector('[data-field="status"]').textContent);
          }, 30000);
        } else if (timer) {
          window.clearInterval(timer);
          timer = null;
        }
      }
    });

    loadData(root);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => init(0));
  } else {
    init(0);
  }
}());
