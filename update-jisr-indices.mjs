import fs from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const configPath = path.join(rootDir, "jisr-agent-config.json");
const profilePath = path.join(rootDir, "jisr-personal-profile.json");
const offline = process.env.JISR_OFFLINE === "1";
const dryRun = process.env.JISR_DRY_RUN === "1";

function clamp(value, min = 0, max = 100) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function countMatches(text, words = []) {
  const normalized = normalizeText(text);
  return words.reduce((total, word) => {
    return total + (normalized.includes(normalizeText(word)) ? 1 : 0);
  }, 0);
}

function levelForScore(score, manualLevel) {
  if (manualLevel) return manualLevel;
  if (score >= 85) return "Extremo";
  if (score >= 70) return "Muy alto";
  if (score >= 50) return "Alto";
  if (score >= 30) return "Moderado";
  return "Bajo";
}

function bucketForScore(score) {
  if (score >= 85) return "extreme";
  if (score >= 50) return "high";
  if (score >= 30) return "medium";
  return "low";
}

function levelForPersonalPressure(score) {
  if (score >= 85) return "Extrema";
  if (score >= 70) return "Muy alta";
  if (score >= 50) return "Alta";
  if (score >= 36) return "Moderada";
  return "Baja";
}

function trendFrom(previousValue, currentValue, manualTrend) {
  if (manualTrend) return manualTrend;
  const delta = currentValue - previousValue;
  if (delta >= 4) return "sube";
  if (delta <= -4) return "baja";
  return "estable";
}

function variantIndex(seed, length) {
  if (!length) return 0;
  const text = String(seed || "");
  const value = Array.from(text).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return value % length;
}

function chooseVariant(seed, variants) {
  return variants[variantIndex(seed, variants.length)];
}

function externalById(indices = []) {
  return new Map(indices.filter((item) => item && item.categoria !== "personal").map((item) => [item.id, item]));
}

function weightedScore(itemsById, weights, fallback = 50) {
  let total = 0;
  let weightTotal = 0;

  for (const [id, weight] of Object.entries(weights)) {
    const item = itemsById.get(id);
    if (!item) continue;
    total += clamp(item.valor, 0, 100) * weight;
    weightTotal += weight;
  }

  return weightTotal ? total / weightTotal : fallback;
}

function pressureAdjustment(externalIndices) {
  const byId = externalById(externalIndices);
  const worldPressure = weightedScore(byId, {
    igp: 1.25,
    ieg: 0.85,
    iecv: 1,
    icsl: 0.75,
    imf: 1,
    icsp: 0.85,
    ics: 0.65,
    isfl: 1.45
  });

  const shock =
    Math.max(0, (clamp(byId.get("igp")?.valor) - 70) / 6) +
    Math.max(0, (clamp(byId.get("iecv")?.valor) - 65) / 7) +
    Math.max(0, (clamp(byId.get("imf")?.valor) - 65) / 7) +
    Math.max(0, (clamp(byId.get("isfl")?.valor) - 35) / 5) +
    Math.max(0, (clamp(byId.get("icsp")?.valor) - 68) / 8);

  const calmCredit = worldPressure < 45 ? -2 : worldPressure < 52 ? -1 : 0;
  return clamp(((worldPressure - 50) / 5) + shock + calmCredit, -3, 14);
}

