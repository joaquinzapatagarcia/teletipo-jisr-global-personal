import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const OFFLINE = process.env.JISR_OFFLINE === "1";
const DRY_RUN = process.env.JISR_DRY_RUN === "1";

export const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(Number(value) || 0)));
export const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function isGroupedOrQuery(query) {
  const withoutModifiers = String(query).replace(/\s+sourcelang:\w+\s*$/i, "").trim();
  if (!/\sOR\s/i.test(withoutModifiers)) return true;
  let depth = 0;
  for (const char of withoutModifiers) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0 && withoutModifiers.startsWith("(") && withoutModifiers.includes(")");
}

export function buildGdeltUrl(query, policy) {
  if (!isGroupedOrQuery(query)) throw new Error(`Consulta OR sin agrupar: ${query}`);
  const params = new URLSearchParams({
    query,
    mode: "ArtList",
    format: "json",
    maxrecords: String(policy.maxRecordsPerQuery || 20),
    timespan: policy.lookback || "1d",
    sort: "hybridrel"
  });
  return `https://api.gdeltproject.org/api/v2/doc/doc?${params}`;
}

export function dedupeArticles(articles) {
  const seen = new Set();
  return articles.filter((article) => {
    const key = normalize(article.url || article.title).replace(/[?#].*$/, "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function countMatches(text, words = []) {
  const haystack = normalize(text);
  return words.reduce((sum, word) => sum + Number(haystack.includes(normalize(word))), 0);
}

export function scoreArticles(index, previousValue, articles, policy) {
  const evidence = dedupeArticles(articles);
  let signedSignal = 0;
  for (const article of evidence) {
    const text = `${article.title} ${article.domain}`;
    signedSignal += countMatches(text, index.keywords.high) * 5;
    signedSignal += countMatches(text, index.keywords.medium) * 2;
    signedSignal -= countMatches(text, index.keywords.down) * 4;
  }
  const averageSignal = evidence.length ? signedSignal / evidence.length : 0;
  const raw = clamp((index.base ?? previousValue ?? 50) + averageSignal);
  const domains = new Set(evidence.map((item) => item.domain).filter(Boolean)).size;
  const confidence = Number(Math.min(0.92, 0.25 + evidence.length / 40 + domains / 30).toFixed(2));
  if (evidence.length < (policy.minimumArticlesForMovement ?? 4)) {
    const limit = policy.maxLowEvidenceMove ?? 1;
    const delta = clamp(raw - previousValue, -limit, limit);
    return {value: clamp(previousValue + delta), confidence: Math.min(confidence, 0.42), raw, evidence, mode: "baja_evidencia"};
  }
  const weight = Math.abs(raw - previousValue) >= 18 ? (policy.shockSignalWeight ?? 0.45) : (policy.newSignalWeight ?? 0.3);
  return {value: clamp(previousValue * (1 - weight) + raw * weight), confidence, raw, evidence, mode: "amortiguado"};
}

function level(score, feminine = false) {
  if (score >= 85) return feminine ? "Extrema" : "Extremo";
  if (score >= 70) return feminine ? "Muy alta" : "Muy alto";
  if (score >= 50) return feminine ? "Alta" : "Alto";
  if (score >= 30) return feminine ? "Moderada" : "Moderado";
  return feminine ? "Baja" : "Bajo";
}

function bucket(score) {
  if (score >= 85) return "extreme";
  if (score >= 50) return "high";
  if (score >= 30) return "medium";
  return "low";
}

function trend(previous, current) {
  if (current - previous >= 3) return "sube";
  if (current - previous <= -3) return "baja";
  return "estable";
}

function reading(item, value, evidence) {
  const lead = evidence[0]?.title;
  if (lead) return `${level(value)}. La señal dominante procede de: ${lead}`;
  if (value >= 70) return `${level(value)}. El entorno exige prudencia y decisiones reversibles.`;
  if (value >= 50) return `${level(value)}. Hay fricción suficiente para elevar el filtro.`;
  if (value >= 30) return `${level(value)}. Conviene observar sin precipitarse.`;
  return `${level(value)}. La señal aparece contenida.`;
}

function scheduledEdition(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {timeZone: timezone, year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", hourCycle:"h23"}).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  const datePart = `${get("year")}-${get("month")}-${get("day")}`;
  const slot = Number(get("hour")) < 14 ? "08:07" : "20:07";
  return {id: `${datePart}-${slot.replace(":", "")}`, date: datePart, slot};
}

async function readJson(file, fallback = {}) {
  try { return JSON.parse(await fs.readFile(path.join(ROOT, file), "utf8")); }
  catch { return fallback; }
}

async function writeJson(file, value) {
  const target = path.join(ROOT, file);
  await fs.mkdir(path.dirname(target), {recursive:true});
  await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
}

function transient(error) {
  return /abort|timeout|HTTP (408|425|429|5\d\d)/i.test(String(error));
}

async function fetchQuery(source, policy, cached) {
  if (OFFLINE) return {ok: false, articles: [], error: "offline"};
  const delays = [0, ...(policy.retryDelaysMs || [])];
  let lastError = "unknown";
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt]) await sleep(delays[attempt]);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), policy.timeoutMs || 22000);
    try {
      const response = await fetch(buildGdeltUrl(source.query, policy), {signal:controller.signal, headers:{"user-agent":"JISR-Global-Personal/2.0"}});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const articles = dedupeArticles((payload.articles || []).map((article) => ({title:article.title || "",url:article.url || "",domain:article.domain || "",seenDate:article.seendate || ""})));
      return {ok:true,articles,error:null,attempts:attempt+1,mode:"live",updatedAt:new Date().toISOString()};
    } catch (error) {
      lastError = error.name === "AbortError" ? "timeout" : error.message;
      if (!transient(lastError)) break;
    } finally { clearTimeout(timeout); }
  }
  const age = cached?.updatedAt ? (Date.now()-Date.parse(cached.updatedAt))/36e5 : Infinity;
  if (cached?.articles?.length && age <= (policy.cacheMaxAgeHours || 36)) return {...cached,ok:true,error:lastError,mode:"cache",attempts:delays.length};
  return {ok:false,articles:[],error:lastError,attempts:delays.length,mode:"failed",updatedAt:new Date().toISOString()};
}

