// ============================================
// FILE: /js/infiltration.js
// PURPOSE:
// Dynamic infiltration + holding/drainage factors
// for FarmVista readiness model
//
// NEW:
// ✅ Dynamic infiltration based on saturation
// ✅ Dry soils absorb rainfall faster
// ✅ Saturated soils infiltrate slower
// ✅ Surface water suppresses infiltration
// ✅ Poor drainage increases saturation sensitivity
// ✅ Sandy/tiled soils infiltrate aggressively
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
// STATIC FIELD CHARACTERISTICS
// --------------------------------------------
function mapFactors(
  soilWetness0_100,
  drainageIndex0_100,
  sm010
) {
  const soilHoldRaw =
    safePct01(soilWetness0_100);

  const drainPoorRaw =
    safePct01(drainageIndex0_100);

  const soilHold =
    snap01(soilHoldRaw);

  const drainPoor =
    snap01(drainPoorRaw);

  // --------------------------------------------
  // OPEN-METEO SOIL MOISTURE NORMALIZATION
  // --------------------------------------------
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

  // --------------------------------------------
  // STATIC FIELD CHARACTERISTICS
  // --------------------------------------------

  // Higher = slower drying
  const dryMult =
    1.2 -
    0.35 * soilHold -
    0.4 * drainPoor;

  // Field storage capacity
  const SmaxBase =
    3.0 +
    1.0 * soilHold +
    1.0 * drainPoor;

  const Smax =
    clamp(SmaxBase, 3.0, 5.0);

  // Base infiltration potential
  // Sandy/tiled fields higher
  // Tight/wet fields lower
  const infilBase =
    1.15 -
    0.30 * soilHold -
    0.35 * drainPoor;

  return {
    soilHold,
    drainPoor,

    smN,

    dryMult,

    Smax,
    SmaxBase,

    infilBase: round(
      clamp(infilBase, 0.35, 1.25)
    )
  };
}

// --------------------------------------------
// DYNAMIC INFILTRATION
// THIS IS THE IMPORTANT NEW PART
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
    Number(factors.infilBase || 1);

  const soilHold =
    Number(factors.soilHold || 0);

  const drainPoor =
    Number(factors.drainPoor || 0);

  // --------------------------------------------
  // SATURATION RATIO
  // --------------------------------------------
  const sat =
    Smax > 0
      ? clamp(storage / Smax, 0, 1.25)
      : 0;

  // --------------------------------------------
  // SURFACE SATURATION EFFECT
  // Ponding strongly suppresses infiltration
  // --------------------------------------------
  const surfacePenalty =
    clamp(surface / 2.5, 0, 0.75);

  // --------------------------------------------
  // SATURATION COLLAPSE
  // As soils saturate, infiltration falls off
  // rapidly especially in poorly drained soils
  // --------------------------------------------
  const saturationCollapse =
    Math.pow(
      sat,
      1.35 + 0.9 * drainPoor
    );

  // --------------------------------------------
  // DRY SOIL BOOST
  // Dry soils aggressively absorb water
  // especially sandy/tiled soils
  // --------------------------------------------
  const dryBoost =
    (1 - sat) *
    (
      0.45 +
      0.25 * (1 - soilHold) +
      0.20 * (1 - drainPoor)
    );

  // --------------------------------------------
  // HEAVY RAIN RUNOFF EFFECT
  // Big rainfall events exceed intake rates
  // especially on saturated fields
  // --------------------------------------------
  const rainIntensityPenalty =
    clamp(
      rain / 2.5,
      0,
      0.45
    ) * sat;

  // --------------------------------------------
  // FINAL INFILTRATION
  // --------------------------------------------
  let infilMult =
    infilBase +
    dryBoost -
    saturationCollapse -
    surfacePenalty -
    rainIntensityPenalty;

  infilMult = clamp(
    infilMult,
    0.05,
    1.35
  );

  // --------------------------------------------
  // RUNOFF FRACTION
  // --------------------------------------------
  const runoffFrac =
    clamp(
      1 - infilMult,
      0,
      0.95
    );

  return {
    saturation: round(sat),

    infilMult: round(infilMult),

    runoffFrac: round(runoffFrac),

    surfacePenalty: round(surfacePenalty),

    saturationCollapse: round(
      saturationCollapse
    ),

    dryBoost: round(dryBoost),

    rainIntensityPenalty: round(
      rainIntensityPenalty
    )
  };
}

// --------------------------------------------
// EXPORT
// --------------------------------------------
module.exports = {
  mapFactors,
  dynamicInfiltration
};