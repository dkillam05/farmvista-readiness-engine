// FILE: /pipeline/run-field.js
// FINAL FIX: TRUE ROLLING (NO MORE 10-DAY REPLAY — TODAY BUILDS CORRECTLY)

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
BUILD WEATHER WINDOW (🔥 REAL FIX)
========================================================================= */

function buildWeatherWindow(weatherRows, mode) {
  if (!Array.isArray(weatherRows)) return [];

  const dailyRows = weatherRows.filter(
    r => typeof r.dateISO === "string" && r.dateISO.length === 10
  );

  const hourlyRows = weatherRows.filter(
    r => typeof r.dateISO === "string" && r.dateISO.length > 10
  );

  // ✅ FULL REBUILD = 30 days history (leave this alone)
  if (mode === "rebuild") {
    return [
      ...dailyRows.slice(-30),
      ...hourlyRows
    ];
  }

  /* -----------------------------------------------------------------------
  🔥 TRUE ROLLING MODE (THIS IS THE FIX)

  ONLY use:
  - yesterday (small continuity buffer)
  - today hourly (rolling build)

  NO MORE 10 DAY REPLAY
  ----------------------------------------------------------------------- */

  const now = new Date();
  const todayISO = now.toISOString().slice(0, 10);

  const yesterday = new Date(now.getTime() - 86400000);
  const yesterdayISO = yesterday.toISOString().slice(0, 10);

  const recentDaily = dailyRows.filter(
    d => d.dateISO === yesterdayISO
  );

  const todayHourly = hourlyRows.filter(
    h => typeof h.dateISO === "string" && h.dateISO.startsWith(todayISO)
  );

  return [
    ...recentDaily,
    ...todayHourly
  ];
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
  rebuild = false
}) {
  if (!field || !weatherRows || !weatherRows.length) {
    return {
      ok: false,
      reason: "missing_inputs"
    };
  }

  let mode = "rolling";

  if (rebuild) {
    mode = "rebuild";
  }
  else if (isNewField(latestDoc)) {
    mode = "rebuild";
  }
  else if (hasLocationChanged(field, latestDoc)) {
    mode = "rebuild";
  }

const windowRows = buildWeatherWindow(weatherRows, mode);

// 🔥 CRITICAL — enforce chronological order BEFORE anything else
windowRows.sort((a, b) => {
  return new Date(a.dateISO) - new Date(b.dateISO);
});

if (!windowRows.length) {
  return {
    ok: false,
    reason: "no_weather_window"
  };
}

let previousState = null;

// 🔥 ONLY seed AFTER window is built + sorted
if (mode === "rolling" && latestDoc) {
  previousState = {
    storageFinal: Number(latestDoc.storageFinal),
    surfaceFinal: Number(latestDoc.surfaceFinal || 0)
  };
}

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
