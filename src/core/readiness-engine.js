// FILE: /core/readiness-engine.js
// FULL FIX: OLD INDEX MATH + CORRECT HOURLY HANDLING + DEDUPE

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

function isHourlyRow(row) {
  return typeof row?.dateISO === "string" && row.dateISO.length > 10;
}

/* ============================================================
🔥 NEW: DEDUPE + AGGREGATE HOURLY ROWS
============================================================ */
function normalizeRows(rows) {
  const map = new Map();

  for (const r of rows) {
    if (!r?.dateISO) continue;

    const key = r.dateISO;

    if (!map.has(key)) {
      map.set(key, {
        dateISO: key,
        tempF: pickNumber(r.tempF, r.tempAvg),
        windMph: pickNumber(r.windMph, r.windAvg),
        rh: pickNumber(r.rh, r.rhAvg),
        solarWm2: pickNumber(r.solarWm2, r.solarAvg),
        rainIn: pickNumber(r.rainIn, r.rainTotal)
      });
    } else {
      // 🔥 MERGE DUPLICATES (this is the critical fix)
      const existing = map.get(key);

      existing.rainIn += pickNumber(r.rainIn, r.rainTotal);

      // average other fields
      existing.tempF = (existing.tempF + pickNumber(r.tempF, r.tempAvg)) / 2;
      existing.windMph = (existing.windMph + pickNumber(r.windMph, r.windAvg)) / 2;
      existing.rh = (existing.rh + pickNumber(r.rh, r.rhAvg)) / 2;
      existing.solarWm2 = (existing.solarWm2 + pickNumber(r.solarWm2, r.solarAvg)) / 2;
    }
  }

  return Array.from(map.values());
}

/* ============================================================
DRY POWER (UNCHANGED)
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
EFFECTIVE RAIN (UNCHANGED)
============================================================ */
function effectiveRain(rain, storage, Smax) {
  if (!rain || rain <= 0) return 0;

  const sat = clamp(storage / Smax, 0, 1);
  const runoff = Math.pow(sat, 2.2);

  return rain * (1 - runoff);
}

/* ============================================================
SURFACE SYSTEM (FIXED FOR HOURLY)
============================================================ */
function updateSurface(surface, rain, dry, stepFactor) {
  surface += rain * 2.2;

  const dryLoss = (0.02 + (dry * 0.28)) * stepFactor;
  surface -= dryLoss;

  return clamp(surface, 0, 1.2);
}

/* ============================================================
STORAGE SYSTEM (FIXED FOR HOURLY)
============================================================ */
function updateStorage(storage, rainEff, dry, Smax, stepFactor) {
  storage += rainEff;

  const loss = (0.02 + (dry * 0.15)) * stepFactor;
  storage -= loss;

  return clamp(storage, 0, Smax);
}

/* ============================================================
READINESS (UNCHANGED)
============================================================ */
function calcReadiness(storage, surface, Smax) {
  const sFrac = clamp(storage / Smax, 0, 1);

  let readiness = 100 * (1 - sFrac);
  readiness *= (1 - Math.pow(sFrac, 1.3));

  const surfFrac = clamp(surface / 1.2, 0, 1);
  const surfPenalty = surfFrac * 55;

  readiness -= surfPenalty;

  return clamp(readiness, 0, 100);
}

/* ============================================================
MAIN ENGINE
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

  // 🔥 FIX: normalize duplicates first
  weatherRows = normalizeRows(weatherRows);

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
    const hourly = isHourlyRow(row);
    const stepFactor = hourly ? (1 / 24) : 1;

    const rainRaw = pickNumber(row.rainIn, row.rainTotal);
    const rain = hourly ? rainRaw : rainRaw; // already hourly-safe after dedupe

    const dry = calcDryPower(row);

    const rainEff = effectiveRain(rain, storage, Smax);

    surface = updateSurface(surface, rain, dry, stepFactor);
    storage = updateStorage(storage, rainEff, dry, Smax, stepFactor);

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
