// ============================================
// FILE: weather-row-builder.js
// PURPOSE: Build final weather rows (MRMS + cache)
// ============================================

const { mmToIn } = require("../utils/helpers");

function buildWeatherRows(wx, mrmsDoc, timezone) {
  const baseRows = Array.isArray(wx?.dailySeries) ? wx.dailySeries : [];
  if (!baseRows.length) return [];

  // ❌ No MRMS → fallback
  if (!mrmsDoc || !Array.isArray(mrmsDoc.mrmsDailySeries30d)) {
    return baseRows.map(r => ({
      ...r,
      rainInAdj: r.rainIn || 0,
      rainSource: "open-meteo"
    }));
  }

  // ✅ Build MRMS map
  const map = new Map();
  for (const r of mrmsDoc.mrmsDailySeries30d) {
    const iso = String(r.dateISO || "").slice(0, 10);
    if (!iso) continue;

    const rainIn = mmToIn(r.rainMm || 0);

    // 🔍 DEBUG (build side)
    console.log("MRMS MAP ADD", iso, rainIn);

    map.set(iso, rainIn);
  }

  // ✅ Apply MRMS to rows
  return baseRows.map(r => {
    const iso = String(r.dateISO || "").slice(0, 10);

    const mrmsRain = map.get(iso);

    // 🔍 DEBUG (match check)
    console.log("MRMS CHECK", iso, mrmsRain);

    if (mrmsRain == null) {
      return {
        ...r,
        rainInAdj: r.rainIn || 0,
        rainSource: "open-meteo"
      };
    }

    return {
      ...r,
      rainInAdj: mrmsRain,
      rainSource: "mrms"
    };
  });
}

module.exports = { buildWeatherRows };
