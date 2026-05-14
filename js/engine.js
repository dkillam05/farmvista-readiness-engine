// ============================================
// FILE: /js/engine.js
// PURPOSE:
// Tie weather + MRMS + field settings into
// one final readiness result
//
// IMPORTANT CHANGE:
// ✅ CURRENT readiness now ONLY uses:
//    - historical rows
//    - today's live row
//
// ❌ Forecast rows NO LONGER affect:
//    - readiness
//    - soil moisture
//    - surface wetness
//
// Forecast rows should ONLY be used later
// by ETA / future projection logic.
//
// UPDATED:
// ✅ Returns BOTH readiness + readinessR
// ✅ Returns BOTH wetness + wetnessR
// ✅ Returns storagePhysFinal
// ✅ Returns surfaceFinal
// ✅ Fixes quickview preview normalization
// ============================================

const { mergeWeather } = require("./weather-merge");
const { runSoilModel } = require("./soil-model");
const { calculateReadiness } = require("./readiness");

// --------------------------------------------
// HELPERS
// --------------------------------------------
function round(v, d = 2) {
  const p = Math.pow(10, d);

  return Math.round(Number(v) * p) / p;
}

function getTodayISO() {
  return new Date()
    .toISOString()
    .slice(0, 10);
}

// --------------------------------------------
// MAIN ENGINE
// --------------------------------------------
function runReadinessEngine(
  wxDoc,
  mrmsDoc,
  fieldDoc,
  opts = {}
) {

  // --------------------------------------------
  // MERGE WEATHER
  // --------------------------------------------
  const merged =
    mergeWeather(
      wxDoc,
      mrmsDoc
    );

  const allRows =
    Array.isArray(merged.daily)
      ? merged.daily
      : [];

  if (!allRows.length) {

    return {
      ok: false,
      error:
        "No weather rows available"
    };
  }

  // --------------------------------------------
  // IMPORTANT:
  // CURRENT CONDITIONS ONLY
  // --------------------------------------------
  const todayISO =
    getTodayISO();

  const currentRows =
    allRows.filter(r => {

      const dateISO =
        String(r?.dateISO || "");

      if (!dateISO) {
        return false;
      }

      // --------------------------------------------
      // KEEP:
      // historical + today
      // --------------------------------------------
      return dateISO <= todayISO;
    });

  if (!currentRows.length) {

    return {
      ok: false,
      error:
        "No current weather rows available"
    };
  }

  // --------------------------------------------
  // SEED HANDLING
  // --------------------------------------------
  const seed = {

    mode:
      opts.seedMode ||
      "baseline_30d",

    storage:
      Number.isFinite(
        Number(opts.seedStorage)
      )
        ? Number(opts.seedStorage)
        : null,

    surface:
      Number.isFinite(
        Number(opts.seedSurface)
      )
        ? Number(opts.seedSurface)
        : null
  };

  // --------------------------------------------
  // RUN MODEL
  // --------------------------------------------
  const model =
    runSoilModel(
      currentRows,
      fieldDoc,
      {
        seed
      }
    );

  if (!model) {

    return {
      ok: false,
      error:
        "Soil model failed"
    };
  }

  // --------------------------------------------
  // READINESS
  // --------------------------------------------
  const readiness =
    calculateReadiness(
      model,
      {
        globalStorageMult:
          opts.globalStorageMult ?? 1.0
      }
    );

  if (!readiness) {

    return {
      ok: false,
      error:
        "Readiness calculation failed"
    };
  }

  // --------------------------------------------
  // DEBUG
  // --------------------------------------------
  console.log(
    "🧪 ENGINE FINAL OUTPUT:",
    {
      readiness:
        readiness.readiness,

      readinessR:
        readiness.readinessR,

      wetness:
        readiness.wetness,

      wetnessR:
        readiness.wetnessR,

      sliderBias:
        readiness.sliderBias,

      storageFinal:
        readiness.storageFinal,

      storageForReadiness:
        readiness.storageForReadiness
    }
  );

  // --------------------------------------------
  // RETURN
  // --------------------------------------------
  return {

    ok: true,

    fieldId:
      fieldDoc?.id ||
      fieldDoc?.fieldId ||
      null,

    fieldName:
      fieldDoc?.name ||
      fieldDoc?.fieldName ||
      null,

    // --------------------------------------------
    // IMPORTANT:
    // RETURN BOTH RAW + ROUNDED
    // --------------------------------------------
    readiness:
      readiness.readiness,

    readinessR:
      readiness.readinessR,

    wetness:
      readiness.wetness,

    wetnessR:
      readiness.wetnessR,

    baseReadiness:
      readiness.baseReadiness,

    baseReadinessR:
      readiness.baseReadinessR,

    surfacePenalty:
      readiness.surfacePenalty,

    surfacePenaltyR:
      readiness.surfacePenaltyR,

    // --------------------------------------------
    // STORAGE
    // --------------------------------------------
    storageFinal:
      readiness.storageFinal,

    storagePhysFinal:
      model.storageFinal,

    surfaceFinal:
      model.surfaceFinal,

    surfaceStorageFinal:
      readiness.surfaceStorageFinal,

    storageForReadiness:
      readiness.storageForReadiness,

    readinessCreditIn:
      readiness.readinessCreditIn,

    // --------------------------------------------
    // FACTORS
    // --------------------------------------------
    factors:
      model.factors,

    // --------------------------------------------
    // TRACE
    // --------------------------------------------
    trace:
      model.trace,

    // --------------------------------------------
    // IMPORTANT:
    // RETURN ONLY CURRENT ROWS
    // --------------------------------------------
    rows:
      currentRows,

    // --------------------------------------------
    // DEBUG
    // --------------------------------------------
    debug: {

      seedMode:
        seed.mode,

      seedStorage:
        seed.storage,

      seedSurface:
        seed.surface,

      globalStorageMultApplied:
        readiness.globalStorageMultApplied,

      sliderBias:
        readiness.sliderBias,

      Smax:
        readiness.Smax,

      totalRows:
        allRows.length,

      currentRows:
        currentRows.length,

      forecastRowsFiltered:
        allRows.length -
        currentRows.length,

      todayISO,

      source:
        "FarmVista modular readiness engine",

      modelVersion:
        "2026-05-live-preview-fixed"
    }
  };
}

// --------------------------------------------
// EXPORT
// --------------------------------------------
module.exports = {
  runReadinessEngine
};