async function fetchMarket(now) {
  const key = process.env.TWELVE_DATA_API_KEY;
  const symbols = "SPY,QQQ,DAX,IBEX,NIKKEI,EUR/USD,WTI,XAU/USD,BTC/USD";
  if (!key || OFFLINE) return {estado:key ? "sin_consulta" : "canal_en_preparacion",provider:"Twelve Data",observacion_activa:false,updatedAt:now.toISOString(),instruments:[]};
  try {
    const url = new URL("https://api.twelvedata.com/quote");
    url.searchParams.set("symbol", symbols); url.searchParams.set("apikey", key);
    const response = await fetch(url, {headers:{"user-agent":"JISR-Market/1.0"}});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.status === "error") throw new Error(payload.message || "Twelve Data error");
    const rows = Object.values(payload).filter((x) => x && typeof x === "object" && x.symbol);
    return {estado:"modo_sombra",provider:"Twelve Data",observacion_activa:true,updatedAt:now.toISOString(),instruments:rows.map((x)=>({symbol:x.symbol,name:x.name || x.symbol,close:Number(x.close),changePercent:Number(x.percent_change)})).filter((x)=>Number.isFinite(x.close))};
  } catch (error) {
    return {estado:"degradado",provider:"Twelve Data",observacion_activa:false,updatedAt:now.toISOString(),error:error.message,instruments:[]};
  }
}

export function validatePublicOutput(data) {
  const errors = [];
  const ids = new Set((data.indices || []).map((item) => item.id));
  for (const id of ["igp","ieg","iecv","icsl","imf","icsp","ics","isfl","ipp","ive"]) if (!ids.has(id)) errors.push(`Falta índice ${id}`);
  for (const item of data.indices || []) {
    if (!Number.isFinite(item.valor) || item.valor < 0 || item.valor > 100) errors.push(`Valor inválido en ${item.id}`);
    if (!Number.isFinite(item.confianza) || item.confianza < 0 || item.confianza > 1) errors.push(`Confianza inválida en ${item.id}`);
  }
  const serialized = JSON.stringify(data).toLowerCase();
  for (const forbidden of ["peso_kg","ingresos_personales","margen_caja","familia_y_entorno","red_y_accesos","ubicaciones_relevantes"]) {
    if (serialized.includes(forbidden)) errors.push(`Campo privado detectado: ${forbidden}`);
  }
  if (!["operativas","parciales","degradadas","sin_senales_nuevas"].includes(data.estado_fuentes?.estado)) errors.push("Estado de fuentes inválido");
  return errors;
}

