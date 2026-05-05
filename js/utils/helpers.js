// ============================================
// FILE: helpers.js
// PURPOSE: Shared utilities
// ============================================

function num(v, d = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function clamp(n, lo, hi) {
  n = Number(n);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function round(v, d = 2) {
  const p = Math.pow(10, d);
  return Math.round(Number(v) * p) / p;
}

function safeStr(x) {
  return String(x || "");
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mmToIn(mm) {
  return Number(mm || 0) / 25.4;
}

module.exports = { num, clamp, round, safeStr, safeNum, mmToIn };
