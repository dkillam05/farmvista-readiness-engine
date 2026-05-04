// run-field.js
// Runs readiness for ONE field (no API, no batching)

const { runReadinessEngine } = require("../core/readiness-engine");

/* =========================================================================
HELPERS
========================================================================= */

function isNewField(latestDoc) {
  return !latestDoc || !Number.isFinite(Number(latestDoc.storageFinal));
}

function hasLocationChanged(field, latestDoc) {
  if (!latestDoc || !latestDoc.location) return false;

  const latDiff = Math.abs(field.lat - latestDoc.location.lat);
  const lngDiff = Math.abs(field.lng - latestDoc.location.lng);

  return latDiff > 0.00001 || lngDiff > 0.00001;
}

/* =========================================================================
BUILD WEATHER WINDOW
========================================================================= */

function buildWeatherWindow(weatherRows, mode) {
  if (!Array.isArray(weatherRows)) return [];

  // ✅ FULL REBUILD = USE ALL WEATHER
  if (mode === "rebuild") {
    return weatherRows;
  }

  // rolling = last 3 days
  return weatherRows.slice(-3);
}

/* =========================================================================
MAIN RUN FUNCTION
========================================================================= */

async function runField({
  field,
  weatherRows,
  latestDoc,
  soilWetness,
  drainageIndex,
  rebuild = false // 👈 ADD THIS
}) {
  if (!field || !weatherRows || !weatherRows.length) {
    return {
      ok: false,
      reason: "missing_inputs"
    };
  }

  /* ---------------------------------------------------------------------
  DETERMINE MODE
  --------------------------------------------------------------------- */

  let mode = "rolling";

  // 🔥 PRIORITY: explicit rebuild flag
  if (rebuild) {
    mode = "rebuild";
  }
  else if (isNewField(latestDoc)) {
    mode = "rebuild";
  }
  else if (hasLocationChanged(field, latestDoc)) {
    mode = "rebuild";
  }

  /* ---------------------------------------------------------------------
  BUILD WEATHER WINDOW
  --------------------------------------------------------------------- */

  const windowRows = buildWeatherWindow(weatherRows, mode);

  if (!windowRows.length) {
    return {
      ok: false,
      reason: "no_weather_window"
    };
  }

  /* ---------------------------------------------------------------------
  PREVIOUS STATE
  --------------------------------------------------------------------- */

  let previousState = null;

  if (mode === "rolling" && latestDoc) {
    previousState = {
      storageFinal: Number(latestDoc.storageFinal),
      surfaceFinal: Number(latestDoc.surfaceFinal || 0)
    };
  }

  /* ---------------------------------------------------------------------
  RUN ENGINE
  --------------------------------------------------------------------- */

  const result = runReadinessEngine({
    weatherRows: windowRows,
    soilWetness,
    drainageIndex,
    previousState
  });

  if (!result) {
    return {
      ok: false,
      reason: "engine_failed"
    };
  }

  /* ---------------------------------------------------------------------
  BUILD OUTPUT
  --------------------------------------------------------------------- */

  return {
    ok: true,
    mode,

    fieldId: field.id,

    readiness: Math.round(result.readiness),
    wetness: Math.round(100 - result.readiness),

    storageFinal: result.storageFinal,
    surfaceFinal: result.surfaceFinal,

    seedSource: result.seedSource,
    Smax: result.Smax,

    trace: result.trace,

    debug: {
      usedRows: windowRows.length,
      totalRowsAvailable: weatherRows.length,
      mode,
      rebuildFlag: rebuild
    }
  };
}

module.exports = {
  runField
};
