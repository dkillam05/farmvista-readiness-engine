// ============================================
// FILE: /js/rain-effective.js
// PURPOSE:
// Calculate effective rainfall entering soil
// EXACTLY as your original model
// ============================================

// --------------------------------------------
// HELPERS
// --------------------------------------------
function clamp(n, lo, hi) {
  n = Number(n);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

// --------------------------------------------
// DEFAULT TUNING (same as old system)
// --------------------------------------------
const TUNE = {
  SAT_RUNOFF_START: 0.75,
  RUNOFF_EXP: 2.2,
  RUNOFF_DRAINPOOR_W: 0.35,

  DRY_BYPASS_END: 0.35,
  DRY_EXP: 1.6,
  DRY_BYPASS_BASE: 0.45,
  BYPASS_GOODDRAIN_W: 0.15,

  DRY_BYPASS_CAP_SAT: 0.15,
  DRY_BYPASS_CAP_MAX: 0.12,

  SAT_DRYBYPASS_FLOOR: 0.02,
  SAT_RUNOFF_CAP: 0.85,
  RAIN_EFF_MIN: 0.05
};

// --------------------------------------------
// MAIN FUNCTION
// --------------------------------------------
function effectiveRainInches(rainIn, storageBefore, Smax, factors) {
  const rain = Math.max(0, Number(rainIn || 0));

  if (
    !rain ||
    !Number.isFinite(rain) ||
    !Number.isFinite(storageBefore) ||
    !Number.isFinite(Smax) ||
    Smax <= 0
  ) {
    return 0;
  }

  const satRaw = storageBefore / Smax;
  const sat = clamp(satRaw, 0, 1);

  const drainPoor = clamp(Number(factors?.drainPoor), 0, 1);

  // --------------------------------------------
  // RUNOFF (saturated fields shed water)
  // --------------------------------------------
  const sr = clamp(
    (sat - TUNE.SAT_RUNOFF_START) /
      Math.max(1e-6, 1 - TUNE.SAT_RUNOFF_START),
    0,
    1
  );

  let runoffFrac = Math.pow(sr, TUNE.RUNOFF_EXP);

  runoffFrac =
    runoffFrac * (1 + TUNE.RUNOFF_DRAINPOOR_W * drainPoor);

  runoffFrac = clamp(runoffFrac, 0, TUNE.SAT_RUNOFF_CAP);

  const rainAfterRunoff = rain * (1 - runoffFrac);

  // --------------------------------------------
  // DRY BYPASS (dry soils don't absorb well)
  // --------------------------------------------
  const satB = Math.max(TUNE.SAT_DRYBYPASS_FLOOR, sat);

  const db = clamp(
    (TUNE.DRY_BYPASS_END - satB) /
      Math.max(1e-6, TUNE.DRY_BYPASS_END),
    0,
    1
  );

  const dryBypassCurve = Math.pow(db, TUNE.DRY_EXP);

  const goodDrain = 1 - drainPoor;

  let bypassFrac =
    TUNE.DRY_BYPASS_BASE *
    dryBypassCurve *
    (1 + TUNE.BYPASS_GOODDRAIN_W * goodDrain);

  bypassFrac = clamp(bypassFrac, 0, 0.9);

  if (sat < TUNE.DRY_BYPASS_CAP_SAT) {
    bypassFrac = Math.min(
      bypassFrac,
      TUNE.DRY_BYPASS_CAP_MAX
    );
  }

  const rainEffective =
    rainAfterRunoff * (1 - bypassFrac);

  // --------------------------------------------
  // MINIMUM EFFECTIVENESS
  // --------------------------------------------
  const minEff = TUNE.RAIN_EFF_MIN * rain;

  return Math.max(minEff, rainEffective);
}

// --------------------------------------------
// EXPORT
// --------------------------------------------
module.exports = {
  effectiveRainInches
};