function advantageAdjustment(externalIndices, adjustedIpp) {
  const byId = externalById(externalIndices);
  const needForCriterion = weightedScore(byId, {
    igp: 1.15,
    ieg: 0.95,
    iecv: 0.8,
    imf: 1,
    icsp: 1.05,
    ics: 0.75,
    icsl: 0.65,
    isfl: 0.45
  });
  const scores = [...byId.values()].map((item) => clamp(item.valor));
  const top = scores.length ? Math.max(...scores) : needForCriterion;
  const dispersion = scores.length ? Math.max(...scores) - Math.min(...scores) : 0;
  const opportunity =
    ((needForCriterion - 50) / 7) +
    Math.max(0, (top - 65) / 8) +
    Math.max(0, (dispersion - 22) / 12);
  const pressureDrag = Math.max(0, (adjustedIpp - 42) / 4);

  return clamp(opportunity - pressureDrag, -4, 10);
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function buildGdeltUrl(query, config) {
  const params = new URLSearchParams({
    query,
    mode: "ArtList",
    format: "json",
    maxrecords: String(config.sourcePolicy.maxRecordsPerQuery || 20),
    timespan: config.sourcePolicy.lookback || "1d",
    sort: "hybridrel"
  });
  return `https://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`;
}

async function fetchArticles(queryDef, config) {
  if (offline) return [];

  const url = buildGdeltUrl(queryDef.query, config);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "JISR-Global-Personal-Agent/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`GDELT ${response.status}`);
    }

    const payload = await response.json();
    return (payload.articles || []).map((article) => ({
      title: article.title || "",
      url: article.url || "",
      domain: article.domain || "",
      seenDate: article.seendate || "",
      source: queryDef.label,
      weight: Number(queryDef.weight || 1)
    }));
  } catch (error) {
    return [{
      title: `Fuente no disponible: ${queryDef.label}`,
      url,
      domain: "gdeltproject.org",
      seenDate: "",
      source: queryDef.label,
      weight: 0,
      error: error.message
    }];
  } finally {
    clearTimeout(timeout);
  }
}

function scoreArticles(indexConfig, previousValue, articles, config) {
  const validArticles = articles.filter((article) => !article.error);
  const errors = articles.filter((article) => article.error);
  const keywords = indexConfig.keywords || {};
  const policy = config.sourcePolicy || {};
  const minimumArticlesForMovement = policy.minimumArticlesForMovement ?? 4;
  const maxLowEvidenceMove = policy.maxLowEvidenceMove ?? 1;
  const smoothing = policy.smoothing || {};
  const normalNewSignalWeight = smoothing.newSignalWeight ?? 0.3;
  const shockNewSignalWeight = smoothing.shockNewSignalWeight ?? 0.45;
  const shockDelta = smoothing.shockDelta ?? 18;

  let pressure = 0;
  let relief = 0;

  for (const article of validArticles) {
    const text = `${article.title} ${article.domain} ${article.source}`;
    const high = countMatches(text, keywords.high);
    const medium = countMatches(text, keywords.medium);
    const down = countMatches(text, keywords.down);
    pressure += article.weight * ((high * 6) + (medium * 3));
    relief += article.weight * (down * 5);
  }

  const volume = Math.min(18, validArticles.length * 1.2);
  const raw = clamp((indexConfig.base || previousValue || 50) + volume + pressure - relief);
  const distinctDomains = new Set(validArticles.map((article) => article.domain).filter(Boolean)).size;
  const confidence = Number(Math.min(
    0.9,
    Math.max(0.35, 0.35 + (validArticles.length / 45) + (distinctDomains / 70) - (errors.length * 0.04))
  ).toFixed(2));

  if (validArticles.length < minimumArticlesForMovement) {
    const baseline = clamp(indexConfig.base ?? previousValue ?? 50);
    const drift = clamp(baseline - previousValue, -maxLowEvidenceMove, maxLowEvidenceMove);
    return {
      value: clamp(previousValue + drift),
      confidence: Math.min(confidence, 0.42),
      validArticles,
      errors,
      pressure,
      relief,
      raw,
      movementMode: "baja_evidencia"
    };
  }

  const signalDelta = Math.abs(raw - previousValue);
  const acuteSignal = signalDelta >= shockDelta || pressure >= 24 || relief >= 18;
  const newSignalWeight = acuteSignal ? shockNewSignalWeight : normalNewSignalWeight;
  const current = clamp((previousValue * (1 - newSignalWeight)) + (raw * newSignalWeight));

  return {
    value: current,
    confidence,
    validArticles,
    errors,
    pressure,
    relief,
    raw,
    movementMode: acuteSignal ? "shock_amortiguado" : "amortiguado"
  };
}

function chooseEvidence(articles) {
  return articles
    .filter((article) => !article.error && article.title)
    .slice(0, 5)
    .map((article) => ({
      titulo: article.title,
      fuente: article.domain || article.source,
      url: article.url,
      fecha: article.seenDate
    }));
}

