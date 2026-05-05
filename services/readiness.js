// ================================
// FILE: services/readiness.js
// PURPOSE: Restored readiness engine (aligned with dailySeries)
// ================================

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// ================================
// DRY POWER (NOW USES tempF DIRECTLY)
// ================================
function calcDryParts(r) {
  const temp = Number(r.tempF ?? 50);
  const wind = Number(r.windMph || 6);
  const rh = Number(r.rh || 65);
  const solar = Number(r.solarWm2 || 180);

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

  return { soilHold, drainPoor, Smax };
}

// ================================
// NORMALIZE ROWS
// ================================
function normalizeWeatherRows(rows) {
  return (rows || []).map(r => {
    const rain = Number(r.rainIn ?? 0);

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
  // SEED (ROLLING STATE)
  // ================================
  let storage;

  if (existingLatestDoc && Number.isFinite(existingLatestDoc.storageFinal)) {
    storage = clamp(existingLatestDoc.storageFinal, 0, Smax);
  } else {
    storage = 0.10 * Smax;
  }

  let surface = 0;
  let readiness = 50;

  const trace = [];

  // ================================
  // LOOP
  // ================================
  for (const r of rows) {
    const rain = Number(r.rainInAdj || 0);
    const dry = Number(r.dryPwr || 0);

    // 🌧️ RAIN
    const effectiveRain =
      rain * (0.35 + (1 - f.drainPoor) * 0.25);

    storage += effectiveRain;

    // ☀️ DRYDOWN
    storage -= dry * 0.12 * (1 + f.drainPoor);

    storage = clamp(storage, 0, Smax);

    // 🌧️ SURFACE
    surface = clamp(
      surface + rain * 0.8 - dry * 0.15,
      0,
      1.5
    );

    // 🌱 WETNESS CURVE
    const wetness =
      Math.pow(storage / Smax, 0.7) * 100;

    const surfacePenalty = surface * 35;

    readiness = clamp(
      100 - wetness - surfacePenalty,
      0,
      100
    );

    trace.push({
      dateISO: r.dateISO || null,   // ✅ FIXED
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
