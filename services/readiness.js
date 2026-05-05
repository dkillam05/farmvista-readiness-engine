// ================================
// FILE: services/readiness.js
// PURPOSE: Readiness model (preserved simple flow)
// ================================

function runFieldReadinessCoreServer(rows, soilWetness, drainageIndex) {
  if (!rows || !rows.length) return null;

  let storage = 1;
  let readiness = 50;

  for (const r of rows) {
    const rain = r.rain || 0;

    // simple behavior placeholder (your real math goes here)
    storage += rain * 0.5;
    storage = Math.max(0, Math.min(5, storage));

    readiness = 100 - (storage * 20);
  }

  return {
    readinessR: Math.round(readiness),
    wetnessR: Math.round(100 - readiness),
    storageFinal: storage
  };
}

module.exports = { runFieldReadinessCoreServer };
