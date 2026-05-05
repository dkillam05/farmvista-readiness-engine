// FILE: /core/readiness-engine.js
// FULL RESTORE: OLD INDEX MATH (WORKING + COMPLETE)

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

function pickNumber(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/* ============================================================
DRY POWER (matches old index behavior)
============================================================ */
function calcDryPower(row) {
  const temp = pickNumber(row.tempF, row.tempAvg);
  const wind = pickNumber(row.windMph, row.windAvg);
  const solar = pickNumber(row.solarWm2, row.solarAvg);
  const rh = pickNumber(row.rh, row.rhAvg);

  const tempN = clamp((temp - 20) / 45, 0, 1);
  const windN = clamp((wind - 2) / 20, 0, 1);
  const solarN = clamp((solar - 60) / 300, 0, 1);
  const rhN = clamp((rh - 35) / 65, 0, 1);

  let dry =
    (0.35 * tempN) +
    (0.30 * solarN) +
    (0.25 * windN) -
    (0.25 * rhN);

  return clamp(dry, 0, 1);
}

/* ============================================================
EFFECTIVE RAIN (nonlinear saturation)
============================================================ */
function effectiveRain(rain, storage, Smax) {
  if (!rain || rain <= 0) return 0;

  const sat = clamp(storage / Smax, 0, 1);

  // old index style runoff curve
  const runoff = Math.pow(sat, 2.2);

  return rain * (1 - runoff);
}

/* ============================================================
SURFACE SYSTEM (matches old index behavior)
============================================================ */
function updateSurface(surface, rain, dry) {
  surface += rain * 2.2;

  const dryLoss = 0.02 + (dry * 0.28);
  surface -= dryLoss;

  return clamp(surface, 0, 1.2);
}

/* ============================================================
STORAGE SYSTEM
============================================================ */
function updateStorage(storage, rainEff, dry, Smax) {
  storage += rainEff;

  const loss = 0.02 + (dry * 0.15);
  storage -= loss;

  return clamp(storage, 0, Smax);
}

/* ============================================================
FINAL READINESS (OLD INDEX STYLE — NONLINEAR)
============================================================ */
function calcReadiness(storage, surface, Smax) {
  const sFrac = clamp(storage / Smax, 0, 1);

  // nonlinear soil penalty
  let readiness = 100 * (1 - sFrac);
  readiness *= (1 - Math.pow(sFrac, 1.3));

  // surface penalty (key piece from old model)
  const surfFrac = clamp(surface / 1.2, 0, 1);
  const surfPenalty = surfFrac * 55;

  readiness -= surfPenalty;

  return clamp(readiness, 0, 100);
}

/* ============================================================
MAIN ENGINE (FULLY RESTORED)
============================================================ */
function runReadinessEngine({
  weatherRows,
  soilWetness = 60,
  drainageIndex = 45,
  previousState = null
}) {
  if (!Array.isArray(weatherRows) || !weatherRows.length) {
    return null;
  }

  // SORT REQUIRED
  weatherRows.sort((a, b) => new Date(a.dateISO) - new Date(b.dateISO));

  const Smax = clamp(
    3 + (soilWetness / 100) + (drainageIndex / 100),
    3,
    5
  );

  let storage;
  let surface;
  let seedSource;

  if (previousState && Number.isFinite(previousState.storageFinal)) {
    storage = clamp(previousState.storageFinal, 0, Smax);
    surface = clamp(previousState.surfaceFinal || 0, 0, 1.2);
    seedSource = "latest";
  } else {
    storage = 0.10 * Smax;
    surface = 0;
    seedSource = "baseline";
  }

  const trace = [];

  for (const row of weatherRows) {
    const rain = pickNumber(row.rainIn, row.rainTotal);
    const dry = calcDryPower(row);

    const rainEff = effectiveRain(rain, storage, Smax);

    surface = updateSurface(surface, rain, dry);
    storage = updateStorage(storage, rainEff, dry, Smax);

    const readiness = calcReadiness(storage, surface, Smax);

    trace.push({
      dateISO: row.dateISO,
      storage: round(storage, 3),
      surface: round(surface, 3),
      readiness: round(readiness, 1)
    });
  }

  const last = trace[trace.length - 1];

  return {
    readiness: last.readiness,
    storageFinal: storage,
    surfaceFinal: surface,
    trace,
    seedSource,
    Smax
  };
}

module.exports = {
  runReadinessEngine
};