function readingFor(indexConfig, score, trend, evidence, runDate) {
  const firstSignal = evidence[0]?.titulo;
  const seed = `${runDate.toISOString().slice(0, 13)}:${indexConfig.id}:${score}:${trend}`;

  if (score >= 85) {
    if (firstSignal) return `Tensión extrema. La señal dominante viene de: ${firstSignal}`;
    return chooseVariant(seed, [
      "Tensión extrema. El conjunto de señales exige máxima prudencia.",
      "Tensión extrema. El tablero entra en zona de error caro y margen estrecho.",
      "Tensión extrema. La prioridad es reducir exposición a decisiones frágiles."
    ]);
  }

  if (score >= 70) {
    return chooseVariant(seed, [
      `Muy alto. El entorno sigue cargado y la tendencia ${trend === "baja" ? "afloja solo parcialmente" : "no permite relajarse"}.`,
      "Muy alto. La señal no obliga a pánico, pero sí a decisiones con doble fondo.",
      "Muy alto. La normalidad funciona, aunque con menos margen del que aparenta."
    ]);
  }

  if (score >= 50) {
    return chooseVariant(seed, [
      "Alto. Hay fricción suficiente para condicionar decisiones, aunque sin ruptura general del sistema.",
      "Alto. El sistema sigue operativo, pero cada decisión exige más filtro.",
      "Alto. No hay ruptura clara, pero sí coste creciente de equivocarse."
    ]);
  }

  if (score >= 30) {
    return chooseVariant(seed, [
      "Moderado. El riesgo existe, pero todavía permite decidir con margen y sin urgencia artificial.",
      "Moderado. Conviene observar, no acelerar.",
      "Moderado. La señal pide atención, pero no altera todavía la arquitectura general."
    ]);
  }

  return chooseVariant(seed, [
    "Bajo. La señal aparece contenida; conviene observar sin sobreactuar.",
    "Bajo. El entorno permite ordenar criterio antes de actuar.",
    "Bajo. No desaparece el riesgo, pero hoy no exige protagonismo."
  ]);
}

function signalFor(indexConfig, evidence, errors) {
  if (evidence.length) {
    return evidence.slice(0, 3).map((item) => item.titulo).join(" | ");
  }

  if (errors.length) {
    return "Fuentes públicas parcialmente no disponibles; se mantiene lectura prudente con datos anteriores.";
  }

  return "Pocas señales nuevas en fuentes abiertas durante la ventana analizada.";
}

function buildHeadline(indices, runDate) {
  const nonPersonal = indices.filter((item) => item.categoria !== "personal");
  const average = Math.round(nonPersonal.reduce((sum, item) => sum + item.valor, 0) / Math.max(1, nonPersonal.length));
  const top = nonPersonal.reduce((current, item) => (item.valor > current.valor ? item : current), nonPersonal[0]);
  const seed = `${runDate.toISOString().slice(0, 13)}:${average}:${top?.id}:${top?.valor}`;

  if (!top) return "Tablero de Índices JISR actualizado.";
  if (average >= 75) return chooseVariant(seed, [
    `Jornada de tensión alta: ${top.sigla} marca el centro del tablero.`,
    `El tablero se endurece: ${top.sigla} concentra la presión principal.`,
    `Día de margen estrecho: ${top.sigla} exige más prudencia que velocidad.`
  ]);
  if (average >= 60) return chooseVariant(seed, [
    "El mundo sigue caro, sensible y poco dispuesto a regalar margen.",
    "La jornada no rompe el tablero, pero encarece cada error.",
    "El entorno sigue funcionando, aunque con más fricción de la que conviene ignorar."
  ]);
  if (average >= 45) return chooseVariant(seed, [
    "La jornada permite decidir, pero no permite dormirse.",
    "El tablero sigue abierto: hay margen, pero no barra libre.",
    "Día de lectura sobria: decidir sí, precipitarse no."
  ]);
  return chooseVariant(seed, [
    "Ventana relativamente estable: buen momento para ordenar criterio.",
    "El entorno concede una pausa: conviene usarla para preparar decisiones.",
    "Menos ruido no significa riesgo cero, pero sí mejor momento para pensar."
  ]);
}

