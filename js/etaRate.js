// ============================================
// FILE: /js/etaRate.js
// PURPOSE:
// Centralized ETA drydown engine
//
// GOAL:
// Build DAILY forecast readiness-change buckets
// using SAME readiness physics:
//
// forecast rows
// → runSoilModel()
// → calculateReadiness()
//
// IMPORTANT:
// ✅ Uses SAME soil model
// ✅ Uses SAME readiness math
// ✅ Uses SAME sliders
// ✅ Uses Open-Meteo forecast rain
// ✅ Produces DAILY ETA buckets
// ✅ Day 1 = remaining today only
// ✅ Days 2-7 = full forecast days
// ✅ Allows negative readiness gain on rain/wet days
//
// ❌ No UI logic
// ❌ No operational thresholds
// ============================================

const { runSoilModel } = require("./soil-model");
const { calculateReadiness } = require("./readiness");

// --------------------------------------------
// HELPERS
// --------------------------------------------
function safeNum(v, fallback = null) {
  const n = Number(v);

  return Number.isFinite(n)
    ? n
    : fallback;
}

function round(v, d = 4) {
  const n = Number(v);

  if (!Number.isFinite(n)) {
    return null;
  }

  const p = Math.pow(10, d);

  return Math.round(n * p) / p;
}

function clamp(n, lo, hi) {
  n = Number(n);

  if (!Number.isFinite(n)) {
    return lo;
  }

  return Math.max(lo, Math.min(hi, n));
}

function normalizeForecastRow(row, idx = 0) {
  const r = {
    ...row
  };

  // --------------------------------------------
  // ETA RULE:
  // Future forecast uses Open-Meteo rain.
  // MRMS is for history/current only.
  // --------------------------------------------
  const forecastRain =
    safeNum(r.rainOpenMeteoIn) ??
    safeNum(r.rainForecastIn) ??
    safeNum(r.forecastRainIn) ??
    safeNum(r.rainIn) ??
    0;

  r.rainIn = forecastRain;
  r.rainInAdj = forecastRain;
  r.rainSource = "open-meteo-forecast";

  // --------------------------------------------
  // DAY 1:
  // remaining today only
  // --------------------------------------------
  if (idx === 0) {
    const nowHour =
      new Date().getHours();

    const remainingHours =
      clamp(
        24 - nowHour,
        1,
        24
      );

    r.isTodayLive = true;
    r.hoursCount = remainingHours;
  } else {
    // --------------------------------------------
    // FUTURE DAYS:
    // full 24h buckets
    // --------------------------------------------
    r.isTodayLive = false;
    r.hoursCount = 24;
  }

  return r;
}

