// ================================
// FILE: services/readiness.js
// PURPOSE: Improved readiness engine (closer to original behavior)
// ================================

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// ================================
// GLOBAL MULT
// ================================
async function loadGlobalStorageMult() {
  return 1.0;
}

// ================================
// DRY POWER
// ================================
function calcDryParts(r) {
  const tempC = Number(r.temp ?? 0);
  const temp = tempC * 9/5 + 32;

  const wind = Number(r.windMph || 3);   // default slight wind
  const rh = Number(r.rh || 60);         // default humidity
  const solar = Number(r.solarWm2 || 150); // default daylight

  const tempN = clamp((temp - 20) / 45, 0, 1);
  const windN = clamp((wind - 2) / 20, 0, 1);
  const solarN = clamp((solar - 60) / 300, 0, 1);
  const rhN = clamp((rh - 35) / 65, 0, 1);

  const dryPwr = clamp(
    0.35 * tempN +
    0.3 * solarN +
    0.25 * windN -
    0.25 * rhN,
    0,
    1
  );

  return { dryPwr };
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
    const rain = Number(r.rainInAdj ?? r.rainIn ?? r.rain ?? 0);

    return {
      ...r,
      rainInAdj: rain,
      ...calcDryParts(r)
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

  await loadGlobalStorageMult();

  let surface = 0;
  let readiness = 50;

  const trace = [];

  // ================================
  // LOOP
  // ================================
  for (const r of rows) {
    const rain = Number(r.rainInAdj || 0);
    const dry = Number(r.dryPwr || 0);

    // ================================
    // 🌧️ RAIN (improved realism)
    // ================================
    const effectiveRain =
      rain * (0.35 + (1 - f.drainPoor) * 0.25);

    storage += effectiveRain;

    // ================================
    // ☀️ DRYDOWN (slower + drainage aware)
    // ================================
    storage -= dry * 0.12 * (1 + f.drainPoor);

    // ================================
    // CLAMP STORAGE
    // ================================
    storage = clamp(storage, 0, Smax);

    // ================================
    // 🌧️ SURFACE WATER (stronger effect)
    // ================================
    surface = clamp(
      surface + rain * 0.8 - dry * 0.15,
      0,
      1.5
    );

    // ================================
    // 🌱 STORAGE → WETNESS CURVE (non-linear)
    // ================================
    const wetness =
      Math.pow(storage / Smax, 0.7) * 100;

    // ================================
    // 🧱 SURFACE PENALTY (strong)
    // ================================
    const surfacePenalty = surface * 35;

    // ================================
    // FINAL READINESS
    // ================================
    readiness = clamp(
      100 - wetness - surfacePenalty,
      0,
      100
    );

    trace.push({
      dateISO: r.time || null,
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
