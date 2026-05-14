// ============================================
// FILE: /js/readiness.js
// PURPOSE:
// Convert soil storage + surface wetness into
// final field readiness score
//
// UPDATED:
// ✅ Stronger slider influence
// ✅ Soil wetness now materially affects readiness
// ✅ Drainage index now materially affects readiness
// ✅ Preserves weather-driven model behavior
// ✅ Keeps same payload structure/UI contract
// ============================================

const { surfacePenaltyFromStorage } = require("./surface-model");

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

function round(v, d = 2) {
  const p = Math.pow(10, d);

  return Math.round(Number(v) * p) / p;
}

// --------------------------------------------
// READINESS CREDIT FROM SMAX
// --------------------------------------------
const SMAX_MIN = 3.0;
const SMAX_MAX = 5.0;
const SMAX_MID = 4.0;
const REV_POINTS_MAX = 20;

function signedCreditInchesFromSmax(Smax) {
  const s = clamp(
    Number(Smax),
    SMAX_MIN,
    SMAX_MAX
  );

  const signed = clamp(
    (SMAX_MID - s) / 1.0,
    -1,
    1
  );

  return signed * (
    (REV_POINTS_MAX / 100) * s
  );
}

// --------------------------------------------
// SLIDER BIAS
//
// 50 = neutral
// dry/well-drained => boosts readiness
// wet/poor-drainage => lowers readiness
// --------------------------------------------
function sliderBiasPoints(factors = {}) {

  const soilHold =
    clamp(
      Number(factors.soilHold ?? 0.5),
      0,
      1
    );

  const drainPoor =
    clamp(
      Number(factors.drainPoor ?? 0.5),
      0,
      1
    );

  // --------------------------------------------
  // Convert to centered values
  // --------------------------------------------
  const soilCentered =
    (soilHold - 0.5) * 2;

  const drainCentered =
    (drainPoor - 0.5) * 2;

  // --------------------------------------------
  // Wet soil hurts more
  // than drainage alone
  // --------------------------------------------
  const soilPts =
    soilCentered * -18;

  const drainPts =
    drainCentered * -12;

  // --------------------------------------------
  // Combined cap
  // --------------------------------------------
  return clamp(
    soilPts + drainPts,
    -25,
    25
  );
}

// --------------------------------------------
// MAIN READINESS CALC
// --------------------------------------------
function calculateReadiness(
  modelResult,
  opts = {}
) {

  if (
    !modelResult ||
    !modelResult.factors
  ) {
    return null;
  }

  const factors =
    modelResult.factors || {};

  const Smax =
    Number(factors.Smax || 4);

  const storageFinal =
    Number(
      modelResult.storageFinal || 0
    );

  const surfaceFinal =
    Number(
      modelResult.surfaceFinal || 0
    );

  const globalStorageMult =
    Number.isFinite(
      Number(opts.globalStorageMult)
    )
      ? Number(opts.globalStorageMult)
      : 1.0;

  // --------------------------------------------
  // Existing model credit
  // --------------------------------------------
  const readinessCreditIn =
    signedCreditInchesFromSmax(
      Smax
    );

  // --------------------------------------------
  // Existing storage logic
  // --------------------------------------------
  const storageForReadiness =
    clamp(
      (
        storageFinal *
        globalStorageMult
      ) - readinessCreditIn,
      0,
      Smax
    );

  // --------------------------------------------
  // Base wetness from storage
  // --------------------------------------------
  const baseWetness =
    Smax > 0
      ? clamp(
          (
            storageForReadiness /
            Smax
          ) * 100,
          0,
          100
        )
      : 0;

  let baseReadiness =
    clamp(
      100 - baseWetness,
      0,
      100
    );

  // --------------------------------------------
  // NEW:
  // Slider influence
  // --------------------------------------------
  const sliderBias =
    sliderBiasPoints(factors);

  baseReadiness =
    clamp(
      baseReadiness + sliderBias,
      0,
      100
    );

  // --------------------------------------------
  // Surface penalty
  // --------------------------------------------
  const surfacePenalty =
    surfacePenaltyFromStorage(
      surfaceFinal
    );

  const readiness =
    clamp(
      baseReadiness -
        surfacePenalty,
      0,
      100
    );

  const wetness =
    clamp(
      100 - readiness,
      0,
      100
    );

  return {

    readiness,
    readinessR:
      Math.round(readiness),

    wetness,
    wetnessR:
      Math.round(wetness),

    baseReadiness,
    baseReadinessR:
      Math.round(baseReadiness),

    surfacePenalty,
    surfacePenaltyR:
      Math.round(surfacePenalty),

    storageFinal:
      round(storageFinal, 4),

    surfaceStorageFinal:
      round(surfaceFinal, 4),

    storageForReadiness:
      round(
        storageForReadiness,
        4
      ),

    readinessCreditIn:
      round(
        readinessCreditIn,
        4
      ),

    globalStorageMultApplied:
      round(
        globalStorageMult,
        6
      ),

    sliderBias:
      round(sliderBias, 4),

    Smax:
      round(Smax, 4)
  };
}

// --------------------------------------------
// EXPORT
// --------------------------------------------
module.exports = {
  calculateReadiness,
  signedCreditInchesFromSmax
};