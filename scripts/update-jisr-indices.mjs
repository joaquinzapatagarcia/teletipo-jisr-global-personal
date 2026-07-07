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

function sameText(a, b) {
  return normalizeText(a).replace(/\s+/g, " ").trim() === normalizeText(b).replace(/\s+/g, " ").trim();
}

function chooseVariantAvoiding(seed, variants, previousText) {
  const cleanVariants = variants.filter(Boolean);
  if (!cleanVariants.length) return "";
  const firstChoice = chooseVariant(seed, cleanVariants);
  if (!previousText || !sameText(firstChoice, previousText)) return firstChoice;

  const alternatives = cleanVariants.filter((variant) => !sameText(variant, previousText));
  return alternatives.length ? chooseVariant(`${seed}:alt`, alternatives) : firstChoice;
}

function readingBucketForScore(score) {
  if (score >= 85) return "extreme";
  if (score >= 70) return "veryHigh";
  if (score >= 50) return "high";
  if (score >= 30) return "medium";
  return "low";
}

function trendTone(trend) {
  if (trend === "sube") return "la señal gana peso";
  if (trend === "baja") return "la presión afloja parcialmente";
  return "la señal se mantiene estable";
}

function truncateText(value, max = 150) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

const genericReadings = {
  extreme: [
    "Tensión extrema. La prioridad es reducir exposición, ganar tiempo y evitar decisiones irreversibles.",
    "Tensión extrema. El margen de error se estrecha y conviene actuar con máxima prudencia.",
    "Tensión extrema. La señal exige proteger caja, agenda y capacidad de retirada."
  ],
  veryHigh: [
    "Muy alto. No obliga al pánico, pero sí a decidir con más filtros y menos confianza automática.",
    "Muy alto. La normalidad sigue funcionando, aunque con menos margen del que aparenta.",
    "Muy alto. El tablero permite moverse, pero penaliza la precipitación."
  ],
  high: [
    "Alto. Hay fricción suficiente para condicionar decisiones, aunque sin ruptura general del sistema.",
    "Alto. El sistema sigue operativo, pero cada decisión exige más criterio.",
    "Alto. No hay ruptura clara, pero sí coste creciente de equivocarse."
  ],
  medium: [
    "Moderado. El riesgo existe, pero todavía permite decidir con margen.",
    "Moderado. Conviene observar sin acelerar artificialmente.",
    "Moderado. La señal pide atención, no una respuesta defensiva completa."
  ],
  low: [
    "Bajo. La señal aparece contenida; conviene observar sin sobreactuar.",
    "Bajo. El entorno permite ordenar criterio antes de actuar.",
    "Bajo. No desaparece el riesgo, pero hoy no exige protagonismo."
  ]
};

