// run-field.js
// Runs readiness for ONE field (no API, no batching)
// This is the bridge between data + engine

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

function buildWeatherWindow(weatherRows, latestDoc, mode) {
  if (!Array.isArray(weatherRows)) return [];

  // NEW FIELD OR LOCATION CHANGE → FULL 30 DAY
  if (mode === "rebuild") {
    return weatherRows;
  }

  // 🔥 FIX: use last 3 days instead of 2
  // Ensures:
  // - today is always included (even if partial)
  // - avoids ordering/timing issues
  // - gives buffer for MRMS lag
  const last3Days = weatherRows.slice(-3);

  return last3Days;
}

/* =========================================================================
MAIN RUN FUNCTION
========================================================================= */

async function runField({
  field,
  weatherRows,
  latestDoc,
  soilWetness,
  drainageIndex
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

  if (isNewField(latestDoc)) {
    mode = "rebuild";
  }

  if (hasLocationChanged(field, latestDoc)) {
    mode = "rebuild";
  }

  /* ---------------------------------------------------------------------
  BUILD WEATHER WINDOW
  --------------------------------------------------------------------- */

  const windowRows = buildWeatherWindow(weatherRows, latestDoc, mode);

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
      // 🔥 FIX: carry forward surface state too
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
      mode
    }
  };
}

module.exports = {
  runField
};