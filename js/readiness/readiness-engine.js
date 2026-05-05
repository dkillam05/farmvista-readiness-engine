// ============================================
// FILE: readiness-engine.js
// PURPOSE: Core readiness calculation
// ============================================

const { clamp } = require("../utils/helpers");

async function runFieldReadinessCoreServer(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;

  let storage = 0;

  for (const r of rows) {
    const rain = Number(r.rainInAdj || 0);
    const dry = 0.08;

    storage = clamp(storage + rain - dry, 0, 5);
  }

  const wetness = clamp((storage / 5) * 100, 0, 100);
  const readiness = clamp(100 - wetness, 0, 100);

  return {
    readinessR: Math.round(readiness),
    wetnessR: Math.round(wetness),
    storageFinal: storage
  };
}

module.exports = { runFieldReadinessCoreServer };
