// ============================================
// FILE: /js/engine.js
// PURPOSE:
// Tie weather + MRMS + field settings into
// one final readiness result (WITH SEED LOGIC)
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

  // --------------------------------------------
  // NEW: SEED HANDLING
  // --------------------------------------------
  const seed = {
    mode: opts.seedMode || "baseline_30d",

    // rolling values (if available)
    storage: Number.isFinite(Number(opts.seedStorage))
      ? Number(opts.seedStorage)
      : null,

    surface: Number.isFinite(Number(opts.seedSurface))
      ? Number(opts.seedSurface)
      : null
  };

  // --------------------------------------------
  // RUN MODEL (WITH SEED)
  // --------------------------------------------
  const model = runSoilModel(dailyRows, fieldDoc, {
    seed
  });

  if (!model) {
    return {
      ok: false,
      error: "Soil model failed"
    };
  }

  // --------------------------------------------
  // READINESS
  // --------------------------------------------
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

    // --------------------------------------------
    // DEBUG (IMPORTANT FOR YOU)
    // --------------------------------------------
    debug: {
      seedMode: seed.mode,
      seedStorage: seed.storage,
      seedSurface: seed.surface,

      globalStorageMultApplied: readiness.globalStorageMultApplied,
      Smax: readiness.Smax,

      source: "FarmVista modular readiness engine",
      modelVersion: "2026-05-seed-enabled"
    }
  };
}

// --------------------------------------------
// EXPORT
// --------------------------------------------
module.exports = {
  runReadinessEngine
};