function buildGlobalReading(indices, runDate) {
  const nonPersonal = indices.filter((item) => item.categoria !== "personal");
  const sorted = [...nonPersonal].sort((a, b) => b.valor - a.valor);
  const top = sorted[0];
  const second = sorted[1];
  const ipp = indices.find((item) => item.id === "ipp") || indices.find((item) => item.id === "icp");
  const ive = indices.find((item) => item.id === "ive");
  const seed = `${runDate.toISOString().slice(0, 13)}:${top?.id}:${top?.valor}:${second?.id}:${second?.valor}:${ipp?.valor}:${ive?.valor}`;

  if (!top) return "La presión principal aparece contenida.";

  return chooseVariant(seed, [
    [
      `La presión principal viene de ${top.sigla} (${top.valor}).`,
      second ? `La segunda señal relevante es ${second.sigla} (${second.valor}).` : "",
      ipp && ive ? `Posición personal: IPP ${ipp.valor} e IVE ${ive.valor}; presión ${String(ipp.nivel || "contenida").toLowerCase()} y ventaja siguen siendo más importantes que velocidad.` : ""
    ].filter(Boolean).join(" "),
    [
      `${top.sigla} (${top.valor}) marca hoy el punto de mayor atención.`,
      second ? `${second.sigla} (${second.valor}) queda como presión secundaria.` : "",
      ipp && ive ? `Con IPP ${ipp.valor} e IVE ${ive.valor}, la lectura útil sigue siendo proteger margen y convertir criterio en ventaja.` : ""
    ].filter(Boolean).join(" "),
    [
      `El centro de gravedad está en ${top.sigla} (${top.valor}).`,
      second ? `${second.sigla} (${second.valor}) acompaña sin desplazar el foco principal.` : "",
      ipp && ive ? `La posición personal mantiene una presión ${String(ipp.nivel || "contenida").toLowerCase()} y una ventaja estratégica de ${ive.valor}.` : ""
    ].filter(Boolean).join(" ")
  ]);
}

function personalIndexFromProfile(indexConfig, profile, externalIndices = [], previous) {
  if (!profile || !indexConfig.manual) return null;

  if (indexConfig.id === "ipp" && profile.presion_personal_ipp) {
    const pressure = profile.presion_personal_ipp;
    const baseValue = clamp(pressure.valor_base ?? indexConfig.value);
    const adjustment = pressureAdjustment(externalIndices);
    const value = clamp(baseValue + adjustment);
    return {
      id: "ipp",
      sigla: "IPP",
      nombre: "Índice de Presión Personal",
      valor: value,
      nivel: levelForPersonalPressure(value),
      tendencia: trendFrom(clamp(previous?.valor ?? baseValue), value),
      confianza: 1,
      categoria: "personal",
      lectura: `${pressure.lectura || indexConfig.reading}. Ajuste exterior: ${adjustment >= 0 ? "+" : ""}${adjustment} puntos.`,
      senal: [
        (pressure.factores_que_reducen_presion || []).slice(0, 2).join(" | "),
        (pressure.factores_que_aumentan_presion || []).slice(0, 2).join(" | ")
      ].filter(Boolean).join(" | ") || indexConfig.signal,
      accion_jisr: "Proteger margen, salud, foco y estabilidad familiar antes de aumentar riesgo.",
      evidencia: [],
      motivo_cambio: `Base personal ${baseValue}; ajuste por contexto exterior ${adjustment >= 0 ? "+" : ""}${adjustment}.`
    };
  }

  if (indexConfig.id === "ive" && profile.ventaja_estrategica_ive) {
    const advantage = profile.ventaja_estrategica_ive;
    const baseValue = clamp(advantage.valor_base ?? indexConfig.value);
    const ippBase = clamp(profile.presion_personal_ipp?.valor_base ?? 28);
    const adjustedIpp = clamp(ippBase + pressureAdjustment(externalIndices));
    const adjustment = advantageAdjustment(externalIndices, adjustedIpp);
    const value = clamp(baseValue + adjustment);
    return {
      id: "ive",
      sigla: "IVE",
      nombre: "Índice de Ventaja Estratégica",
      valor: value,
      nivel: levelForScore(value),
      tendencia: trendFrom(clamp(previous?.valor ?? baseValue), value),
      confianza: 1,
      categoria: "personal",
      lectura: `${advantage.lectura || indexConfig.reading}. Ajuste exterior: ${adjustment >= 0 ? "+" : ""}${adjustment} puntos.`,
      senal: (advantage.diferenciadores || []).slice(0, 5).join(" | ") || indexConfig.signal,
      accion_jisr: "Convertir ventaja en prospección, producto y agenda profesional activa.",
      evidencia: [],
      motivo_cambio: `Base personal ${baseValue}; ajuste por necesidad exterior de criterio ${adjustment >= 0 ? "+" : ""}${adjustment}.`
    };
  }

  return null;
}

