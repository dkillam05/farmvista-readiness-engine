// ============================================
// FILE: /js/infiltration.js
// PURPOSE:
// Dynamic infiltration + holding/drainage factors
// for FarmVista readiness model
//
// UPDATED:
// ✅ Balanced infiltration realism
// ✅ Prevents instant drying
// ✅ Prevents permanent wet lock
// ✅ Better repeated-rain handling
// ✅ Keeps 0 = dry/well-drained and 100 = wet/poorly-drained logic
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

function safePct01(v) {
  const n = Number(v);

  if (!Number.isFinite(n)) {
    return 0;
  }

  return clamp(n / 100, 0, 1);
}

function snap01(x) {
  const v = Number(x);

  if (!Number.isFinite(v)) {
    return 0;
  }

  if (v <= 0.01) return 0;
  if (v >= 0.99) return 1;

  return v;
}

function round(v, d = 4) {
  const p = Math.pow(10, d);

  return Math.round(Number(v) * p) / p;
}

// --------------------------------------------
// BASE FIELD FACTORS
// --------------------------------------------
function mapFactors(
  soilWetness0_100,
  drainageIndex0_100,
  sm010
) {
  const soilHold =
    snap01(
      safePct01(soilWetness0_100)
    );

  const drainPoor =
    snap01(
      safePct01(drainageIndex0_100)
    );

  const smN =
    sm010 === null ||
    sm010 === undefined ||
    !Number.isFinite(Number(sm010))
      ? 0
      : clamp(
          (Number(sm010) - 0.1) / 0.25,
          0,
          1
        );

  // Higher number = more drydown per day.
  // Balanced so dry fields can recover but wet/poor fields still hold.
  const dryMult =
    clamp(
      1.22 -
        0.36 * soilHold -
        0.44 * drainPoor,
      0.34,
      1.22
    );

  // Storage capacity still increases with heavier/wetter soils.
  const SmaxBase =
    2.3 +
      1.55 * soilHold +
      1.7 * drainPoor;

  const Smax =
    clamp(
      SmaxBase,
      2.3,
      5.6
    );

  // Balanced infiltration baseline.
  // Higher than the sticky version, lower than the original fast-dry version.
  const infilBase =
    clamp(
      1.08 -
        0.30 * soilHold -
        0.38 * drainPoor,
      0.32,
      1.08
    );

  console.log("🧪 MAP FACTORS:", {
    soilWetness0_100,
    drainageIndex0_100,

    soilHold: round(soilHold),
    drainPoor: round(drainPoor),

    dryMult: round(dryMult),
    Smax: round(Smax),
    infilBase: round(infilBase)
  });

  return {
    soilHold,
    drainPoor,

    smN,

    dryMult,

    Smax,
    SmaxBase,

    infilBase: round(infilBase)
  };
}

// --------------------------------------------
// DYNAMIC INFILTRATION
// --------------------------------------------
function dynamicInfiltration({
  storage = 0,
  surface = 0,
  rain = 0,
  factors = {}
}) {
  const Smax =
    Number(factors.Smax || 4);

  const infilBase =
    Number(factors.infilBase || 0.9);

  const soilHold =
    Number(factors.soilHold || 0);

  const drainPoor =
    Number(factors.drainPoor || 0);

  const sat =
    Smax > 0
      ? clamp(storage / Smax, 0, 1.25)
      : 0;

  const surfaceN =
    clamp(Number(surface || 0) / 1.5, 0, 1);

  // Still suppresses infiltration when surface is wet,
  // but not enough to trap surface water for days.
  const surfacePenalty =
    clamp(
      surfaceN *
        (0.18 + 0.16 * drainPoor),
      0,
      0.40
    );

  // Balanced saturation collapse.
  const saturationCollapse =
    Math.pow(
      clamp(sat, 0, 1),
      1.15 + 0.65 * drainPoor
    ) *
    (0.34 + 0.22 * drainPoor);

  // Restored some dry boost so fields can recover normally.
  const dryBoost =
    (1 - clamp(sat, 0, 1)) *
    (
      0.24 +
      0.14 * (1 - soilHold) +
      0.10 * (1 - drainPoor)
    );

  // Moderate rains into already moist soil retain more surface water,
  // but this is less severe than the sticky version.
  const rainIntensityPenalty =
    clamp(
      rain / 1.4,
      0,
      0.32
    ) *
    clamp(
      0.30 + sat + 0.35 * drainPoor,
      0,
      1.10
    );

  let infilMult =
    infilBase +
    dryBoost -
    saturationCollapse -
    surfacePenalty -
    rainIntensityPenalty;

  infilMult = clamp(
    infilMult,
    0.12,
    1.15
  );

  const runoffFrac =
    clamp(
      1 - infilMult,
      0.04,
      0.95
    );

  return {
    saturation: round(sat),

    infilMult: round(infilMult),

    runoffFrac: round(runoffFrac),

    surfacePenalty: round(surfacePenalty),

    saturationCollapse: round(saturationCollapse),

    dryBoost: round(dryBoost),

    rainIntensityPenalty: round(rainIntensityPenalty)
  };
}

// --------------------------------------------
// EXPORT
// --------------------------------------------
module.exports = {
  mapFactors,
  dynamicInfiltration
};