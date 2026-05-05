// ================================
// FILE: utils/helpers.js
// PURPOSE: Helpers
// ================================

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, Number(n)));
}

function round(v, d = 2) {
  const p = Math.pow(10, d);
  return Math.round(Number(v) * p) / p;
}

module.exports = { clamp, round };
