// FILE: /core/readiness-engine.js
// FIXED: hourly rows no longer dry like full daily rows

function clamp(n, lo, hi) {
  const v = Number(n);
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

function round(v, d = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const p = Math.pow(10, d);
  return Math.round(n * p) / p;
}

function isHourlyRow(row) {
  return typeof row?.dateISO === "string" && row.dateISO.length > 10;
}

function pickNumber(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/* =========================================================================
DRYING POWER
========================================================================= */
function calcDryPower(row) {
  const temp = pickNumber(row.tempF, row.tempAvg, row.temp);
  const wind = pickNumber(row.windMph, row.windAvg, row.wind);
  const solar = pickNumber(row.solarWm2, row.solarAvg, row.solar);
  const rh = pickNumber(row.rh, row.rhAvg);

  const tempN = clamp((temp - 30) / 50, 0, 1);
  const windN = clamp(wind / 20, 0, 1);
  const solarN = clamp(solar / 300, 0, 1);
  const rhN = clamp((rh - 30) / 70, 0, 1);

  const dry =
    (0.35 * tempN) +
    (0.30 * solarN) +
    (0.20 * windN) -
    (0.25 * rhN);

  return clamp(dry, 0, 1);
}

/* =========================================================================
INFILTRATION + RUNOFF
========================================================================= */
function effectiveRain(rain, storage, Smax) {
  if (!rain || rain <= 0) return 0;

  const saturation = clamp(storage / Smax, 0, 1);
  const runoff = Math.pow(saturation, 2.2);

  return rain * (1 - runoff);
}

/* =========================================================================
SURFACE WETNESS
========================================================================= */
function surfaceUpdate(surface, rain, dry, stepFactor) {
  surface += rain * 2.8;

  // daily rows use full drying; hourly rows use 1/24 drying
  surface -= (0.015 + dry * 0.18) * stepFactor;

  return clamp(surface, 0, 1.2);
}

/* =========================================================================
STORAGE UPDATE
========================================================================= */
function storageUpdate(storage, rainEff, dry, Smax, stepFactor) {
  storage += rainEff;

  // daily rows use full drying; hourly rows use 1/24 drying
  const loss = (0.02 + dry * 0.15) * stepFactor;
  storage -= loss;

  return clamp(storage, 0, Smax);
}

/* =========================================================================
READINESS
========================================================================= */
function calcReadiness(storage, surface, Smax) {
  const storageFrac = clamp(storage / Smax, 0, 1);

  let readiness = 100 * (1 - storageFrac);
  readiness *= (1 - Math.pow(storageFrac, 1.3));

  const surfaceFrac = clamp(surface / 1.2, 0, 1);
  const surfacePenalty = surfaceFrac * 50;

  readiness -= surfacePenalty;

  return clamp(readiness, 0, 100);
}

/* =========================================================================
MAIN ENGINE
========================================================================= */
function runReadinessEngine({
  weatherRows,
  soilWetness = 60,
  drainageIndex = 45,
  previousState = null
}) {
  if (!Array.isArray(weatherRows) || !weatherRows.length) {
    return null;
  }

  const Smax = clamp(
    3 + (Number(soilWetness || 60) / 100) + (Number(drainageIndex || 45) / 100),
    3,
    5
  );

  let storage;
  let surface;
  let seedSource;

  const forceRebuild = !!(previousState && previousState.forceRebuild);

  if (forceRebuild) {
    storage = 0.10 * Smax;
    surface = 0;
    seedSource = "rewind";
  }
  else if (previousState && Number.isFinite(Number(previousState.storageFinal))) {
    storage = clamp(Number(previousState.storageFinal), 0, Smax);

    surface = Number.isFinite(Number(previousState.surfaceFinal))
      ? clamp(Number(previousState.surfaceFinal), 0, 1.2)
      : 0;

    seedSource = "latest";
  }
  else {
    storage = 0.10 * Smax;
    surface = 0;
    seedSource = "baseline";
  }

  const trace = [];

  for (const row of weatherRows) {
    const hourly = isHourlyRow(row);

    // Daily row = full day. Hourly row = 1/24 day.
    const stepFactor = hourly ? (1 / 24) : 1;

    const rain = pickNumber(
      row.rainIn,
      row.rainTotal,
      row.rainInAdj
    );

    const dry = calcDryPower(row);
    const rainEff = effectiveRain(rain, storage, Smax);

    surface = surfaceUpdate(surface, rain, dry, stepFactor);
    storage = storageUpdate(storage, rainEff, dry, Smax, stepFactor);

    const readiness = calcReadiness(storage, surface, Smax);

    trace.push({
      dateISO: row.dateISO,
      rowType: hourly ? "hourly" : "daily",
      stepFactor: round(stepFactor, 4),
      rain: round(rain, 4),
      dry: round(dry, 4),
      storage: round(storage, 4),
      surface: round(surface, 4),
      readiness: round(readiness, 1)
    });
  }

  const last = trace[trace.length - 1];

  return {
    readiness: last.readiness,
    storageFinal: last.storage,
    surfaceFinal: last.surface,
    trace,
    seedSource,
    Smax
  };
}

module.exports = {
  runReadinessEngine
};
