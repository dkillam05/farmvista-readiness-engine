// ================================
// FILE: services/readiness.js
// PURPOSE: FULL readiness engine (ported from original index)
// ================================

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// ================================
// GLOBAL MULT (keep same behavior)
// ================================
async function loadGlobalStorageMult() {
  return 1.0; // keep simple for now (same as your fallback)
}

// ================================
// DRY POWER
// ================================
function calcDryParts(r) {
  const temp = Number(r.tempF || 0);
  const wind = Number(r.windMph || 0);
  const rh = Number(r.rh || 0);
  const solar = Number(r.solarWm2 || 0);

  const tempN = clamp((temp - 20) / 45, 0, 1);
  const windN = clamp((wind - 2) / 20, 0, 1);
  const solarN = clamp((solar - 60) / 300, 0, 1);
  const rhN = clamp((rh - 35) / 65, 0, 1);

  let dryPwr = clamp(
    0.35 * tempN +
    0.3 * solarN +
    0.25 * windN -
    0.25 * rhN,
    0,
    1
  );

  return { dryPwr, tempN, windN, solarN, rhN };
}

// ================================
// FIELD FACTORS
// ================================
function mapFactors(soilWetness, drainageIndex) {
  const soilHold = clamp(soilWetness / 100, 0, 1);
  const drainPoor = clamp(drainageIndex / 100, 0, 1);

  const Smax = clamp(3 + soilHold + drainPoor, 3, 5);

  return {
    soilHold,
    drainPoor,
    Smax
  };
}

// ================================
// NORMALIZE ROWS
// ================================
function normalizeWeatherRows(rows) {
  return (rows || []).map(r => {
    const rain = Number(r.rainInAdj ?? r.rainIn ?? 0);

    const parts = calcDryParts(r);

    return {
      ...r,
      rainInAdj: rain,
      ...parts
    };
  });
}

// ================================
// MAIN ENGINE
// ================================
async function runFieldReadinessCoreServer(
  weatherRows,
  soilWetness,
  drainageIndex,
  existingLatestDoc = null
) {
  if (!Array.isArray(weatherRows) || !weatherRows.length) return null;

  const rows = normalizeWeatherRows(weatherRows);
  if (!rows.length) return null;

  const f = mapFactors(soilWetness, drainageIndex);
  const Smax = f.Smax;

  // ================================
  // SEED
  // ================================
  let storage;

  if (existingLatestDoc && Number.isFinite(existingLatestDoc.storageFinal)) {
    storage = clamp(existingLatestDoc.storageFinal, 0, Smax);
  } else {
    storage = 0.10 * Smax;
  }

  const globalMult = await loadGlobalStorageMult();

  let surface = 0;
  let readiness = 50;

  const trace = [];

  // ================================
  // LOOP DAYS
  // ================================
  for (const r of rows) {
    const rain = Number(r.rainInAdj || 0);
    const dry = Number(r.dryPwr || 0);

    // ================================
    // RAIN → STORAGE
    // ================================
    storage += rain * 0.6;

    // ================================
    // DRYDOWN
    // ================================
    storage -= dry * 0.25;

    // ================================
    // CLAMP STORAGE
    // ================================
    storage = clamp(storage, 0, Smax);

    // ================================
    // SURFACE (simple for now)
    // ================================
    surface = clamp(surface + rain * 0.5 - dry * 0.2, 0, 1);

    // ================================
    // READINESS
    // ================================
    const wetness = (storage / Smax) * 100;
    readiness = clamp(100 - wetness - surface * 20, 0, 100);

trace.push({
  dateISO: r.time || null,   // ✅ FIX
  storage,
  surface,
  readiness
});
  }

  const final = trace[trace.length - 1];

  return {
    readiness: final.readiness,
    readinessR: Math.round(final.readiness),
    wetness: 100 - final.readiness,
    wetnessR: Math.round(100 - final.readiness),
    storageFinal: final.storage,
    surfaceFinal: final.surface,
    rows: trace,
    seedSource: existingLatestDoc ? "latest" : "baseline"
  };
}

module.exports = { runFieldReadinessCoreServer };