const indexReadings = {
  igp: {
    extreme: [
      "Tensión geopolítica extrema. Cualquier decisión expuesta a conflicto, sanciones o rutas críticas necesita margen adicional.",
      "Geopolítica en zona extrema. La prudencia vale más que la lectura lineal de titulares."
    ],
    veryHigh: [
      "Muy alto. La geopolítica no bloquea el tablero, pero reduce la fiabilidad de cualquier escenario cómodo.",
      "Muy alto. La diplomacia puede avanzar, pero el riesgo operativo sigue demasiado cerca."
    ],
    high: [
      "Alto. Hay fricción geopolítica suficiente para condicionar decisiones, aunque sin ruptura general.",
      "Alto. El riesgo político sigue presente y obliga a no confundir pausa con solución."
    ],
    medium: [
      "Moderado. La tensión geopolítica permite operar, pero no conviene bajar la guardia.",
      "Moderado. El tablero exterior no domina la jornada, aunque sigue reclamando vigilancia."
    ],
    low: [
      "Bajo. La presión geopolítica queda contenida en la ventana observada.",
      "Bajo. El ruido exterior cede espacio, pero no desaparece como variable de fondo."
    ]
  },
  ieg: {
    extreme: [
      "Tensión económica extrema. Liquidez, flexibilidad y prudencia pesan más que crecimiento.",
      "Economía en zona extrema. El riesgo no está solo en caer, sino en planificar como si nada hubiera cambiado."
    ],
    veryHigh: [
      "Muy alto. La economía resiste, pero el coste de equivocarse en ingresos, precios o deuda aumenta.",
      "Muy alto. El crecimiento puede seguir, pero con menos oxígeno y más dependencia de expectativas."
    ],
    high: [
      "Alto. El ciclo sigue vivo, aunque más caro, más desigual y menos tolerante al error.",
      "Alto. La actividad no se rompe, pero exige planes más reversibles."
    ],
    medium: [
      "Moderado. La economía permite avanzar, pero sin construir sobre optimismo fácil.",
      "Moderado. Hay margen de decisión si se separa inercia de fortaleza real."
    ],
    low: [
      "Bajo. La señal económica concede margen para ordenar prioridades.",
      "Bajo. La presión macro queda contenida, útil para preparar sin urgencia."
    ]
  },
  iecv: {
    extreme: [
      "Tensión extrema en energía y coste de vida. Conviene proteger caja y revisar supuestos de gasto.",
      "Energía y precios en zona extrema. El presupuesto manda más que el deseo."
    ],
    veryHigh: [
      "Muy alto. Energía y coste de vida siguen contaminando inflación, expectativas y decisiones domésticas.",
      "Muy alto. El precio de vivir y moverse sigue siendo una variable crítica."
    ],
    high: [
      "Alto. La energía y los precios no rompen el sistema, pero reducen margen familiar y empresarial.",
      "Alto. El coste de vida mantiene presión suficiente para condicionar decisiones."
    ],
    medium: [
      "Moderado. La presión de precios permite respirar, aunque no justificar descuido.",
      "Moderado. El coste de vida sigue presente, pero no domina por completo la lectura."
    ],
    low: [
      "Bajo. La presión de energía y precios aparece contenida.",
      "Bajo. Hay margen para planificar gasto sin convertirlo en alarma."
    ]
  },
  icsl: {
    extreme: [
      "Tensión logística extrema. Disponibilidad, plazos y rutas pasan a ser parte central del riesgo.",
      "Suministro en zona extrema. Prometer tiempos o costes fijos resulta peligroso."
    ],
    veryHigh: [
      "Muy alto. La logística funciona, pero vulnerable a rutas, seguros y retrasos.",
      "Muy alto. Las cadenas siguen abiertas, aunque con fragilidad suficiente para exigir redundancia."
    ],
    high: [
      "Alto. La cadena funciona, pero no como una autopista limpia y barata.",
      "Alto. La fricción logística sigue siendo coste real, no solo ruido operativo."
    ],
    medium: [
      "Moderado. La logística permite operar, con vigilancia sobre plazos y disponibilidad.",
      "Moderado. El suministro no domina, pero conviene no prometer como si fuera estable."
    ],
    low: [
      "Bajo. Las señales logísticas aparecen manejables.",
      "Bajo. La normalidad de suministro concede margen para ordenar inventario y calendario."
    ]
  },
  imf: {
    extreme: [
      "Tensión monetario-financiera extrema. Deuda, liquidez y vencimientos requieren defensa.",
      "Finanzas en zona extrema. El precio del dinero puede convertir errores pequeños en problemas grandes."
    ],
    veryHigh: [
      "Muy alto. Tipos, liquidez y crédito siguen condicionando cualquier plan apalancado.",
      "Muy alto. El mercado permite actuar, pero castiga exceso de confianza financiera."
    ],
    high: [
      "Alto. Las condiciones financieras siguen tensas y obligan a cuidar deuda y liquidez.",
      "Alto. El dinero no está barato; cada compromiso financiero merece doble lectura."
    ],
    medium: [
      "Moderado. La presión financiera permite margen, pero no barra libre de deuda.",
      "Moderado. Conviene revisar plazos, caja y exposición sin sobreactuar."
    ],
    low: [
      "Bajo. La señal financiera aparece contenida y permite ordenar estructura.",
      "Bajo. Buen momento para mejorar liquidez antes de que vuelva la presión."
    ]
  },
  icsp: {
    extreme: [
      "Clima social extremo. Reputación, seguridad y prudencia comunicativa pasan al primer plano.",
      "Tensión social extrema. La paciencia colectiva se estrecha y amplifica errores."
    ],
    veryHigh: [
      "Muy alto. El cansancio social no bloquea el día, pero reduce tolerancia a malas decisiones.",
      "Muy alto. La sociedad funciona, aunque con irritabilidad de fondo."
    ],
    high: [
      "Alto. Hay malestar suficiente para no depender de un entorno paciente.",
      "Alto. La estabilidad aparente necesita una segunda lectura."
    ],
    medium: [
      "Moderado. El clima social pide atención, no dramatización.",
      "Moderado. Hay ruido social, pero todavía permite lectura fría."
    ],
    low: [
      "Bajo. La presión social aparece contenida.",
      "Bajo. El entorno social concede margen para comunicar y decidir con calma."
    ]
  },
  ics: {
    extreme: [
      "Ciberseguridad en zona extrema. Accesos, copias y cuentas críticas requieren revisión inmediata.",
      "Tensión digital extrema. La seguridad deja de ser técnica y pasa a ser operativa."
    ],
    veryHigh: [
      "Muy alto. La amenaza digital sigue cerca de empresas, identidad y vida doméstica.",
      "Muy alto. El riesgo ciber no se ve, pero puede afectar caja, reputación y continuidad."
    ],
    high: [
      "Alto. La higiene digital sigue siendo seguridad familiar y empresarial básica.",
      "Alto. El riesgo digital no domina la portada, pero puede romper el día."
    ],
    medium: [
      "Moderado. Conviene revisar hábitos digitales sin convertirlo en alarma.",
      "Moderado. La señal ciber pide disciplina básica y continuidad."
    ],
    low: [
      "Bajo. La presión digital aparece contenida, pero exige mantenimiento.",
      "Bajo. Buen momento para reforzar accesos y copias sin urgencia."
    ]
  },
  isfl: {
    extreme: [
      "Seguridad familiar en zona extrema. Salud, liquidez y ubicación pasan por delante de cualquier ambición.",
      "Tensión familiar-local extrema. La prioridad es reducir exposición doméstica."
    ],
    veryHigh: [
      "Muy alto. El entorno local o familiar exige prudencia adicional en gasto, agenda y desplazamientos.",
      "Muy alto. La vida cotidiana sigue, pero con menos margen doméstico."
    ],
    high: [
      "Alto. El riesgo local no es necesariamente físico, pero sí puede ser económico y mental.",
      "Alto. La seguridad familiar depende de caja, rutinas y decisiones reversibles."
    ],
    medium: [
      "Moderado. La situación familiar permite margen, con atención al coste de vida y rutinas.",
      "Moderado. Hay estabilidad básica, pero conviene no gastar margen doméstico."
    ],
    low: [
      "Bajo. La base familiar y local aparece estable.",
      "Bajo. El entorno doméstico permite operar con calma y foco."
    ]
  }
};

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

