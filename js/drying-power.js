// ============================================
// FILE: /js/drying-power.js
// PURPOSE:
// Calculate drying power (DryPwr) EXACTLY
// as your original model
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
// CONFIG (same as old model)
// --------------------------------------------
const VPD_WEIGHT = 0.06;
const CLOUD_WEIGHT = 0.04;

// --------------------------------------------
// MAIN FUNCTION
// --------------------------------------------
function calcDryingPower(row) {
  // --- RAW INPUTS ---
  const temp = Number(row.tempF || 0);
  const wind = Number(row.windMph || 0);
  const rh = Number(row.rh || 0);
  const solar = Number(row.solarWm2 || 0);

  const vpd = row.vpdKpa === null || row.vpdKpa === undefined
    ? null
    : Number(row.vpdKpa);

  const cloud = row.cloudPct === null || row.cloudPct === undefined
    ? null
    : Number(row.cloudPct);

  // --------------------------------------------
  // NORMALIZE (EXACT SAME AS OLD MODEL)
  // --------------------------------------------
  const tempN = clamp((temp - 20) / 45, 0, 1);
  const windN = clamp((wind - 2) / 20, 0, 1);
  const solarN = clamp((solar - 60) / 300, 0, 1);
  const rhN = clamp((rh - 35) / 65, 0, 1);

  // --------------------------------------------
  // BASE DRYING POWER
  // --------------------------------------------
  const rawBase =
    0.35 * tempN +
    0.30 * solarN +
    0.25 * windN -
    0.25 * rhN;

  let dryPwr = clamp(rawBase, 0, 1);

  // --------------------------------------------
  // VPD + CLOUD ADJUSTMENTS
  // --------------------------------------------
  const vpdN =
    vpd === null || !Number.isFinite(vpd)
      ? 0
      : clamp(vpd / 2.6, 0, 1);

  const cloudN =
    cloud === null || !Number.isFinite(cloud)
      ? 0
      : clamp(cloud / 100, 0, 1);

  dryPwr = clamp(
    dryPwr +
      VPD_WEIGHT * vpdN -
      CLOUD_WEIGHT * cloudN,
    0,
    1
  );

  // --------------------------------------------
  // RETURN FULL OBJECT (same as before)
  // --------------------------------------------
  return {
    temp,
    wind,
    rh,
    solar,

    tempN,
    windN,
    rhN,
    solarN,

    sunshineN: solarN,

    vpd: Number.isFinite(vpd) ? vpd : 0,
    vpdN,

    cloud: Number.isFinite(cloud) ? cloud : 0,
    cloudN,

    raw: rawBase,
    dryPwr
  };
}

// --------------------------------------------
// EXPORT
// --------------------------------------------
module.exports = {
  calcDryingPower
};
