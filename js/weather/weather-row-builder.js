// ============================================
// FILE: weather-row-builder.js
// PURPOSE: Build final weather rows (MRMS + cache)
// ============================================

const { mmToIn } = require("../utils/helpers");

function toISO(dateVal) {
  if (!dateVal) return null;
  const d = new Date(dateVal);
  if (isNaN(d)) return null;
  return d.toISOString().slice(0, 10);
}

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

  // ✅ Build MRMS map (normalized dates)
  const map = new Map();
  for (const r of mrmsDoc.mrmsDailySeries30d) {
    const iso = toISO(r.dateISO);
    if (!iso) continue;

    const rainIn = mmToIn(r.rainMm || 0);

    console.log("MRMS MAP ADD", iso, rainIn);

    map.set(iso, rainIn);
  }

  // ✅ Apply MRMS to rows (same normalization)
  return baseRows.map(r => {
    const iso = toISO(r.dateISO);

    const mrmsRain = map.get(iso);

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
