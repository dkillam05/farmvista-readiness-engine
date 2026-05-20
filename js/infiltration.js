// ============================================
// FILE: /js/infiltration.js
// PURPOSE:
// Dynamic infiltration + holding/drainage factors
// for FarmVista readiness model
//
// SLIDER MEANING:
// ✅ soilWetness:   0 = dry/light soil, 100 = wet/heavy holding soil
// ✅ drainageIndex: 0 = well-drained, 100 = poorly drained
//
// FIXED:
// ✅ Higher soilWetness now dries SLOWER
// ✅ Higher drainageIndex now dries SLOWER
// ✅ 0/0 now behaves like dry, well-drained ground
// ✅ 100/100 now behaves like wet, poorly drained ground
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

  // --------------------------------------------
  // DRYING MULTIPLIER
  //
  // IMPORTANT:
  // Higher number = MORE drydown per day.
  //
  // 0/0 = dry + well drained = dries fastest
  // 100/100 = wet + poor drainage = dries slowest
  // --------------------------------------------
  const dryMult =
    clamp(
      1.45 -
        0.45 * soilHold -
        0.55 * drainPoor,
      0.35,
      1.45
    );

  // --------------------------------------------
  // STORAGE CAPACITY
  //
  // 0/0 = low holding capacity
  // 100/100 = high holding capacity
  // --------------------------------------------
  const SmaxBase =
    2.2 +
      1.6 * soilHold +
      1.8 * drainPoor;

  const Smax =
    clamp(
      SmaxBase,
      2.2,
      5.6
    );

  // --------------------------------------------
  // BASE INFILTRATION
  //
  // 0/0 = aggressive infiltration
  // 100/100 = slower infiltration
  // --------------------------------------------
  const infilBase =
    clamp(
      1.35 -
        0.45 * soilHold -
        0.50 * drainPoor,
      0.30,
      1.35
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
    Number(factors.infilBase || 1);

  const soilHold =
    Number(factors.soilHold || 0);

  const drainPoor =
    Number(factors.drainPoor || 0);

  const sat =
    Smax > 0
      ? clamp(storage / Smax, 0, 1.25)
      : 0;

  const surfacePenalty =
    clamp(surface / 2.5, 0, 0.75);

  const saturationCollapse =
    Math.pow(
      sat,
      1.35 + 0.9 * drainPoor
    );

  const dryBoost =
    (1 - sat) *
    (
      0.45 +
      0.25 * (1 - soilHold) +
      0.20 * (1 - drainPoor)
    );

  const rainIntensityPenalty =
    clamp(
      rain / 2.5,
      0,
      0.45
    ) * sat;

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