function sourceLineForEvidence(evidence, errors) {
  if (evidence.length) {
    const titles = evidence.slice(0, 2).map((item) => truncateText(item.titulo, 110));
    return `Señales destacadas: ${titles.join(" | ")}`;
  }

  if (errors.length) {
    return "Señales observadas en fuentes abiertas vía GDELT, con incidencias parciales de consulta.";
  }

  return "Señales observadas en fuentes abiertas vía GDELT.";
}

function dominantSource(articles = []) {
  const counts = new Map();
  for (const article of articles.filter((item) => !item.error)) {
    const key = article.source || article.domain || "fuentes abiertas";
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "fuentes abiertas";
}

function motiveForExternal(indexConfig, result, trend) {
  const useful = result.validArticles.length;
  const incidents = result.errors.length;
  const source = dominantSource(result.validArticles);
  const parts = useful
    ? [`${useful} señales útiles detectadas`, `fuente dominante: ${source}`, trendTone(trend)]
    : ["Sin señales útiles nuevas suficientes", trendTone(trend)];

  if (incidents) parts.push(`${incidents} incidencias de fuente`);
  if (result.movementMode === "baja_evidencia") parts.push("movimiento limitado por baja evidencia");
  if (result.movementMode === "shock_amortiguado") parts.push("señal fuerte amortiguada por prudencia");

  return parts.join("; ");
}

function topExternalIndex(externalIndices = []) {
  const items = externalIndices.filter((item) => item && item.categoria !== "personal");
  return items.sort((a, b) => clamp(b.valor) - clamp(a.valor))[0];
}

function motiveForPersonal(id, baseValue, adjustment, externalIndices) {
  const top = topExternalIndex(externalIndices);
  const signed = `${adjustment >= 0 ? "+" : ""}${adjustment}`;

  if (id === "ipp") {
    return top
      ? `Base personal ${baseValue}; ajuste exterior ${signed}; presión externa principal en ${top.sigla} (${top.valor}).`
      : `Base personal ${baseValue}; ajuste exterior ${signed}; sin presión externa dominante.`;
  }

  return top
    ? `Base personal ${baseValue}; ajuste exterior ${signed}; la necesidad de criterio aumenta con ${top.sigla} (${top.valor}).`
    : `Base personal ${baseValue}; ajuste exterior ${signed}; ventaja sostenida por perfil propio.`;
}

function sourceLineForPersonal() {
  return "Perfil personal estable y señales exteriores abiertas vía GDELT.";
}

function personalReadingFor(id, baseText, value, trend, adjustment, runDate, previousText) {
  const signed = `${adjustment >= 0 ? "+" : ""}${adjustment}`;
  const bucket = readingBucketForScore(value);
  const seed = `${runDate.toISOString().slice(0, 13)}:${id}:${value}:${trend}:${adjustment}`;

  if (id === "ipp") {
    return chooseVariantAvoiding(seed, [
      `${baseText}. Ajuste exterior: ${signed} puntos; la presión sigue condicionada por el entorno, no por urgencia propia.`,
      `${baseText}. El contexto añade ${signed} puntos, pero el margen personal continúa siendo la primera defensa.`,
      `${levelForPersonalPressure(value)}. La base personal sostiene margen; ${trendTone(trend)} y el ajuste exterior queda en ${signed} puntos.`,
      ...(genericReadings[bucket] || []).map((text) => `${text} En clave personal, el ajuste exterior es ${signed} puntos.`)
    ], previousText);
  }

  return chooseVariantAvoiding(seed, [
    `${baseText}. Ajuste exterior: ${signed} puntos; cuanto más ruido exige criterio, más valor tiene la sobriedad.`,
    `${baseText}. El contexto añade ${signed} puntos a la ventaja porque aumenta la demanda de lectura y orientación.`,
    `${levelForScore(value)}. La ventaja estratégica se mantiene apoyada en criterio, relato y capacidad de convertir incertidumbre en servicio.`,
    ...(genericReadings[bucket] || []).map((text) => `${text} En clave estratégica, el ajuste exterior es ${signed} puntos.`)
  ], previousText);
}

function readingFor(indexConfig, score, trend, evidence, runDate, previousText) {
  const firstSignal = evidence[0]?.titulo;
  const seed = `${runDate.toISOString().slice(0, 13)}:${indexConfig.id}:${score}:${trend}`;
  const bucket = readingBucketForScore(score);
  const indexVariants = indexReadings[indexConfig.id]?.[bucket] || [];
  const genericVariants = genericReadings[bucket] || [];
  const baseVariants = indexVariants.length ? indexVariants : genericVariants;
  const trendSuffix = trend === "sube"
    ? ` ${indexConfig.sigla} gana peso y exige menos complacencia.`
    : trend === "baja"
      ? ` ${indexConfig.sigla} afloja, pero no desaparece como variable de decisión.`
      : "";
  const variants = baseVariants.map((text) => `${text}${trendSuffix}`);

  if (score >= 85) {
    if (firstSignal) return `Tensión extrema. La señal dominante viene de: ${firstSignal}`;
  }

  return chooseVariantAvoiding(seed, variants, previousText);
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

function buildHeadline(indices, runDate, previousText) {
  const nonPersonal = indices.filter((item) => item.categoria !== "personal");
  const average = Math.round(nonPersonal.reduce((sum, item) => sum + item.valor, 0) / Math.max(1, nonPersonal.length));
  const top = nonPersonal.reduce((current, item) => (item.valor > current.valor ? item : current), nonPersonal[0]);
  const seed = `${runDate.toISOString().slice(0, 13)}:${average}:${top?.id}:${top?.valor}`;

  if (!top) return "Tablero de Índices JISR actualizado.";
  if (average >= 75) return chooseVariantAvoiding(seed, [
    `Jornada de tensión alta: ${top.sigla} marca el centro del tablero.`,
    `El tablero se endurece: ${top.sigla} concentra la presión principal.`,
    `Día de margen estrecho: ${top.sigla} exige más prudencia que velocidad.`,
    `${top.sigla} domina una jornada donde el error cuesta más que la espera.`,
    `La presión vuelve a concentrarse: ${top.sigla} pide lectura fría.`
  ], previousText);
  if (average >= 60) return chooseVariantAvoiding(seed, [
    "El mundo sigue caro, sensible y poco dispuesto a regalar margen.",
    "La jornada no rompe el tablero, pero encarece cada error.",
    "El entorno sigue funcionando, aunque con más fricción de la que conviene ignorar.",
    `La presión sigue alta: ${top.sigla} marca el tono sin cerrar el tablero.`,
    "Día exigente: se puede avanzar, pero conviene medir mejor cada paso."
  ], previousText);
  if (average >= 45) return chooseVariantAvoiding(seed, [
    "La jornada permite decidir, pero no permite dormirse.",
    "El tablero sigue abierto: hay margen, pero no barra libre.",
    "Día de lectura sobria: decidir sí, precipitarse no.",
    `La presión global se modera, aunque ${top.sigla} conserva el foco.`,
    "Hay margen para pensar, siempre que la calma no se confunda con certeza."
  ], previousText);
  return chooseVariantAvoiding(seed, [
    "Ventana relativamente estable: buen momento para ordenar criterio.",
    "El entorno concede una pausa: conviene usarla para preparar decisiones.",
    "Menos ruido no significa riesgo cero, pero sí mejor momento para pensar.",
    "El tablero respira: toca convertir calma relativa en preparación.",
    "Jornada de menor presión: útil para revisar planes antes de volver a correr."
  ], previousText);
}

function buildGlobalReading(indices, runDate, previousText) {
  const nonPersonal = indices.filter((item) => item.categoria !== "personal");
  const sorted = [...nonPersonal].sort((a, b) => b.valor - a.valor);
  const top = sorted[0];
  const second = sorted[1];
  const ipp = indices.find((item) => item.id === "ipp") || indices.find((item) => item.id === "icp");
  const ive = indices.find((item) => item.id === "ive");
  const seed = `${runDate.toISOString().slice(0, 13)}:${top?.id}:${top?.valor}:${second?.id}:${second?.valor}:${ipp?.valor}:${ive?.valor}`;

  if (!top) return "La presión principal aparece contenida.";

  return chooseVariantAvoiding(seed, [
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
    ].filter(Boolean).join(" "),
    [
      `La lectura del día se ordena alrededor de ${top.sigla} (${top.valor}).`,
      second ? `${second.sigla} (${second.valor}) confirma que la presión no viene de un solo frente.` : "",
      ipp && ive ? `El punto práctico sigue siendo sostener IPP ${ipp.valor} y convertir IVE ${ive.valor} en decisiones útiles.` : ""
    ].filter(Boolean).join(" "),
    [
      `${top.sigla} (${top.valor}) marca el riesgo dominante sin anular el resto del tablero.`,
      second ? `La segunda referencia es ${second.sigla} (${second.valor}), suficiente para no bajar el filtro.` : "",
      ipp && ive ? `Con presión personal ${String(ipp.nivel || "contenida").toLowerCase()} y ventaja ${String(ive.nivel || "alta").toLowerCase()}, el criterio pesa más que la reacción.` : ""
    ].filter(Boolean).join(" ")
  ], previousText);
}

function personalIndexFromProfile(indexConfig, profile, externalIndices = [], previous, runDate = new Date()) {
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
      lectura: personalReadingFor("ipp", pressure.lectura || indexConfig.reading, value, trendFrom(clamp(previous?.valor ?? baseValue), value), adjustment, runDate, previous?.lectura),
      senal: [
        (pressure.factores_que_reducen_presion || []).slice(0, 2).join(" | "),
        (pressure.factores_que_aumentan_presion || []).slice(0, 2).join(" | ")
      ].filter(Boolean).join(" | ") || indexConfig.signal,
      accion_jisr: "Proteger margen, salud, foco y estabilidad familiar antes de aumentar riesgo.",
      evidencia: [],
      motivo_dia: motiveForPersonal("ipp", baseValue, adjustment, externalIndices),
      fuentes_linea: sourceLineForPersonal(),
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
      lectura: personalReadingFor("ive", advantage.lectura || indexConfig.reading, value, trendFrom(clamp(previous?.valor ?? baseValue), value), adjustment, runDate, previous?.lectura),
      senal: (advantage.diferenciadores || []).slice(0, 5).join(" | ") || indexConfig.signal,
      accion_jisr: "Convertir ventaja en prospección, producto y agenda profesional activa.",
      evidencia: [],
      motivo_dia: motiveForPersonal("ive", baseValue, adjustment, externalIndices),
      fuentes_linea: sourceLineForPersonal(),
      motivo_cambio: `Base personal ${baseValue}; ajuste por necesidad exterior de criterio ${adjustment >= 0 ? "+" : ""}${adjustment}.`
    };
  }

  return null;
}

