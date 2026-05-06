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
function round(v, d = 3) {
  const p = Math.pow(10, d);
  return Math.round(Number(v) * p) / p;
}

function safeNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
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

  // --------------------------------------------
  // COLLECTION
  // --------------------------------------------
  const dailyRef = db
    .collection("field_conditions_current")
    .doc(fieldId)
    .collection("daily");

  // --------------------------------------------
  // WEATHER ROWS USED IN MATH
  // --------------------------------------------
  const rows = Array.isArray(result.rows)
    ? result.rows
    : [];

  // --------------------------------------------
  // TRACE FROM SOIL MODEL
  // --------------------------------------------
  const trace = Array.isArray(result.trace)
    ? result.trace
    : [];

  // --------------------------------------------
  // MAP TRACE BY DATE
  // --------------------------------------------
  const traceMap = {};

  for (const t of trace) {
    if (!t?.dateISO) continue;
    traceMap[t.dateISO] = t;
  }

  // --------------------------------------------
  // BUILD DAILY DOCS
  // --------------------------------------------
  for (const row of rows) {
    const dateISO = row.dateISO;

    if (!dateISO) continue;

    const t = traceMap[dateISO] || {};

    // --------------------------------------------
    // RAIN SOURCE LOGIC
    // --------------------------------------------
    const isForecast =
      dateISO > new Date().toISOString().slice(0, 10);

    const rainOpenMeteoIn = safeNum(
      row.rainOpenMeteoIn ?? row.rainIn ?? 0,
      0
    );

    const rainMrmsIn = safeNum(
      row.rainMrmsIn,
      null
    );

    let rainUsedInMath = rainOpenMeteoIn;
    let rainSource = "open-meteo-forecast";

    // historical/today should use MRMS
    if (!isForecast) {
      if (Number.isFinite(rainMrmsIn)) {
        rainUsedInMath = rainMrmsIn;
        rainSource = "mrms";
      } else {
        rainUsedInMath = null;
        rainSource = "missing-mrms";
      }
    }

    // --------------------------------------------
    // BUILD HOURLY TRACE ENTRY
    // --------------------------------------------
    const hourlyEntry = {
      computedAt: admin.firestore.FieldValue.serverTimestamp(),

      // --------------------------------------------
      // WEATHER
      // --------------------------------------------
      tempF: safeNum(row.tempF),
      windMph: safeNum(row.windMph),
      rh: safeNum(row.rh),
      solarWm2: safeNum(row.solarWm2),

      sm010: safeNum(row.sm010),
      st010: safeNum(row.st010),

      // --------------------------------------------
      // RAINFALL
      // --------------------------------------------
      rainSource,

      rainMrmsIn,
      rainOpenMeteoIn,

      rainUsedInMath,

      // --------------------------------------------
      // DRY POWER BREAKDOWN
      // --------------------------------------------
      dryPwr: safeNum(t.dryPwr),

      tempN: safeNum(row.tempN),
      windN: safeNum(row.windN),
      rhN: safeNum(row.rhN),
      solarN: safeNum(row.solarN),

      vpd: safeNum(row.vpd),
      vpdN: safeNum(row.vpdN),

      cloud: safeNum(row.cloud),
      cloudN: safeNum(row.cloudN),

      dryRaw: safeNum(row.dryRaw),

      // --------------------------------------------
      // SOIL TRACE
      // --------------------------------------------
      storage: safeNum(t.storage),
      surface: safeNum(t.surface),

      rainEff: safeNum(t.rainEff),

      addRain: safeNum(t.addRain),
      surfaceAdd: safeNum(t.surfaceAdd),

      surfaceToSoil: safeNum(t.surfaceToSoil),

      loss: safeNum(t.loss),
      surfaceLoss: safeNum(t.surfaceLoss),

      surfacePenalty: safeNum(t.surfacePenalty)
    };

    // --------------------------------------------
    // DAILY DOC REF
    // --------------------------------------------
    const docRef = dailyRef.doc(dateISO);

    // --------------------------------------------
    // WRITE DAILY STRUCTURE
    // --------------------------------------------
    await docRef.set(
      {
        fieldId,
        fieldName: field.name || null,

        dateISO,

        updatedAt:
          admin.firestore.FieldValue.serverTimestamp(),

        // --------------------------------------------
        // FINAL DAILY SNAPSHOT
        // --------------------------------------------
        final: {
          readiness: safeNum(result.readiness),
          wetness: safeNum(result.wetness),

          storageFinal: safeNum(result.storageFinal),

          surfaceFinal: safeNum(
            result.surfaceStorageFinal
          )
        },

        // --------------------------------------------
        // FACTORS
        // --------------------------------------------
        factors: result.factors || {},

        // --------------------------------------------
        // DAILY WEATHER SUMMARY
        // --------------------------------------------
        weather: {
          rainSource,

          rainUsedInMath,

          rainMrmsIn,
          rainOpenMeteoIn,

          tempF: safeNum(row.tempF),
          windMph: safeNum(row.windMph),
          rh: safeNum(row.rh),

          solarWm2: safeNum(row.solarWm2),

          sm010: safeNum(row.sm010),
          st010: safeNum(row.st010)
        }
      },
      { merge: true }
    );

    // --------------------------------------------
    // APPEND HOURLY TRACE
    // --------------------------------------------
    await docRef.set(
      {
        hourly: admin.firestore.FieldValue.arrayUnion(
          hourlyEntry
        )
      },
      { merge: true }
    );
  }

  console.log(
    `🧠 Debug daily traces saved for ${field.name}`
  );
}

// --------------------------------------------
// EXPORT
// --------------------------------------------
module.exports = {
  writeDailyDebug
};