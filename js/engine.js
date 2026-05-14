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
//
// ETA UPDATE:
// ✅ Uses etaRate.js with SAME math pipeline
// ✅ Passes current storage + current surface correctly
// ✅ Passes forecast rows only
// ✅ Future rain uses Open-Meteo inside etaRate.js
// ✅ Returns drydownPointsPerHour
// ✅ Returns ETA projection diagnostics
// ============================================

const { mergeWeather } = require("./weather-merge");
const { runSoilModel } = require("./soil-model");
const { calculateReadiness } = require("./readiness");
const { calculateEtaRate } = require("./etaRate");

// --------------------------------------------
// HELPERS
// --------------------------------------------
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
      error: "No weather rows available"
    };
  }

  // --------------------------------------------
  // SPLIT CURRENT VS FORECAST
  // --------------------------------------------
  const todayISO =
    getTodayISO();

  const currentRows =
    allRows.filter(r => {
      const dateISO =
        String(r?.dateISO || "");

      if (!dateISO) return false;

      return dateISO <= todayISO;
    });

  const forecastRows =
    allRows.filter(r => {
      const dateISO =
        String(r?.dateISO || "");

      if (!dateISO) return false;

      return dateISO > todayISO;
    });

  if (!currentRows.length) {
    return {
      ok: false,
      error: "No current weather rows available"
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
  // RUN CURRENT MODEL
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
      error: "Soil model failed"
    };
  }

  // --------------------------------------------
  // CURRENT READINESS
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
      error: "Readiness calculation failed"
    };
  }

  // --------------------------------------------
  // ETA RATE
  //
  // IMPORTANT:
  // ETA starts from the CURRENT model state,
  // then runs FORECAST rows only through the
  // same soil-model + readiness pipeline.
  // --------------------------------------------
  const eta =
    calculateEtaRate({
      currentReadiness:
        readiness.readiness,

      currentStorage:
        model.storageFinal,

      currentSurface:
        model.surfaceFinal,

      forecastRows,

      fieldDoc,

      globalStorageMult:
        opts.globalStorageMult ?? 1.0
    });

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

      storageFinal:
        readiness.storageFinal,

      storagePhysFinal:
        model.storageFinal,

      surfaceFinal:
        model.surfaceFinal,

      storageForReadiness:
        readiness.storageForReadiness,

      etaOk:
        eta?.ok === true,

      etaReason:
        eta?.reason || null,

      drydownPointsPerHour:
        eta?.drydownPointsPerHour ?? null
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
    // READINESS
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
    // ETA
    // --------------------------------------------
    eta,

    drydownPointsPerHour:
      eta?.drydownPointsPerHour ?? null,

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
    // CURRENT ROWS ONLY
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

      Smax:
        readiness.Smax,

      totalRows:
        allRows.length,

      currentRows:
        currentRows.length,

      forecastRows:
        forecastRows.length,

      forecastRowsFiltered:
        allRows.length -
        currentRows.length,

      todayISO,

      etaOk:
        eta?.ok === true,

      etaReason:
        eta?.reason || null,

      etaDrydownPointsPerHour:
        eta?.drydownPointsPerHour ?? null,

      etaProjectionHours:
        eta?.projectionHours ?? null,

      source:
        "FarmVista modular readiness engine",

      modelVersion:
        "2026-05-eta-rate-v2"
    }
  };
}

// --------------------------------------------
// EXPORT
// --------------------------------------------
module.exports = {
  runReadinessEngine
};