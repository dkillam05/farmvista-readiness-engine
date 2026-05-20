// ============================================
// FILE: /js/engine.js
// PURPOSE:
// Tie weather + MRMS + field settings into
// one final readiness result
//
// IMPORTANT CHANGE:
// ✅ CURRENT readiness ONLY uses:
//    - historical rows
//    - today's live row
//
// ✅ Forecast rows now get their OWN
//    forecast-only soil model pass
//    for debug + future traces.
//
// ✅ Forecast rows NO LONGER affect:
//    - current readiness
//    - current soil moisture
//    - current surface wetness
//
// ✅ Forecast rows NOW properly populate:
//    - forecast dryPwr
//    - forecast infiltration
//    - forecast storage
//    - forecast surface wetness
//    - forecast debug grid values
//
// UPDATED:
// ✅ Returns BOTH readiness + readinessR
// ✅ Returns BOTH wetness + wetnessR
// ✅ Returns storagePhysFinal
// ✅ Returns surfaceFinal
// ✅ Fixes forecast debug rows showing zeros
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
  // FORECAST MODEL
  //
  // IMPORTANT:
  // This DOES NOT affect current readiness.
  //
  // This ONLY exists so forecast rows
  // have real modeled values for:
  // - debug grids
  // - future traces
  // - forecast visualizations
  // --------------------------------------------
  let forecastModel = null;

  if (forecastRows.length) {

    forecastModel =
      runSoilModel(
        forecastRows,
        fieldDoc,
        {
          seed: {
            mode: "rolling",

            storage:
              model.storageFinal,

            surface:
              model.surfaceFinal
          }
        }
      );
  }

  // --------------------------------------------
  // ETA RATE
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
        eta?.drydownPointsPerHour ?? null,

      forecastTraceRows:
        forecastModel?.trace?.length || 0
    }
  );

  // --------------------------------------------
  // COMBINED TRACE
  // --------------------------------------------
  const combinedTrace = [
    ...(Array.isArray(model.trace)
      ? model.trace
      : []),

    ...(Array.isArray(forecastModel?.trace)
      ? forecastModel.trace
      : [])
  ];

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
      combinedTrace,

    // --------------------------------------------
    // CURRENT + FORECAST ROWS
    // --------------------------------------------
    rows: [
      ...currentRows,
      ...forecastRows
    ],

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

      forecastTraceRows:
        forecastModel?.trace?.length || 0,

      source:
        "FarmVista modular readiness engine",

      modelVersion:
        "2026-05-forecast-trace-fix-v1"
    }
  };
}

// --------------------------------------------
// EXPORT
// --------------------------------------------
module.exports = {
  runReadinessEngine
};