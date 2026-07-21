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

async function fetchQuery(query, policy) {
  if (OFFLINE) return {ok: false, articles: [], error: "offline"};
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(buildGdeltUrl(query, policy), {signal: controller.signal, headers:{"user-agent":"JISR-Global-Personal/1.0"}});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    return {ok: true, articles: (payload.articles || []).map((article) => ({title:article.title || "", url:article.url || "", domain:article.domain || "", seenDate:article.seendate || ""}))};
  } catch (error) {
    return {ok: false, articles: [], error: error.message};
  } finally { clearTimeout(timeout); }
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
  const position = await readJson("config/personal-position.public.json");
  const previous = await readJson(config.dataFile, {indices: []});
  const previousById = new Map((previous.indices || []).map((item) => [item.id, item]));
  const results = [];

  for (const [index, definition] of config.indices.entries()) {
    if (index > 0 && !OFFLINE) await sleep(config.sourcePolicy.requestDelayMs ?? 5500);
    results.push({...await fetchQuery(definition.query, config.sourcePolicy), definition});
  }

  const successful = results.filter((result) => result.ok).length;
  const failed = results.length - successful;
  const totalEvidence = results.reduce((sum, result) => sum + result.articles.length, 0);
  const hasNewData = successful > 0 && totalEvidence > 0;
  const edition = hasNewData ? scheduledEdition(now, config.timezone) : (previous.edicion || scheduledEdition(now, config.timezone));
  const external = results.map((result) => {
    const definition = result.definition;
    const old = previousById.get(definition.id);
    if (!hasNewData || !result.ok) return old || {id:definition.id,sigla:definition.sigla,nombre:definition.nombre,valor:definition.base,nivel:level(definition.base),tendencia:"estable",confianza:0,categoria:definition.categoria,lectura:"Lectura conservada por falta de datos nuevos.",senal:"Sin señales nuevas verificables.",accion_jisr:definition.actions[bucket(definition.base)],evidencia:[],motivo_dia:"Edición conservada.",fuentes_linea:"Fuentes externas temporalmente degradadas."};
    const scored = scoreArticles(definition, old?.valor ?? definition.base, result.articles, config.sourcePolicy);
    const evidence = scored.evidence.slice(0, 5).map((article) => ({titulo:article.title,fuente:article.domain,url:article.url,fecha:article.seenDate}));
    return {id:definition.id,sigla:definition.sigla,nombre:definition.nombre,valor:scored.value,nivel:level(scored.value),tendencia:trend(old?.valor ?? definition.base,scored.value),confianza:scored.confidence,categoria:definition.categoria,lectura:reading(definition,scored.value,scored.evidence),senal:evidence.slice(0,3).map((item)=>item.titulo).join(" | ") || "Sin señales nuevas verificables.",accion_jisr:definition.actions[bucket(scored.value)],evidencia:evidence,motivo_dia:`${evidence.length} evidencias útiles; cálculo ${scored.mode}.`,fuentes_linea:`${new Set(scored.evidence.map((item)=>item.domain).filter(Boolean)).size} fuentes distintas vía GDELT.`};
  });

  const average = Math.round(external.reduce((sum, item) => sum + item.valor, 0) / external.length);
  const ippValue = clamp(position.ipp.base + Math.max(-2, Math.min(6, Math.round((average - 55) / 8))));
  const iveValue = clamp(position.ive.base + Math.max(-2, Math.min(5, Math.round((average - 50) / 10))) - Math.max(0, Math.round((ippValue - 40) / 6)));
  const personal = [
    {id:"ipp",sigla:"IPP",nombre:"Índice de Presión Personal",valor:ippValue,nivel:level(ippValue,true),tendencia:trend(previousById.get("ipp")?.valor ?? position.ipp.base,ippValue),confianza:1,categoria:"personal",lectura:position.ipp.summary,senal:"Posición personal revisada de forma manual y combinada con el contexto exterior.",accion_jisr:"Proteger margen, salud, foco y estabilidad familiar.",evidencia:[],motivo_dia:`Base manual ${position.ipp.base}; ajuste exterior ${ippValue-position.ipp.base >= 0 ? "+" : ""}${ippValue-position.ipp.base}.`,fuentes_linea:"Base personal pública mínima; sin datos sensibles."},
    {id:"ive",sigla:"IVE",nombre:"Índice de Ventaja Estratégica",valor:iveValue,nivel:level(iveValue),tendencia:trend(previousById.get("ive")?.valor ?? position.ive.base,iveValue),confianza:1,categoria:"personal",lectura:position.ive.summary,senal:"La necesidad de criterio aumenta cuando el entorno gana complejidad.",accion_jisr:"Convertir ventaja en producto, prospección y agenda activa.",evidencia:[],motivo_dia:`Base manual ${position.ive.base}; ajuste exterior ${iveValue-position.ive.base >= 0 ? "+" : ""}${iveValue-position.ive.base}.`,fuentes_linea:"Base personal pública mínima; sin datos sensibles."}
  ];
  const indices = hasNewData ? [...external, ...personal] : (previous.indices?.length ? previous.indices : [...external, ...personal]);
  const top = external.reduce((best, item) => item.valor > best.valor ? item : best, external[0]);
  const sourceState = failed === results.length ? "degradadas" : !hasNewData ? "sin_senales_nuevas" : failed ? "parciales" : "operativas";
  const output = {
    proyecto: config.project, version: "1.0", timezone: config.timezone,
    ultima_ejecucion: now.toISOString(),
    ultima_actualizacion_con_datos: hasNewData ? now.toISOString() : (previous.ultima_actualizacion_con_datos || previous.actualizado || null),
    edicion: edition,
    estado_publicacion: hasNewData ? "actualizada" : "conservada",
    estado_fuentes: {estado:sourceState, consultas_totales:results.length, consultas_correctas:successful, consultas_fallidas:failed, evidencias_totales:totalEvidence},
    escala: {min:0,max:100,lectura:"0 equivale a tensión muy baja; 100 equivale a tensión extrema."},
    titular: hasNewData ? `El centro de gravedad está en ${top.sigla} (${top.valor}).` : (previous.titular || "Edición conservada: faltan señales externas verificables."),
    lectura_jisr: hasNewData ? `La presión principal procede de ${top.sigla}. IPP ${ippValue} e IVE ${iveValue}: proteger margen y convertir criterio en ventaja.` : (previous.lectura_jisr || "El tablero conserva la última lectura validada."),
    posicion_personal: {ipp:indices.find((item)=>item.id==="ipp")?.valor,ive:indices.find((item)=>item.id==="ive")?.valor,resumen:"Posición pública mínima; el perfil detallado permanece fuera del repositorio."},
    indices
  };
  const errors = validatePublicOutput(output);
  if (errors.length) throw new Error(`Salida inválida:\n- ${errors.join("\n- ")}`);
  if (!DRY_RUN) await fs.writeFile(path.join(ROOT, config.dataFile), `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({estado:output.estado_publicacion,fuentes:sourceState,evidencias:totalEvidence,edicion:edition.id}));
  return output;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) run().catch((error) => { console.error(error); process.exitCode = 1; });
