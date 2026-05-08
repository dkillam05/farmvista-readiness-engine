// ============================================
// FILE: /js/rain-effective.js
// PURPOSE:
// Calculate effective rainfall entering soil
//
// UPDATED ARCHITECTURE:
// ✅ Dynamic infiltration now handled primarily
//    by infiltration.js
// ✅ This file now ONLY handles:
//    - saturation runoff
//    - extreme overflow rejection
//    - minimum rainfall effectiveness
//
// IMPORTANT:
// Dry-soil infiltration behavior was REMOVED
// from here intentionally because it now lives
// in dynamicInfiltration().
// ============================================

// --------------------------------------------
// HELPERS
// --------------------------------------------
function clamp(n, lo, hi) {
  n = Number(n);

  if (!Number.isFinite(n)) {
    return lo;
  }

  return Math.max(lo, Math.min(hi, n));
}

// --------------------------------------------
// TUNING
// --------------------------------------------
const TUNE = {
  // --------------------------------------------
  // SATURATION RUNOFF
  // --------------------------------------------

  // Start rejecting rainfall once soils become
  // heavily saturated.
  SAT_RUNOFF_START: 0.82,

  // Softer curve than old system.
  RUNOFF_EXP: 1.7,

  // Poor drainage increases runoff.
  RUNOFF_DRAINPOOR_W: 0.28,

  // Hard cap on rainfall rejection.
  SAT_RUNOFF_CAP: 0.75,

  // --------------------------------------------
  // MINIMUM EFFECTIVE RAIN
  // --------------------------------------------
  RAIN_EFF_MIN: 0.03
};

// --------------------------------------------
// MAIN FUNCTION
// --------------------------------------------
function effectiveRainInches(
  rainIn,
  storageBefore,
  Smax,
  factors
) {
  const rain =
    Math.max(0, Number(rainIn || 0));

  if (
    !rain ||
    !Number.isFinite(rain) ||
    !Number.isFinite(storageBefore) ||
    !Number.isFinite(Smax) ||
    Smax <= 0
  ) {
    return 0;
  }

  // --------------------------------------------
  // CURRENT SATURATION
  // --------------------------------------------
  const satRaw =
    storageBefore / Smax;

  const sat =
    clamp(satRaw, 0, 1.35);

  const drainPoor =
    clamp(
      Number(factors?.drainPoor || 0),
      0,
      1
    );

  // --------------------------------------------
  // SATURATION RUNOFF
  //
  // Wet/saturated soils reject rainfall.
  // Poor drainage amplifies rejection.
  // --------------------------------------------
  const sr =
    clamp(
      (sat - TUNE.SAT_RUNOFF_START) /
        Math.max(
          1e-6,
          1 - TUNE.SAT_RUNOFF_START
        ),
      0,
      1
    );

  let runoffFrac =
    Math.pow(
      sr,
      TUNE.RUNOFF_EXP
    );

  runoffFrac *=
    1 +
    TUNE.RUNOFF_DRAINPOOR_W *
      drainPoor;

  runoffFrac =
    clamp(
      runoffFrac,
      0,
      TUNE.SAT_RUNOFF_CAP
    );

  // --------------------------------------------
  // EFFECTIVE RAIN AFTER RUNOFF
  // --------------------------------------------
  let rainEffective =
    rain * (1 - runoffFrac);

  // --------------------------------------------
  // MINIMUM EFFECTIVENESS FLOOR
  //
  // Tiny rainfall should still slightly affect
  // soil moisture.
  // --------------------------------------------
  const minEff =
    TUNE.RAIN_EFF_MIN * rain;

  rainEffective =
    Math.max(
      minEff,
      rainEffective
    );

  // --------------------------------------------
  // SAFETY
  // --------------------------------------------
  rainEffective =
    clamp(
      rainEffective,
      0,
      rain
    );

  return rainEffective;
}

// --------------------------------------------
// EXPORT
// --------------------------------------------
module.exports = {
  effectiveRainInches
};