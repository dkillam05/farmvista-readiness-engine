// ============================================
// FILE: /js/etaRate.js
// PURPOSE:
// Centralized ETA drydown rate engine
//
// GOAL:
// Produce forecast-based readiness gain per hour
// using the SAME math path as live readiness:
//
// forecast rows
// → runSoilModel()
// → calculateReadiness()
//
// IMPORTANT:
// ✅ Uses Open-Meteo forecast rainfall for future rows
// ✅ Uses same sliders via fieldDoc
// ✅ Uses same soil model
// ✅ Uses same readiness calculation
// ❌ No UI logic
// ❌ No operational thresholds
// ============================================

const { runSoilModel } = require("./soil-model");
const { calculateReadiness } = require("./readiness");

function safeNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round(v, d = 4) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;

  const p = Math.pow(10, d);
  return Math.round(n * p) / p;
}

function normalizeForecastRow(row) {
  const r = {
    ...row
  };

  // --------------------------------------------
  // ETA/FUTURE RULE:
  // use Open-Meteo forecast rain, NOT MRMS
  // --------------------------------------------
  const forecastRain =
    safeNum(r.rainOpenMeteoIn) ??
    safeNum(r.rainForecastIn) ??
    safeNum(r.rainIn) ??
    0;

  r.rainIn = forecastRain;
  r.rainInAdj = forecastRain;
  r.rainSource = "open-meteo-forecast";

  // Forecast days are full-day rows
  r.isTodayLive = false;
  r.hoursCount = 24;

  return r;
}

function calculateEtaRate({
  currentReadiness = null,
  currentStorage = null,
  currentSurface = null,
  forecastRows = [],
  fieldDoc = null,
  globalStorageMult = 1.0
}) {
  const rows = Array.isArray(forecastRows)
    ? forecastRows
        .filter(r => r && r.dateISO)
        .map(normalizeForecastRow)
    : [];

  if (!rows.length) {
    return {
      ok: false,
      source: "forecast_projection",
      reason: "no_forecast_rows",
      drydownPointsPerHour: null
    };
  }

  const startReadiness =
    safeNum(currentReadiness);

  const seedStorage =
    safeNum(currentStorage);

  const seedSurface =
    safeNum(currentSurface, 0);

  if (
    startReadiness === null ||
    seedStorage === null
  ) {
    return {
      ok: false,
      source: "forecast_projection",
      reason: "missing_current_state",
      currentReadiness: startReadiness,
      currentStorage: seedStorage,
      currentSurface: seedSurface,
      drydownPointsPerHour: null
    };
  }

  const model = runSoilModel(
    rows,
    fieldDoc || {},
    {
      seed: {
        mode: "rolling",
        storage: seedStorage,
        surface: seedSurface
      }
    }
  );

  if (!model) {
    return {
      ok: false,
      source: "forecast_projection",
      reason: "soil_model_failed",
      drydownPointsPerHour: null
    };
  }

  const projected = calculateReadiness(
    model,
    {
      globalStorageMult
    }
  );

  if (!projected) {
    return {
      ok: false,
      source: "forecast_projection",
      reason: "readiness_failed",
      drydownPointsPerHour: null
    };
  }

  const projectedReadiness =
    safeNum(projected.readiness);

  const readinessGain =
    projectedReadiness - startReadiness;

  const projectionHours =
    rows.length * 24;

  const drydownPointsPerHour =
    projectionHours > 0
      ? readinessGain / projectionHours
      : null;

  return {
    ok: true,
    source: "forecast_projection",

    currentReadiness:
      round(startReadiness, 4),

    projectedReadiness:
      round(projectedReadiness, 4),

    readinessGain:
      round(readinessGain, 4),

    projectionHours,

    drydownPointsPerHour:
      round(drydownPointsPerHour, 6),

    currentStorage:
      round(seedStorage, 4),

    currentSurface:
      round(seedSurface, 4),

    projectedStorageFinal:
      round(projected.storageFinal, 4),

    projectedStorageForReadiness:
      round(projected.storageForReadiness, 4),

    projectedSurfaceFinal:
      round(projected.surfaceStorageFinal, 4),

    forecastRows:
      rows.length,

    trace:
      model.trace || []
  };
}

module.exports = {
  calculateEtaRate
};