// ============================================
// MAIN ETA ENGINE
// ============================================
function calculateEtaRate({
  currentReadiness = null,
  currentStorage = null,
  currentSurface = null,
  forecastRows = [],
  fieldDoc = null,
  globalStorageMult = 1.0
}) {
  const rows =
    Array.isArray(forecastRows)
      ? forecastRows
          .filter(r =>
            r &&
            r.dateISO
          )
          .slice(0, 7)
          .map((r, idx) =>
            normalizeForecastRow(
              r,
              idx
            )
          )
      : [];

  if (!rows.length) {
    return {
      ok: false,
      source: "forecast_projection",
      reason: "no_forecast_rows",
      etaDays: [],
      drydownPointsPerHour: null
    };
  }

  const startReadiness =
    safeNum(currentReadiness);

  let rollingStorage =
    safeNum(currentStorage);

  let rollingSurface =
    safeNum(currentSurface, 0);

  if (
    startReadiness === null ||
    rollingStorage === null
  ) {
    return {
      ok: false,
      source: "forecast_projection",
      reason: "missing_current_state",
      currentReadiness: startReadiness,
      currentStorage: rollingStorage,
      currentSurface: rollingSurface,
      etaDays: [],
      drydownPointsPerHour: null
    };
  }

  const etaDays = [];

  let priorReadiness =
    startReadiness;

  // ============================================
  // LOOP FORECAST DAYS
  // ============================================
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    const storageStart =
      rollingStorage;

    const surfaceStart =
      rollingSurface;

    const readinessStart =
      priorReadiness;

    // --------------------------------------------
    // Run ONE day using same soil model
    // --------------------------------------------
    const model =
      runSoilModel(
        [row],
        fieldDoc || {},
        {
          seed: {
            mode: "rolling",
            storage: rollingStorage,
            surface: rollingSurface
          }
        }
      );

    if (!model) {
      etaDays.push({
        day: i + 1,
        dateISO: row.dateISO,
        ok: false,
        reason: "soil_model_failed",
        hours: safeNum(row.hoursCount, 24),
        readinessStart: round(readinessStart, 4),
        readinessEnd: round(readinessStart, 4),
        readinessGain: 0,
        drydownPointsPerHour: 0
      });

      continue;
    }

    // --------------------------------------------
    // Same readiness calculation
    // --------------------------------------------
    const projected =
      calculateReadiness(
        model,
        {
          globalStorageMult
        }
      );

    if (!projected) {
      etaDays.push({
        day: i + 1,
        dateISO: row.dateISO,
        ok: false,
        reason: "readiness_failed",
        hours: safeNum(row.hoursCount, 24),
        readinessStart: round(readinessStart, 4),
        readinessEnd: round(readinessStart, 4),
        readinessGain: 0,
        drydownPointsPerHour: 0
      });

      continue;
    }

    const projectedReadiness =
      safeNum(projected.readiness);

    if (projectedReadiness === null) {
      etaDays.push({
        day: i + 1,
        dateISO: row.dateISO,
        ok: false,
        reason: "projected_readiness_missing",
        hours: safeNum(row.hoursCount, 24),
        readinessStart: round(readinessStart, 4),
        readinessEnd: round(readinessStart, 4),
        readinessGain: 0,
        drydownPointsPerHour: 0
      });

      continue;
    }

    const hours =
      safeNum(row.hoursCount, 24);

    // --------------------------------------------
    // IMPORTANT:
    // This can be POSITIVE or NEGATIVE.
    //
    // Positive = drying / gaining readiness
    // Negative = rain/wet forecast reducing readiness
    // --------------------------------------------
    const readinessGain =
      projectedReadiness -
      readinessStart;

    const drydownPointsPerHour =
      hours > 0
        ? readinessGain / hours
        : 0;

    etaDays.push({
      ok: true,

      day:
        i + 1,

      dateISO:
        row.dateISO,

      hours:
        round(hours, 2),

      readinessStart:
        round(readinessStart, 4),

      readinessEnd:
        round(projectedReadiness, 4),

      readinessGain:
        round(readinessGain, 4),

      drydownPointsPerHour:
        round(drydownPointsPerHour, 6),

      storageStart:
        round(storageStart, 4),

      storageEnd:
        round(model.storageFinal, 4),

      surfaceStart:
        round(surfaceStart, 4),

      surfaceEnd:
        round(model.surfaceFinal, 4),

      storageForReadiness:
        round(projected.storageForReadiness, 4),

      surfacePenalty:
        round(projected.surfacePenalty, 4),

      rainIn:
        round(row.rainInAdj ?? row.rainIn ?? 0, 4),

      rainSource:
        row.rainSource || "open-meteo-forecast",

      trace:
        Array.isArray(model.trace)
          ? model.trace
          : []
    });

    // --------------------------------------------
    // Roll state forward
    // --------------------------------------------
    priorReadiness =
      projectedReadiness;

    rollingStorage =
      safeNum(
        model.storageFinal,
        rollingStorage
      );

    rollingSurface =
      safeNum(
        model.surfaceFinal,
        rollingSurface
      );
  }

  // --------------------------------------------
  // SUMMARY
  // --------------------------------------------
  const totalHours =
    etaDays.reduce(
      (sum, d) =>
        sum + Number(d.hours || 0),
      0
    );

  const totalGain =
    etaDays.reduce(
      (sum, d) =>
        sum + Number(d.readinessGain || 0),
      0
    );

  const avgDrydownPerHour =
    totalHours > 0
      ? totalGain / totalHours
      : 0;

  return {
    ok: true,
    source: "forecast_projection",

    currentReadiness:
      round(startReadiness, 4),

    projectedReadiness:
      round(priorReadiness, 4),

    readinessGain:
      round(totalGain, 4),

    projectionHours:
      round(totalHours, 2),

    drydownPointsPerHour:
      round(avgDrydownPerHour, 6),

    currentStorage:
      round(currentStorage, 4),

    currentSurface:
      round(currentSurface, 4),

    projectedStorageFinal:
      round(rollingStorage, 4),

    projectedSurfaceFinal:
      round(rollingSurface, 4),

    etaDays,

    forecastRows:
      rows.length
  };
}

module.exports = {
  calculateEtaRate
};