async function buildIndex(indexConfig, previousById, config, profile, currentIndices = [], runDate = new Date()) {
  const previous = previousById.get(indexConfig.id);

  if (indexConfig.manual) {
    const profileIndex = personalIndexFromProfile(indexConfig, profile, currentIndices, previous, runDate);
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
      motivo_dia: "Índice personal fijado por criterio manual; sin variación exterior aplicada.",
      fuentes_linea: "Perfil personal estable; sin señales externas aplicadas a este índice.",
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
    lectura: readingFor(indexConfig, result.value, trend, evidence, runDate, previous?.lectura),
    senal: signalFor(indexConfig, evidence, result.errors),
    accion_jisr: indexConfig.actions?.[bucket] || "Observar sin sobrerreaccionar.",
    evidencia: evidence,
    motivo_dia: motiveForExternal(indexConfig, result, trend),
    fuentes_linea: sourceLineForEvidence(evidence, result.errors),
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
    titular: buildHeadline(indices, now, previousData.titular),
    lectura_jisr: buildGlobalReading(indices, now, previousData.lectura_jisr),
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
      nota: offline ? "Ejecución offline: no se consultaron fuentes externas." : "Fuentes abiertas consultadas mediante GDELT Doc API.",
      linea: offline ? "Lectura generada sin consulta externa en esta ejecución." : "Señales observadas en fuentes abiertas vía GDELT."
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
