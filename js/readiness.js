// ============================================
// FILE: /js/readiness.js
// PURPOSE:
// Convert soil storage + surface wetness into
// final field readiness score
// ============================================

const { surfacePenaltyFromStorage } = require("./surface-model");

// --------------------------------------------
// HELPERS
// --------------------------------------------
function clamp(n, lo, hi) {
  n = Number(n);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function round(v, d = 2) {
  const p = Math.pow(10, d);
  return Math.round(Number(v) * p) / p;
}

// --------------------------------------------
// READINESS CREDIT FROM SMAX
// Same logic from old model
// --------------------------------------------
const SMAX_MIN = 3.0;
const SMAX_MAX = 5.0;
const SMAX_MID = 4.0;
const REV_POINTS_MAX = 20;

function signedCreditInchesFromSmax(Smax) {
  const s = clamp(Number(Smax), SMAX_MIN, SMAX_MAX);
  const signed = clamp((SMAX_MID - s) / 1.0, -1, 1);
  return signed * ((REV_POINTS_MAX / 100) * s);
}

// --------------------------------------------
// MAIN READINESS CALC
// --------------------------------------------
function calculateReadiness(modelResult, opts = {}) {
  if (!modelResult || !modelResult.factors) {
    return null;
  }

  const Smax = Number(modelResult.factors.Smax || 4);
  const storageFinal = Number(modelResult.storageFinal || 0);
  const surfaceFinal = Number(modelResult.surfaceFinal || 0);

  const globalStorageMult = Number.isFinite(Number(opts.globalStorageMult))
    ? Number(opts.globalStorageMult)
    : 1.0;

  const readinessCreditIn = signedCreditInchesFromSmax(Smax);

  const storageForReadiness = clamp(
    storageFinal * globalStorageMult - readinessCreditIn,
    0,
    Smax
  );

  const baseWetness =
    Smax > 0 ? clamp((storageForReadiness / Smax) * 100, 0, 100) : 0;

  const baseReadiness = clamp(100 - baseWetness, 0, 100);

  const surfacePenalty = surfacePenaltyFromStorage(surfaceFinal);

  const readiness = clamp(baseReadiness - surfacePenalty, 0, 100);
  const wetness = clamp(100 - readiness, 0, 100);

  return {
    readiness,
    readinessR: Math.round(readiness),

    wetness,
    wetnessR: Math.round(wetness),

    baseReadiness,
    baseReadinessR: Math.round(baseReadiness),

    surfacePenalty,
    surfacePenaltyR: Math.round(surfacePenalty),

    storageFinal: round(storageFinal, 4),
    surfaceStorageFinal: round(surfaceFinal, 4),
    storageForReadiness: round(storageForReadiness, 4),
    readinessCreditIn: round(readinessCreditIn, 4),

    globalStorageMultApplied: round(globalStorageMult, 6),
    Smax: round(Smax, 4)
  };
}

// --------------------------------------------
// EXPORT
// --------------------------------------------
module.exports = {
  calculateReadiness,
  signedCreditInchesFromSmax
};
