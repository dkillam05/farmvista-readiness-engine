// ============================================
// FILE: /js/readiness.js
// PURPOSE:
// Convert soil storage + surface wetness into
// final field readiness score
//
// UPDATED:
// ✅ Added recent MRMS rainfall operational shock
// ✅ Very recent rain now suppresses readiness harder
// ✅ Standing-water situations handled more realistically
// ✅ Keeps existing readiness structure intact
// ✅ NEW: Stronger surface wetness influence
// ✅ NEW: Surface persistence now properly impacts readiness
//
// IMPORTANT:
// Surface wetness traces are now more persistent.
//
// Previous readiness math underweighted
// surface wetness because the operational
// penalty scale assumed a much larger
// surface storage range.
//
// This update:
// - strengthens surface impact
// - increases operational realism
// - lowers overly-high readiness scores
// after meaningful rainfall
// ============================================

const {
  surfacePenaltyFromStorage,
  recentRainShockPenalty
} = require("./surface-model");

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

  const soilCentered =
    (soilHold - 0.5) * 2;

  const drainCentered =
    (drainPoor - 0.5) * 2;

  const soilPts =
    soilCentered * -18;

  const drainPts =
    drainCentered * -12;

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
  // STORAGE CREDIT
  // --------------------------------------------
  const readinessCreditIn =
    signedCreditInchesFromSmax(
      Smax
    );

  // --------------------------------------------
  // STORAGE FOR READINESS
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
  // BASE WETNESS
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
  // SLIDER BIAS
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
  // SURFACE PENALTY
  //
  // UPDATED:
  // Surface persistence now impacts
  // readiness much more realistically.
  //
  // Previously:
  // surface traces became believable,
  // but readiness stayed unrealistically high.
  //
  // This multiplier increases operational
  // sensitivity to wet surface conditions.
  // --------------------------------------------
  const surfacePenaltyRaw =
    surfacePenaltyFromStorage(
      surfaceFinal
    );

  const surfacePenalty =
    surfacePenaltyRaw * 1.65;

  // --------------------------------------------
  // RECENT RAIN SHOCK
  //
  // Strongest:
  // - last 3h
  //
  // Medium:
  // - last 6h
  //
  // Light:
  // - last 12h
  //
  // This handles:
  // - standing water
  // - active rain
  // - freshly wet conditions
  // --------------------------------------------
  const recentRainPenalty =
    recentRainShockPenalty({

      recentRain3hIn:
        Number(opts.recentRain3hIn || 0),

      recentRain6hIn:
        Number(opts.recentRain6hIn || 0),

      recentRain12hIn:
        Number(opts.recentRain12hIn || 0)
    });

  // --------------------------------------------
  // FINAL READINESS
  // --------------------------------------------
  const readiness =
    clamp(
      baseReadiness -
        surfacePenalty -
        recentRainPenalty,
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

    surfacePenalty:
      round(surfacePenalty, 4),

    surfacePenaltyR:
      Math.round(surfacePenalty),

    surfacePenaltyRaw:
      round(surfacePenaltyRaw, 4),

    recentRainPenalty:
      round(recentRainPenalty, 4),

    recentRainPenaltyR:
      Math.round(recentRainPenalty),

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