async function buildIndex(indexConfig, previousById, config, profile, currentIndices = [], runDate = new Date()) {
  const previous = previousById.get(indexConfig.id);

  if (indexConfig.manual) {
    const profileIndex = personalIndexFromProfile(indexConfig, profile, currentIndices, previous);
    if (profileIndex) return profileIndex;

    const value = clamp(indexConfig.value);
    return {
      id: indexConfig.id,
      sigla: indexConfig.sigla,
      nombre: indexConfig.nombre,
      valor: value,
      nivel: levelForScore(value, indexConfig.level),
      tendencia: indexConfig.trend || "estable",
      confianza: 1,
      categoria: indexConfig.categoria,
      lectura: indexConfig.reading,
      senal: indexConfig.signal,
      accion_jisr: indexConfig.action,
      evidencia: [],
      motivo_cambio: "Índice personal fijado por criterio manual."
    };
  }

  const previousValue = clamp(previous?.valor ?? indexConfig.base ?? 50);
  const articleGroups = await Promise.all((indexConfig.queries || []).map((queryDef) => fetchArticles(queryDef, config)));
  const articles = articleGroups.flat();
  const result = scoreArticles(indexConfig, previousValue, articles, config);
  const evidence = chooseEvidence(result.validArticles);
  const trend = trendFrom(previousValue, result.value);
  const bucket = bucketForScore(result.value);

  return {
    id: indexConfig.id,
    sigla: indexConfig.sigla,
    nombre: indexConfig.nombre,
    valor: result.value,
    nivel: levelForScore(result.value),
    tendencia: trend,
    confianza: result.confidence,
    categoria: indexConfig.categoria,
    lectura: readingFor(indexConfig, result.value, trend, evidence, runDate),
    senal: signalFor(indexConfig, evidence, result.errors),
    accion_jisr: indexConfig.actions?.[bucket] || "Observar sin sobrerreaccionar.",
    evidencia: evidence,
    motivo_cambio: `Lectura automática desde fuentes abiertas: ${result.validArticles.length} artículos útiles, ${result.errors.length} incidencias de fuente; modo ${result.movementMode}.`
  };
}

async function main() {
  const config = await readJson(configPath, null);
  if (!config) throw new Error("No se pudo leer jisr-agent-config.json");
  const profile = await readJson(profilePath, null);

  const dataPath = path.join(rootDir, config.dataFile);
  const previousData = await readJson(dataPath, { indices: [] });
  const previousById = new Map((previousData.indices || []).map((item) => [item.id, item]));

  const indices = [];
  const now = new Date();
  for (const indexConfig of config.indices) {
    indices.push(await buildIndex(indexConfig, previousById, config, profile, indices, now));
  }

  const output = {
    proyecto: config.project,
    version: "0.2",
    actualizado: now.toISOString(),
    timezone: config.timezone,
    modo_actualizacion: config.updateMode,
    escala: {
      min: config.scale.min,
      max: config.scale.max,
      lectura: config.scale.reading
    },
    titular: buildHeadline(indices, now),
    lectura_jisr: buildGlobalReading(indices, now),
    posicion_personal: {
      ipp: indices.find((item) => item.id === "ipp")?.valor ?? config.personalPosition.ipp ?? config.personalPosition.icp,
      ive: indices.find((item) => item.id === "ive")?.valor ?? config.personalPosition.ive,
      resumen: config.personalPosition.summary
    },
    perfil_personal_resumen: profile ? {
      actualizado: profile.actualizado,
      ubicacion_base: profile.ubicacion?.base,
      revision_recomendada: profile.revision_recomendada,
      privacidad: profile.privacidad?.nivel_detalle
    } : null,
    fuentes_resumen: {
      politica: config.sourcePolicy,
      total_evidencias: indices.reduce((sum, item) => sum + (item.evidencia || []).length, 0),
      nota: offline ? "Ejecución offline: no se consultaron fuentes externas." : "Fuentes abiertas consultadas mediante GDELT Doc API."
    },
    indices
  };

  const serialized = `${JSON.stringify(output, null, 2)}\n`;
  if (dryRun) {
    console.log(serialized);
    return;
  }

  await fs.writeFile(dataPath, serialized, "utf8");
  console.log(`JISR JSON actualizado: ${config.dataFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
