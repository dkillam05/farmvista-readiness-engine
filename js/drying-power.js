// ============================================
// FILE: /js/drying-power.js
// PURPOSE:
// Calculate drying power (DryPwr)
//
// UPDATED:
// ✅ Reweighted DryPwr so temp/wind/sun/cloud drive ~75%
// ✅ RH/VPD/ET0 drive remaining ~25%
// ✅ Stronger drydown response on sunny, warm, windy, low-cloud days
// ✅ Keeps full debug breakdown
// ============================================

// --------------------------------------------
// HELPERS
// --------------------------------------------
function clamp(n, lo, hi) {
  n = Number(n);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// --------------------------------------------
// MAIN FUNCTION
// --------------------------------------------
function calcDryingPower(row) {
  const temp = safeNum(row?.tempF, 0);
  const wind = safeNum(row?.windMph, 0);
  const rh = safeNum(row?.rh, 70);
  const solar = safeNum(row?.solarWm2, 0);

  const vpd =
    row?.vpdKpa === null || row?.vpdKpa === undefined
      ? null
      : Number(row.vpdKpa);

  const cloud =
    row?.cloudPct === null || row?.cloudPct === undefined
      ? null
      : Number(row.cloudPct);

  const et0In =
    row?.et0In === null || row?.et0In === undefined
      ? null
      : Number(row.et0In);

  // --------------------------------------------
  // NORMALIZE
  // --------------------------------------------
  const tempN = clamp((temp - 35) / 40, 0, 1);
  const windN = clamp((wind - 2) / 16, 0, 1);
  const solarN = clamp((solar - 50) / 360, 0, 1);
  const rhN = clamp((rh - 35) / 65, 0, 1);

  const vpdN =
    vpd === null || !Number.isFinite(vpd)
      ? 0
      : clamp(vpd / 2.4, 0, 1);

  const cloudN =
    cloud === null || !Number.isFinite(cloud)
      ? 0.5
      : clamp(cloud / 100, 0, 1);

  const cloudDryN = clamp(1 - cloudN, 0, 1);

  const et0N =
    et0In === null || !Number.isFinite(et0In)
      ? 0
      : clamp(et0In / 0.28, 0, 1);

  // --------------------------------------------
  // CORE WEATHER DRIVERS ≈ 75%
  // temp + wind + sun + clear sky
  // --------------------------------------------
  const weatherCore =
    0.28 * tempN +
    0.20 * windN +
    0.22 * solarN +
    0.05 * cloudDryN;

  // --------------------------------------------
  // SECONDARY ATMOSPHERIC DRIVERS ≈ 25%
  // RH + VPD + ET0
  // --------------------------------------------
  const atmosphere =
    0.13 * (1 - rhN) +
    0.08 * vpdN +
    0.04 * et0N;

  const rawBase =
    weatherCore + atmosphere;

  const dryPwr =
    clamp(rawBase, 0, 1);

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

    cloud: Number.isFinite(cloud) ? cloud : null,
    cloudN,
    cloudDryN,

    et0In: Number.isFinite(et0In) ? et0In : 0,
    et0N,

    weatherCore,
    atmosphere,

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