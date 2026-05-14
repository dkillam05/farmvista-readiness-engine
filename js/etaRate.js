// ============================================
// FILE: /js/etaRate.js
// PURPOSE:
// Centralized ETA drydown rate engine
//
// GOAL:
// Produce a stable future readiness
// gain-per-hour value using forecast-only
// weather rows and current soil state.
//
// IMPORTANT:
// ❌ No UI logic
// ❌ No operational thresholds
// ❌ No render math
// ❌ No history rebuilds
//
// ✅ Forecast-only projection
// ✅ Starts from current live state
// ✅ Uses same physics model inputs
// ✅ Single source of ETA math
// ============================================

const { runSoilModel } = require("./soil-model");

function clamp(n, lo, hi) {
  n = Number(n);

  if (!Number.isFinite(n)) {
    return lo;
  }

  return Math.max(lo, Math.min(hi, n));
}

function round(v, d = 4) {
  const p = Math.pow(10, d);

  return Math.round(Number(v) * p) / p;
}

// ============================================
// MAIN ETA RATE ENGINE
// ============================================
function calculateEtaRate({
  currentReadiness = 0,
  currentStorage = 0,
  currentSurface = 0,

  weatherRows = [],
  factors = {}
}) {

  // --------------------------------------------
  // FORECAST ROWS ONLY
  // --------------------------------------------
  const forecastRows =
    weatherRows.filter(r =>
      r &&
      (
        r.isForecast === true ||
        r.isFuture === true
      )
    );

  // --------------------------------------------
  // NO FORECAST
  // --------------------------------------------
  if (!forecastRows.length) {

    return {
      ok: false,
      reason: "no_forecast_rows"
    };
  }

  // --------------------------------------------
  // START STATE
  // --------------------------------------------
  let storage =
    Number(currentStorage || 0);

  let surface =
    Number(currentSurface || 0);

  // --------------------------------------------
  // TRACKING
  // --------------------------------------------
  const readinessSeries = [];

  let projectedReadiness =
    Number(currentReadiness || 0);

  // ============================================
  // FUTURE SIMULATION LOOP
  // ============================================
  for (const row of forecastRows) {

    const sim =
      runSoilModel({
        row,
        storage,
        surface,
        factors
      });

    if (!sim || !sim.ok) {
      continue;
    }

    storage =
      Number(sim.storage || 0);

    surface =
      Number(sim.surface || 0);

    projectedReadiness =
      clamp(
        Number(sim.readiness || 0),
        0,
        100
      );

    readinessSeries.push({
      dateISO: row.dateISO,
      readiness: projectedReadiness
    });
  }

  // --------------------------------------------
  // NO VALID FUTURE POINTS
  // --------------------------------------------
  if (!readinessSeries.length) {

    return {
      ok: false,
      reason: "no_valid_projection"
    };
  }

  // --------------------------------------------
  // FINAL READINESS
  // --------------------------------------------
  const finalReadiness =
    Number(
      readinessSeries[
        readinessSeries.length - 1
      ]?.readiness || currentReadiness
    );

  // --------------------------------------------
  // HOURS
  // --------------------------------------------
  const totalHours =
    forecastRows.length * 24;

  if (totalHours <= 0) {

    return {
      ok: false,
      reason: "invalid_hours"
    };
  }

  // --------------------------------------------
  // ETA RATE
  // --------------------------------------------
  const readinessGain =
    finalReadiness -
    Number(currentReadiness || 0);

  const drydownPointsPerHour =
    readinessGain / totalHours;

  // --------------------------------------------
  // RETURN
  // --------------------------------------------
  return {

    ok: true,

    currentReadiness:
      round(currentReadiness),

    projectedReadiness:
      round(finalReadiness),

    readinessGain:
      round(readinessGain),

    projectionHours:
      round(totalHours),

    drydownPointsPerHour:
      round(drydownPointsPerHour, 6),

    readinessSeries
  };
}

// ============================================
// EXPORT
// ============================================
module.exports = {
  calculateEtaRate
};