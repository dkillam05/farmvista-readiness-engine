// ============================================
// FILE: /js/infiltration.js
// PURPOSE:
// Dynamic infiltration + holding/drainage factors
// for FarmVista readiness model
//
// UPDATED:
// ✅ Slower, more realistic infiltration ceiling
// ✅ Less dry-soil over-boosting
// ✅ Repeated wetness / surface water suppresses infiltration
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
  // Reduced from old max 1.45 because fields were drying too fast.
  const dryMult =
    clamp(
      1.15 -
        0.34 * soilHold -
        0.42 * drainPoor,
      0.32,
      1.15
    );

  // Storage capacity still increases with heavier/wetter soils.
  const SmaxBase =
    2.4 +
      1.55 * soilHold +
      1.65 * drainPoor;

  const Smax =
    clamp(
      SmaxBase,
      2.4,
      5.6
    );

  // Reduced infiltration ceiling.
  // Old system could sit at 1.35 too often.
  // This version makes dry fields infiltrate, but not instantly erase surface wetness.
  const infilBase =
    clamp(
      0.95 -
        0.28 * soilHold -
        0.36 * drainPoor,
      0.24,
      0.95
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
    Number(factors.infilBase || 0.75);

  const soilHold =
    Number(factors.soilHold || 0);

  const drainPoor =
    Number(factors.drainPoor || 0);

  const sat =
    Smax > 0
      ? clamp(storage / Smax, 0, 1.25)
      : 0;

  const surfaceN =
    clamp(Number(surface || 0) / 1.25, 0, 1);

  // Stronger penalty when surface is already wet.
  const surfacePenalty =
    clamp(
      surfaceN *
        (0.22 + 0.18 * drainPoor),
      0,
      0.45
    );

  // Saturation collapse starts earlier and is stronger.
  const saturationCollapse =
    Math.pow(
      clamp(sat, 0, 1),
      1.10 + 0.65 * drainPoor
    ) *
    (0.42 + 0.26 * drainPoor);

  // Dry boost reduced heavily.
  // Old boost was too eager and pinned infilMult at max.
  const dryBoost =
    (1 - clamp(sat, 0, 1)) *
    (
      0.16 +
      0.10 * (1 - soilHold) +
      0.08 * (1 - drainPoor)
    );

  // Moderate rains into already moist soil should not all disappear downward.
  const rainIntensityPenalty =
    clamp(
      rain / 1.25,
      0,
      0.34
    ) *
    clamp(
      0.35 + sat + 0.45 * drainPoor,
      0,
      1.25
    );

  let infilMult =
    infilBase +
    dryBoost -
    saturationCollapse -
    surfacePenalty -
    rainIntensityPenalty;

  infilMult = clamp(
    infilMult,
    0.05,
    1.05
  );

  // Runoff / surface retention is now based on reduced infiltration.
  const runoffFrac =
    clamp(
      1 - infilMult,
      0.08,
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