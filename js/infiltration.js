// ============================================
// FILE: /js/infiltration.js
// PURPOSE:
// Calculate field holding/drainage factors
// EXACTLY from the original FarmVista model
// ============================================

// --------------------------------------------
// HELPERS
// --------------------------------------------
function clamp(n, lo, hi) {
  n = Number(n);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function safePct01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return clamp(n / 100, 0, 1);
}

function snap01(x) {
  const v = Number(x);
  if (!Number.isFinite(v)) return 0;
  if (v <= 0.01) return 0;
  if (v >= 0.99) return 1;
  return v;
}

// --------------------------------------------
// MAIN FUNCTION
// --------------------------------------------
function mapFactors(soilWetness0_100, drainageIndex0_100, sm010) {
  const soilHoldRaw = safePct01(soilWetness0_100);
  const drainPoorRaw = safePct01(drainageIndex0_100);

  const soilHold = snap01(soilHoldRaw);
  const drainPoor = snap01(drainPoorRaw);

  const smN =
    sm010 === null || sm010 === undefined || !Number.isFinite(Number(sm010))
      ? 0
      : clamp((Number(sm010) - 0.1) / 0.25, 0, 1);

  const infilMult = 0.6 + 0.3 * soilHold + 0.35 * drainPoor;
  const dryMult = 1.2 - 0.35 * soilHold - 0.4 * drainPoor;

  const SmaxBase = 3.0 + 1.0 * soilHold + 1.0 * drainPoor;
  const Smax = clamp(SmaxBase, 3.0, 5.0);

  return {
    soilHold,
    drainPoor,
    smN,
    infilMult,
    dryMult,
    Smax,
    SmaxBase
  };
}

// --------------------------------------------
// EXPORT
// --------------------------------------------
module.exports = {
  mapFactors
};
