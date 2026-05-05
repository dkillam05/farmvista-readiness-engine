// ============================================
// FILE: /js/engine.js
// PURPOSE:
// Tie weather + MRMS + field settings into
// one final readiness result
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

// --------------------------------------------
// MAIN ENGINE
// --------------------------------------------
function runReadinessEngine(wxDoc, mrmsDoc, fieldDoc, opts = {}) {
  const merged = mergeWeather(wxDoc, mrmsDoc);

  const dailyRows = Array.isArray(merged.daily)
    ? merged.daily
    : [];

  if (!dailyRows.length) {
    return {
      ok: false,
      error: "No weather rows available"
    };
  }

  const model = runSoilModel(dailyRows, fieldDoc);

  if (!model) {
    return {
      ok: false,
      error: "Soil model failed"
    };
  }

  const readiness = calculateReadiness(model, {
    globalStorageMult: opts.globalStorageMult ?? 1.0
  });

  if (!readiness) {
    return {
      ok: false,
      error: "Readiness calculation failed"
    };
  }

  return {
    ok: true,

    fieldId: fieldDoc?.id || fieldDoc?.fieldId || null,
    fieldName: fieldDoc?.name || fieldDoc?.fieldName || null,

    readiness: readiness.readinessR,
    wetness: readiness.wetnessR,
    baseReadiness: readiness.baseReadinessR,
    surfacePenalty: readiness.surfacePenaltyR,

    storageFinal: readiness.storageFinal,
    surfaceStorageFinal: readiness.surfaceStorageFinal,
    storageForReadiness: readiness.storageForReadiness,
    readinessCreditIn: readiness.readinessCreditIn,

    factors: model.factors,

    trace: model.trace,
    rows: dailyRows,

    debug: {
      globalStorageMultApplied: readiness.globalStorageMultApplied,
      Smax: readiness.Smax,
      source: "FarmVista modular readiness engine",
      modelVersion: "2026-05-clean-start"
    }
  };
}

// --------------------------------------------
// EXPORT
// --------------------------------------------
module.exports = {
  runReadinessEngine
};