export async function run(now = new Date()) {
  const config = await readJson("config/indices.json");
  const publicPosition = await readJson("config/personal-position.public.json");
  let position = publicPosition;
  if (process.env.JISR_PERSONAL_POSITION_JSON) {
    try {
      const privatePosition = JSON.parse(process.env.JISR_PERSONAL_POSITION_JSON);
      position = {
        ipp: {...publicPosition.ipp, base:clamp(privatePosition.ipp)},
        ive: {...publicPosition.ive, base:clamp(privatePosition.ive)}
      };
    } catch { console.warn("JISR_PERSONAL_POSITION_JSON inválido; se usa la base pública."); }
  }
  const previous = await readJson(config.dataFile, {indices: []});
  const sourceCache = await readJson("public/data/source-cache.json", {});
  const previousById = new Map((previous.indices || []).map((item) => [item.id, item]));
  const results = [];

  for (const [index, source] of config.masterQueries.entries()) {
    if (index > 0 && !OFFLINE) await sleep(config.sourcePolicy.requestDelayMs ?? 5500);
    results.push({...await fetchQuery(source, config.sourcePolicy, sourceCache[source.id]), source});
  }

  const successful = results.filter((result) => result.ok).length;
  const failed = results.length - successful;
  const totalEvidence = results.reduce((sum, result) => sum + result.articles.length, 0);
  const hasNewData = successful > 0 && totalEvidence > 0;
  const edition = hasNewData ? scheduledEdition(now, config.timezone) : (previous.edicion || scheduledEdition(now, config.timezone));
  const external = config.indices.map((definition) => {
    const applicable = results.filter((result) => result.source.indices.includes(definition.id));
    const articles = dedupeArticles(applicable.flatMap((result) => result.articles));
    const sourceOk = applicable.some((result) => result.ok);
    const old = previousById.get(definition.id);
    if (!hasNewData || !sourceOk || !articles.length) return old || {id:definition.id,sigla:definition.sigla,nombre:definition.nombre,valor:definition.base,nivel:level(definition.base),tendencia:"estable",confianza:0,categoria:definition.categoria,lectura:"Última lectura válida, sin datos suficientes para actualizar este índice.",senal:"Sin señales nuevas verificables.",accion_jisr:definition.actions[bucket(definition.base)],evidencia:[],motivo_dia:"Lectura vigente.",fuentes_linea:"Datos externos temporalmente insuficientes."};
    const scored = scoreArticles(definition, old?.valor ?? definition.base, articles, config.sourcePolicy);
    const evidence = scored.evidence.slice(0, 5).map((article) => ({titulo:article.title,fuente:article.domain,url:article.url,fecha:article.seenDate}));
    return {id:definition.id,sigla:definition.sigla,nombre:definition.nombre,valor:scored.value,nivel:level(scored.value),tendencia:trend(old?.valor ?? definition.base,scored.value),confianza:scored.confidence,categoria:definition.categoria,lectura:reading(definition,scored.value,scored.evidence),senal:evidence.slice(0,3).map((item)=>item.titulo).join(" | ") || "Sin señales nuevas verificables.",accion_jisr:definition.actions[bucket(scored.value)],evidencia:evidence,motivo_dia:`${evidence.length} evidencias útiles; cálculo ${scored.mode}.`,fuentes_linea:`${new Set(scored.evidence.map((item)=>item.domain).filter(Boolean)).size} fuentes distintas vía GDELT.`};
  });

  const average = Math.round(external.reduce((sum, item) => sum + item.valor, 0) / external.length);
  const ippValue = clamp(position.ipp.base + Math.max(-2, Math.min(6, Math.round((average - 55) / 8))));
  const iveValue = clamp(position.ive.base + Math.max(-2, Math.min(5, Math.round((average - 50) / 10))) - Math.max(0, Math.round((ippValue - 40) / 6)));
  const personal = [
    {id:"ipp",sigla:"IPP",nombre:"Índice de Presión Personal",valor:ippValue,nivel:level(ippValue,true),tendencia:trend(previousById.get("ipp")?.valor ?? position.ipp.base,ippValue),confianza:1,categoria:"personal",lectura:position.ipp.summary,senal:"Posición personal revisada y combinada con el contexto exterior.",accion_jisr:"Proteger margen, salud, foco y estabilidad familiar.",evidencia:[],motivo_dia:"Recalibración privada y ajuste exterior limitado.",fuentes_linea:"Resultado público mínimo; base y dimensiones privadas."},
    {id:"ive",sigla:"IVE",nombre:"Índice de Ventaja Estratégica",valor:iveValue,nivel:level(iveValue),tendencia:trend(previousById.get("ive")?.valor ?? position.ive.base,iveValue),confianza:1,categoria:"personal",lectura:position.ive.summary,senal:"La necesidad de criterio aumenta cuando el entorno gana complejidad.",accion_jisr:"Convertir ventaja en producto, prospección y agenda activa.",evidencia:[],motivo_dia:"Recalibración privada y ajuste exterior limitado.",fuentes_linea:"Resultado público mínimo; base y dimensiones privadas."}
  ];
  const indices = hasNewData ? [...external, ...personal] : (previous.indices?.length ? previous.indices : [...external, ...personal]);
  const top = external.reduce((best, item) => item.valor > best.valor ? item : best, external[0]);
  const sourceState = failed === results.length ? "degradadas" : !hasNewData ? "sin_senales_nuevas" : failed ? "parciales" : "operativas";
  const sourceHealth = results.map((result)=>({id:result.source.id,fuente:result.source.label,estado:result.mode === "live" ? "operativo" : result.mode === "cache" ? "caché" : "fallo",ultimo_dato_valido:result.ok ? result.updatedAt : (sourceCache[result.source.id]?.updatedAt || null),intentos:result.attempts,evidencias:result.articles.length,error:result.error || null}));
  const output = {
    proyecto: config.project, version: "2.0", timezone: config.timezone,
    ultima_ejecucion: now.toISOString(),
    ultima_actualizacion_con_datos: hasNewData ? now.toISOString() : (previous.ultima_actualizacion_con_datos || previous.actualizado || null),
    edicion: edition,
    estado_publicacion: hasNewData ? "actualizada" : "conservada",
    estado_fuentes: {estado:sourceState, consultas_totales:results.length, consultas_correctas:successful, consultas_fallidas:failed, evidencias_totales:totalEvidence,grifos:sourceHealth},
    escala: {min:0,max:100,lectura:"0 equivale a tensión muy baja; 100 equivale a tensión extrema."},
    titular: hasNewData ? `El centro de gravedad está en ${top.sigla} (${top.valor}).` : (previous.titular || "Edición conservada: faltan señales externas verificables."),
    lectura_jisr: hasNewData ? `La presión principal procede de ${top.sigla}. IPP ${ippValue} e IVE ${iveValue}: proteger margen y convertir criterio en ventaja.` : (previous.lectura_jisr || "El tablero conserva la última lectura validada."),
    posicion_personal: {ipp:indices.find((item)=>item.id==="ipp")?.valor,ive:indices.find((item)=>item.id==="ive")?.valor,resumen:"Posición pública mínima; el perfil detallado permanece fuera del repositorio."},
    indices,
    historico: {index_url:"public/data/history-index.json",ventanas:[7,30,90]}
  };
  const errors = validatePublicOutput(output);
  if (errors.length) throw new Error(`Salida inválida:\n- ${errors.join("\n- ")}`);
  if (!DRY_RUN) {
    const operation = {ejecucion:now.toISOString(),edicion:scheduledEdition(now, config.timezone),publicacion:output.estado_publicacion,fuentes:sourceHealth,evidencias:totalEvidence};
    const operationFile = `public/data/operations/${operation.edicion.date}.json`;
    const operationLog = await readJson(operationFile, {date:operation.edicion.date,runs:[]});
    operationLog.runs.push(operation);
    await writeJson(operationFile, operationLog);
    await writeJson("public/data/source-cache.json", {...sourceCache,...Object.fromEntries(results.filter((r)=>r.ok && r.mode === "live").map((r)=>[r.source.id,{articles:r.articles,updatedAt:r.updatedAt}]))});
    if (hasNewData) {
      const archiveFile = `public/data/archive/${edition.date.slice(0,4)}/${edition.date.slice(5,7)}/${edition.id}.json`;
      const history = await readJson("public/data/history-index.json", {version:"1.0",editions:[]});
      const summary = {id:edition.id,date:edition.date,slot:edition.slot,path:archiveFile.replace(/^public\//,""),indices:Object.fromEntries(indices.map((item)=>[item.id,item.valor]))};
      history.editions = [...history.editions.filter((item)=>item.id !== edition.id),summary].sort((a,b)=>a.id.localeCompare(b.id)).slice(-180);
      history.coverage = Object.fromEntries([7,30,90].map((days)=>[days,Math.min(days,new Set(history.editions.map((item)=>item.date)).size)]));
      await writeJson(archiveFile, output);
      await writeJson("public/data/history-index.json", history);
    }
    await writeJson(config.dataFile, output);
    await writeJson("public/data/market-latest.json", await fetchMarket(now));
  }
  console.log(JSON.stringify({estado:output.estado_publicacion,fuentes:sourceState,evidencias:totalEvidence,edicion:edition.id}));
  return output;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) run().catch((error) => { console.error(error); process.exitCode = 1; });
