// readiness-engine.js
// PURE FIELD READINESS ENGINE (NO FIRESTORE, NO API)
// This is the heart of the system

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, Number(n)));
}

function round(v, d = 2) {
  const p = Math.pow(10, d);
  return Math.round(Number(v) * p) / p;
}

/* =========================================================================
DRYING POWER
========================================================================= */
function calcDryPower(row) {
  const temp = Number(row.tempF || 0);
  const wind = Number(row.windMph || 0);
  const solar = Number(row.solarWm2 || 0);
  const rh = Number(row.rh || 0);

  const tempN = clamp((temp - 30) / 50, 0, 1);
  const windN = clamp(wind / 20, 0, 1);
  const solarN = clamp(solar / 300, 0, 1);
  const rhN = clamp((rh - 30) / 70, 0, 1);

  let dry =
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

  // more saturated → more runoff
  const runoff = Math.pow(saturation, 2.2);

  return rain * (1 - runoff);
}

/* =========================================================================
SURFACE WETNESS
========================================================================= */
function surfaceUpdate(surface, rain, dry) {
  // add rain to surface
  surface += rain * 2.0;

  // dry it down
  surface -= (0.03 + dry * 0.25);

  return clamp(surface, 0, 1.2);
}

/* =========================================================================
STORAGE UPDATE
========================================================================= */
function storageUpdate(storage, rainEff, dry, Smax) {
  // add infiltration
  storage += rainEff;

  // drying loss
  const loss = (0.02 + dry * 0.15);
  storage -= loss;

  return clamp(storage, 0, Smax);
}

/* =========================================================================
READINESS
========================================================================= */
function calcReadiness(storage, surface, Smax) {
  const storageFrac = clamp(storage / Smax, 0, 1);

  let readiness = 100 * (1 - storageFrac);

  // surface penalty
  const surfaceFrac = clamp(surface / 1.2, 0, 1);
  const surfacePenalty = Math.pow(surfaceFrac, 0.9) * 55;

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

  // Storage capacity
  const Smax = clamp(
    3 + (soilWetness / 100) + (drainageIndex / 100),
    3,
    5
  );

  // Seed logic
  let storage;
  let surface;
  let seedSource;

  if (previousState && Number.isFinite(Number(previousState.storageFinal))) {
    storage = clamp(Number(previousState.storageFinal), 0, Smax);

    // CRITICAL FIX:
    // Carry surface wetness forward during rolling runs.
    // Before this, surface always restarted at 0.
    surface = Number.isFinite(Number(previousState.surfaceFinal))
      ? clamp(Number(previousState.surfaceFinal), 0, 1.2)
      : 0;

    seedSource = "latest";
  } else {
    storage = 0.10 * Smax;
    surface = 0;
    seedSource = "baseline";
  }

  const trace = [];

  for (const row of weatherRows) {
    const rain = Number(row.rainIn || 0);
    const dry = calcDryPower(row);

    const rainEff = effectiveRain(rain, storage, Smax);

    surface = surfaceUpdate(surface, rain, dry);
    storage = storageUpdate(storage, rainEff, dry, Smax);

    const readiness = calcReadiness(storage, surface, Smax);

    trace.push({
      dateISO: row.dateISO,
      rain,
      dry,
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