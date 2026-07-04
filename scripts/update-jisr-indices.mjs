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

function trendFrom(previousValue, currentValue, manualTrend) {
  if (manualTrend) return manualTrend;
  const delta = currentValue - previousValue;
  if (delta >= 4) return "sube";
  if (delta <= -4) return "baja";
  return "estable";
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

function scoreArticles(indexConfig, previousValue, articles) {
  const validArticles = articles.filter((article) => !article.error);
  const errors = articles.filter((article) => article.error);
  const keywords = indexConfig.keywords || {};

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
  const current = clamp((previousValue * 0.45) + (raw * 0.55));
  const distinctDomains = new Set(validArticles.map((article) => article.domain).filter(Boolean)).size;
  const confidence = Math.min(
    0.9,
    Math.max(0.35, 0.35 + (validArticles.length / 45) + (distinctDomains / 70) - (errors.length * 0.04))
  );

  return {
    value: current,
    confidence: Number(confidence.toFixed(2)),
    validArticles,
    errors,
    pressure,
    relief
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

function readingFor(indexConfig, score, trend, evidence) {
  const level = levelForScore(score);
  const firstSignal = evidence[0]?.titulo;

  if (score >= 85) {
    return `Tension extrema. ${firstSignal ? `La senal dominante viene de: ${firstSignal}` : "El conjunto de senales exige maxima prudencia."}`;
  }

  if (score >= 70) {
    return `Muy alto. El entorno sigue cargado y la tendencia ${trend === "baja" ? "afloja solo parcialmente" : "no permite relajarse"}.`;
  }

  if (score >= 50) {
    return `Alto. Hay friccion suficiente para condicionar decisiones, aunque sin ruptura general del sistema.`;
  }

  if (score >= 30) {
    return `Moderado. El riesgo existe, pero todavia permite decidir con margen y sin urgencia artificial.`;
  }

  return `Bajo. La senal aparece contenida; conviene observar sin sobreactuar.`;
}

function signalFor(indexConfig, evidence, errors) {
  if (evidence.length) {
    return evidence.slice(0, 3).map((item) => item.titulo).join(" | ");
  }

  if (errors.length) {
    return "Fuentes publicas parcialmente no disponibles; se mantiene lectura prudente con datos anteriores.";
  }

  return "Pocas senales nuevas en fuentes abiertas durante la ventana analizada.";
}

function buildHeadline(indices) {
  const nonPersonal = indices.filter((item) => item.categoria !== "personal");
  const average = Math.round(nonPersonal.reduce((sum, item) => sum + item.valor, 0) / Math.max(1, nonPersonal.length));
  const top = nonPersonal.reduce((current, item) => (item.valor > current.valor ? item : current), nonPersonal[0]);

  if (!top) return "Tablero de Indices JISR actualizado.";
  if (average >= 75) return `Jornada de tension alta: ${top.sigla} marca el centro del tablero.`;
  if (average >= 60) return `El mundo sigue caro, sensible y poco dispuesto a regalar margen.`;
  if (average >= 45) return `La jornada permite decidir, pero no permite dormirse.`;
  return `Ventana relativamente estable: buen momento para ordenar criterio.`;
}

function buildGlobalReading(indices) {
  const nonPersonal = indices.filter((item) => item.categoria !== "personal");
  const sorted = [...nonPersonal].sort((a, b) => b.valor - a.valor);
  const top = sorted[0];
  const second = sorted[1];
  const ipp = indices.find((item) => item.id === "ipp") || indices.find((item) => item.id === "icp");
  const ive = indices.find((item) => item.id === "ive");

  return [
    top ? `La presion principal viene de ${top.sigla} (${top.valor}).` : "La presion principal aparece contenida.",
    second ? `La segunda senal relevante es ${second.sigla} (${second.valor}).` : "",
    ipp && ive ? `Posicion personal: IPP ${ipp.valor} e IVE ${ive.valor}; presion baja y ventaja siguen siendo mas importantes que velocidad.` : ""
  ].filter(Boolean).join(" ");
}

function personalIndexFromProfile(indexConfig, profile) {
  if (!profile || !indexConfig.manual) return null;

  if (indexConfig.id === "ipp" && profile.presion_personal_ipp) {
    const pressure = profile.presion_personal_ipp;
    return {
      id: "ipp",
      sigla: "IPP",
      nombre: "Indice de Presion Personal",
      valor: clamp(pressure.valor_base ?? indexConfig.value),
      nivel: pressure.valor_base <= 30 ? "Baja" : levelForScore(pressure.valor_base, indexConfig.level),
      tendencia: indexConfig.trend || "estable",
      confianza: 1,
      categoria: "personal",
      lectura: pressure.lectura || indexConfig.reading,
      senal: (pressure.factores_que_reducen_presion || []).slice(0, 3).join(" | ") || indexConfig.signal,
      accion_jisr: "Proteger margen, salud, foco y estabilidad familiar antes de aumentar riesgo.",
      evidencia: [],
      motivo_cambio: "Indice calculado desde jisr-personal-profile.json."
    };
  }

  if (indexConfig.id === "ive" && profile.ventaja_estrategica_ive) {
    const advantage = profile.ventaja_estrategica_ive;
    return {
      id: "ive",
      sigla: "IVE",
      nombre: "Indice de Ventaja Estrategica",
      valor: clamp(advantage.valor_base ?? indexConfig.value),
      nivel: levelForScore(advantage.valor_base, indexConfig.level),
      tendencia: indexConfig.trend || "sube",
      confianza: 1,
      categoria: "personal",
      lectura: advantage.lectura || indexConfig.reading,
      senal: (advantage.diferenciadores || []).slice(0, 5).join(" | ") || indexConfig.signal,
      accion_jisr: "Convertir ventaja en prospeccion, producto y agenda profesional activa.",
      evidencia: [],
      motivo_cambio: "Indice calculado desde jisr-personal-profile.json."
    };
  }

  return null;
}

async function buildIndex(indexConfig, previousById, config, profile) {
  const previous = previousById.get(indexConfig.id);

  if (indexConfig.manual) {
    const profileIndex = personalIndexFromProfile(indexConfig, profile);
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
      motivo_cambio: "Indice personal fijado por criterio manual."
    };
  }

  const previousValue = clamp(previous?.valor ?? indexConfig.base ?? 50);
  const articleGroups = await Promise.all((indexConfig.queries || []).map((queryDef) => fetchArticles(queryDef, config)));
  const articles = articleGroups.flat();
  const result = scoreArticles(indexConfig, previousValue, articles);
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
    lectura: readingFor(indexConfig, result.value, trend, evidence),
    senal: signalFor(indexConfig, evidence, result.errors),
    accion_jisr: indexConfig.actions?.[bucket] || "Observar sin sobrerreaccionar.",
    evidencia: evidence,
    motivo_cambio: `Lectura automatica desde fuentes abiertas: ${result.validArticles.length} articulos utiles, ${result.errors.length} incidencias de fuente.`
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
  for (const indexConfig of config.indices) {
    indices.push(await buildIndex(indexConfig, previousById, config, profile));
  }

  const now = new Date();
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
    titular: buildHeadline(indices),
    lectura_jisr: buildGlobalReading(indices),
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
      nota: offline ? "Ejecucion offline: no se consultaron fuentes externas." : "Fuentes abiertas consultadas mediante GDELT Doc API."
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
