// ============================================
// FILE: /js/daily-debug-writer.js
// PURPOSE:
// Save exact readiness math inputs + outputs
// into field_conditions_current daily subcollection
// ============================================

const admin = require("firebase-admin");

// --------------------------------------------
// HELPERS
// --------------------------------------------
function safeNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safeStr(v, fallback = null) {
  if (v === undefined || v === null) return fallback;
  const s = String(v);
  return s ? s : fallback;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function toISODate(v) {
  if (!v) return null;
  return String(v).slice(0, 10);
}

function buildTraceMap(trace) {
  const map = new Map();

  for (const t of Array.isArray(trace) ? trace : []) {
    const iso = toISODate(t?.dateISO);
    if (!iso) continue;
    map.set(iso, t);
  }

  return map;
}

// --------------------------------------------
// MAIN WRITER
// --------------------------------------------
async function writeDailyDebug({
  db,
  field,
  result,
  wxDoc,
  mrmsDoc
}) {
  if (!db || !field || !result) {
    return;
  }

  const fieldId = field.id;
  const fieldName = field.name || null;
  const nowISO = new Date().toISOString();
  const today = todayISO();

  const rows = Array.isArray(result.rows) ? result.rows : [];
  const trace = Array.isArray(result.trace) ? result.trace : [];
  const traceMap = buildTraceMap(trace);

  if (!rows.length) {
    console.log(`🧠 No debug rows to save for ${fieldName || fieldId}`);
    return;
  }

  const dailyRef = db
    .collection("field_conditions_current")
    .doc(fieldId)
    .collection("daily");

  const batch = db.batch();
  let writes = 0;

  for (const row of rows) {
    const dateISO = toISODate(row?.dateISO);
    if (!dateISO) continue;

    const t = traceMap.get(dateISO) || {};
    const isForecast = dateISO > today;

    const rainOpenMeteoIn = safeNum(
      row.rainOpenMeteoIn ?? row.rainIn ?? 0,
      0
    );

    const rainMrmsIn = safeNum(row.rainMrmsIn, null);

    let rainUsedInMath = rainOpenMeteoIn;
    let rainSource = isForecast ? "open-meteo-forecast" : "missing-mrms";

    if (!isForecast && Number.isFinite(rainMrmsIn)) {
      rainUsedInMath = rainMrmsIn;
      rainSource = "mrms";
    }

    const dailyWeather = {
      rainSource,
      rainUsedInMath,
      rainMrmsIn,
      rainOpenMeteoIn,

      tempF: safeNum(row.tempF),
      windMph: safeNum(row.windMph),
      rh: safeNum(row.rh),
      solarWm2: safeNum(row.solarWm2),

      et0In: safeNum(row.et0In),
      sm010: safeNum(row.sm010),
      st010: safeNum(row.st010),

      vpd: safeNum(row.vpd),
      vpdN: safeNum(row.vpdN),
      cloud: safeNum(row.cloud),
      cloudN: safeNum(row.cloudN)
    };

const dryPwrBreakdown = {
  temp: safeNum(t.temp ?? row.tempF),
  tempN: safeNum(t.tempN),

  wind: safeNum(t.wind ?? row.windMph),
  windN: safeNum(t.windN),

  rh: safeNum(t.rh ?? row.rh),
  rhN: safeNum(t.rhN),

  solar: safeNum(t.solar ?? row.solarWm2),
  solarN: safeNum(t.solarN),

  vpd: safeNum(t.vpd),
  vpdN: safeNum(t.vpdN),

  cloud: safeNum(t.cloud),
  cloudN: safeNum(t.cloudN),

  raw: safeNum(t.raw),
  dryPwr: safeNum(t.dryPwr ?? row.dryPwr)
};

    const modelTrace = {
      storage: safeNum(t.storage),
      surface: safeNum(t.surface),

      rain: safeNum(t.rain ?? rainUsedInMath),
      rainEff: safeNum(t.rainEff),

      addRain: safeNum(t.addRain),
      surfaceAdd: safeNum(t.surfaceAdd),
      surfaceToSoil: safeNum(t.surfaceToSoil),

      loss: safeNum(t.loss),
      surfaceLoss: safeNum(t.surfaceLoss),

      surfacePenalty: safeNum(t.surfacePenalty)
    };

    const docRef = dailyRef.doc(dateISO);

    batch.set(
      docRef,
      {
        fieldId,
        fieldName,

        dateISO,

        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtISO: nowISO,

        weather: dailyWeather,
        dryPwrBreakdown,
        trace: modelTrace,

        factors: result.factors || {},

        final: {
          readiness: safeNum(result.readiness),
          wetness: safeNum(result.wetness),
          baseReadiness: safeNum(result.baseReadiness),
          surfacePenalty: safeNum(result.surfacePenalty),

          storageFinal: safeNum(result.storageFinal),
          storageForReadiness: safeNum(result.storageForReadiness),
          surfaceFinal: safeNum(result.surfaceStorageFinal)
        },

        debug: {
          source: "daily-debug-writer",
          rainRule: isForecast
            ? "forecast uses Open-Meteo rainfall"
            : "history/today uses MRMS rainfall",
          modelVersion: safeStr(result?.debug?.modelVersion),
          seedMode: safeStr(result?.debug?.seedMode)
        }
      },
      { merge: true }
    );

    writes++;
  }

  if (writes > 0) {
    await batch.commit();
  }

  console.log(
    `🧠 Debug daily docs saved for ${fieldName || fieldId}: ${writes}`
  );
}

// --------------------------------------------
// EXPORT
// --------------------------------------------
module.exports = {
  writeDailyDebug
};
