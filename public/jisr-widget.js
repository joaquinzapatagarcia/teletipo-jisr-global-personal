(function () {
  "use strict";
  const ROOT_ID = "jisr-global-teletipo";
  const DATA_URL = "https://joaquinzapatagarcia.github.io/teletipo-jisr-global-personal/public/data/latest.json";
  let data = null;
  let selectedIndex = 0;
  let timer = null;

  const score = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  const average = (items) => items.length ? Math.round(items.reduce((sum, item) => sum + score(item.valor), 0) / items.length) : 0;

  function formatEdition(payload) {
    if (!payload?.edicion) return "Sin edición validada";
    const date = new Date(`${payload.edicion.date}T12:00:00`);
    const label = new Intl.DateTimeFormat("es-ES", {day:"2-digit",month:"2-digit",year:"numeric"}).format(date);
    return `${label} · Edición ${payload.edicion.slot}`;
  }

  function statusText(payload) {
    if (payload.estado_publicacion === "conservada") return "LECTURA VIGENTE · DATOS INSUFICIENTES PARA ACTUALIZAR";
    if (payload.estado_fuentes?.estado === "parciales") return "Actualizada · Fuentes parcialmente operativas";
    return "Última lectura validada";
  }

  function injectStyle() {
    if (document.getElementById("jisr-global-teletipo-style")) return;
    const style = document.createElement("style");
    style.id = "jisr-global-teletipo-style";
    style.textContent = `
      #${ROOT_ID}{--bg:#fbfbfa;--fg:#111;--muted:#666;--line:#dedbd4;--soft:#f1eee8;box-sizing:border-box;position:relative;left:50%;width:100vw;max-width:100vw;margin-left:-50vw;color:var(--fg);font:16px/1.45 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;-webkit-font-smoothing:antialiased}
      #${ROOT_ID} *,#${ROOT_ID} *:before,#${ROOT_ID} *:after{box-sizing:border-box}
      #${ROOT_ID} .panel{width:min(1240px,calc(100vw - 40px));margin:auto;border:1px solid var(--line);border-radius:8px;background:var(--bg);padding:22px}
      #${ROOT_ID} .top,#${ROOT_ID} .controls,#${ROOT_ID} .meta,#${ROOT_ID} .row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
      #${ROOT_ID} .top{justify-content:space-between;padding-bottom:12px;margin-bottom:18px;border-bottom:1px solid var(--line)}
      #${ROOT_ID} .brand{text-transform:uppercase;letter-spacing:.08em;font-weight:600}
      #${ROOT_ID} .dot{display:inline-block;width:8px;height:8px;margin-right:6px;border-radius:50%;background:var(--fg)}
      #${ROOT_ID} button{font:inherit} #${ROOT_ID} .btn{border:1px solid var(--line);background:var(--soft);color:var(--fg);border-radius:6px;padding:8px 10px;cursor:pointer}
      #${ROOT_ID} .btn.primary,#${ROOT_ID} .btn[aria-pressed=true]{background:var(--fg);color:var(--bg);border-color:var(--fg)}
      #${ROOT_ID} .meta,#${ROOT_ID} .label{color:var(--muted)} #${ROOT_ID} .status-warning{color:#8a5200}
      #${ROOT_ID} .title{margin:14px 0 8px;max-width:980px;font-size:clamp(27px,3vw,42px);line-height:1.08}
      #${ROOT_ID} .reading{max-width:980px;margin:0 0 18px;font-size:clamp(16px,1.35vw,19px)}
      #${ROOT_ID} .stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:16px 0}
      #${ROOT_ID} .stat{border-top:1px solid var(--line);padding-top:10px} #${ROOT_ID} .stat strong{display:block;font-size:clamp(24px,2.5vw,34px)}
      #${ROOT_ID} .selected{display:grid;grid-template-columns:minmax(160px,260px) 1fr;gap:18px;border-block:1px solid var(--line);padding:18px 0;margin:18px 0 14px}
      #${ROOT_ID} .number{font-size:clamp(58px,9vw,100px);line-height:.95;font-weight:600;letter-spacing:-.06em}
      #${ROOT_ID} .bar{height:9px;border:1px solid var(--line);border-radius:99px;overflow:hidden;background:#fff} #${ROOT_ID} .bar span{display:block;height:100%;background:var(--fg);transition:width .24s}
      #${ROOT_ID} .note{margin:10px 0 0;border-left:2px solid var(--fg);padding-left:12px}
      #${ROOT_ID} .grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-top:16px}
      #${ROOT_ID} .tile{width:100%;min-height:88px;text-align:left;border:1px solid var(--line);background:#fff;border-radius:8px;padding:10px;cursor:pointer}
      #${ROOT_ID} .tile[aria-pressed=true]{background:var(--fg);color:var(--bg);border-color:var(--fg)} #${ROOT_ID} .tile-value{display:flex;justify-content:space-between;font-weight:600} #${ROOT_ID} .tile-name{display:block;opacity:.72;font-size:12px}
      #${ROOT_ID}[data-focus=true] .grid{display:none} #${ROOT_ID} .unavailable{padding:28px 0;font-size:18px}
      @media(max-width:860px){#${ROOT_ID} .stats,#${ROOT_ID} .grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:620px){#${ROOT_ID} .panel{width:calc(100vw - 20px);padding:14px}#${ROOT_ID} .controls,#${ROOT_ID} .btn{width:100%}#${ROOT_ID} .selected,#${ROOT_ID} .grid,#${ROOT_ID} .stats{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function shell() {
    return `<div class="panel"><div class="top"><div class="brand"><span class="dot"></span>TELETIPO GLOBAL PERSONAL INDEXES</div><div class="controls"><button class="btn primary" data-action="refresh">Actualizar</button><button class="btn" data-action="random">Aleatorio</button><button class="btn" data-action="auto" aria-pressed="false">Auto</button><button class="btn" data-action="focus" aria-pressed="false">Foco</button></div></div><main data-view><div class="unavailable">Conectando con la última lectura validada…</div></main></div>`;
  }

  function render(root) {
    const view = root.querySelector("[data-view]");
    if (!data?.indices?.length) {
      view.innerHTML = `<div class="unavailable"><strong>Lectura no disponible.</strong><br>El teletipo no mostrará cifras de sustitución como si fueran datos actuales.</div>`;
      return;
    }
    selectedIndex = Math.min(selectedIndex, data.indices.length - 1);
    const item = data.indices[selectedIndex];
    const world = data.indices.filter((entry) => entry.categoria !== "personal");
    const highest = world.reduce((best, entry) => score(entry.valor) > score(best.valor) ? entry : best, world[0]);
    const ipp = data.indices.find((entry) => entry.id === "ipp");
    const ive = data.indices.find((entry) => entry.id === "ive");
    const warning = data.estado_publicacion === "conservada" ? "status-warning" : "";
    view.innerHTML = `<article aria-live="polite"><div class="meta ${warning}"><span>${statusText(data)}</span><span>|</span><span>${formatEdition(data)}</span><span>|</span><span>IPP ${ipp?.valor ?? "--"} · IVE ${ive?.valor ?? "--"}</span></div><h2 class="title">${data.titular || "Tablero JISR"}</h2><p class="reading">${data.lectura_jisr || ""}</p><div class="stats"><div class="stat"><span class="label">Tensión global</span><strong>${average(world)}</strong></div><div class="stat"><span class="label">Índice más alto</span><strong>${highest ? `${highest.sigla} ${highest.valor}` : "--"}</strong></div><div class="stat"><span class="label">Presión</span><strong>${ipp?.valor ?? "--"}</strong></div><div class="stat"><span class="label">Ventaja</span><strong>${ive?.valor ?? "--"}</strong></div></div><div class="selected"><div><div class="number">${score(item.valor)}</div><div class="bar"><span style="width:${score(item.valor)}%"></span></div><div class="row"><span>${item.sigla}</span><span>|</span><span>${item.nivel}</span><span>|</span><span>${item.tendencia}</span></div></div><div><h3>${item.nombre}</h3><p>${item.lectura || ""}</p><p class="note"><span class="label">Motivo del día:</span> ${item.motivo_dia || "--"}</p><p class="note"><span class="label">Fuentes:</span> ${item.fuentes_linea || "--"}</p><p class="note"><span class="label">Señal:</span> ${item.senal || "--"}</p><p class="note"><span class="label">Acción JISR:</span> ${item.accion_jisr || "--"}</p></div></div><div class="grid">${data.indices.map((entry, index) => `<button class="tile" data-index="${index}" aria-pressed="${index === selectedIndex}"><span class="tile-value"><span>${entry.sigla}</span><span>${score(entry.valor)}</span></span><span class="tile-name">${entry.nivel}</span></button>`).join("")}</div></article>`;
  }

  async function load(root) {
    try {
      const response = await fetch(`${DATA_URL}?v=${Date.now()}`, {cache:"no-store"});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      data = await response.json();
    } catch (error) {
      console.error("JISR:", error);
      data = null;
    }
    render(root);
  }

  function init(attempt = 0) {
    const root = document.getElementById(ROOT_ID);
    if (!root) { if (attempt < 20) setTimeout(() => init(attempt + 1), 100); return; }
    if (root.dataset.started) return;
    root.dataset.started = "true";
    injectStyle(); root.innerHTML = shell();
    root.addEventListener("click", (event) => {
      const tile = event.target.closest("[data-index]");
      const action = event.target.closest("[data-action]");
      if (tile) { selectedIndex = Number(tile.dataset.index); render(root); return; }
      if (!action) return;
      if (action.dataset.action === "refresh") load(root);
      if (action.dataset.action === "random" && data?.indices?.length) { selectedIndex = Math.floor(Math.random() * data.indices.length); render(root); }
      if (action.dataset.action === "focus") { const on = action.getAttribute("aria-pressed") !== "true"; action.setAttribute("aria-pressed", String(on)); root.dataset.focus = String(on); }
      if (action.dataset.action === "auto") { const on = action.getAttribute("aria-pressed") !== "true"; action.setAttribute("aria-pressed", String(on)); if (on) timer = setInterval(() => { if (data?.indices?.length) { selectedIndex = (selectedIndex + 1) % data.indices.length; render(root); } }, 30000); else { clearInterval(timer); timer = null; } }
    });
    load(root);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => init()); else init();
}());
