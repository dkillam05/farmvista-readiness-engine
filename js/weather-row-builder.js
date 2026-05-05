// ================================
// FILE: weather-row-builder.js
// PURPOSE: Clean MRMS + Forecast merge (FIXED - TRUE MRMS OVERRIDE)
// ================================

function buildMrmsDailyMapRows(mrmsDoc) {
  const map = new Map();

  const rows = Array.isArray(mrmsDoc?.mrmsDailySeries30d)
    ? mrmsDoc.mrmsDailySeries30d
    : [];

  for (const r of rows) {
    const iso = String(r?.dateISO || "").slice(0, 10);
    if (!iso) continue;

    const rainMm = Number(r?.rainMm || 0);
    const rainIn = rainMm / 25.4;

    map.set(iso, {
      dateISO: iso,
      rainMm,
      rainIn,
      hoursCount: Number(r?.hoursCount || 0)
    });
  }

  return map;
}

function buildWeatherRows(wxDoc, mrmsDoc, timezone) {
  const baseRows = Array.isArray(wxDoc?.dailySeries)
    ? wxDoc.dailySeries.slice()
    : [];

  if (!baseRows.length) return [];

  const todayISO = new Date().toISOString().slice(0, 10);

  const mrmsMap = buildMrmsDailyMapRows(mrmsDoc);

  return baseRows.map((r) => {
    const iso = String(r?.dateISO || "").slice(0, 10);

    const isFuture = iso > todayISO;
    const mrms = mrmsMap.get(iso);

    // ✅ PAST + TODAY → FORCE MRMS (FULL OVERRIDE)
    if (!isFuture && mrms) {
      return {
        ...r,

        // 🔥 HARD OVERRIDE (THIS WAS MISSING)
        rainIn: mrms.rainIn,
        rainInAdj: mrms.rainIn,

        // keep breakdown if you want
        rainMorningIn: 0,
        rainMiddayIn: 0,
        rainEveningIn: mrms.rainIn,

        // metadata
        rainSource: "mrms",
        rainMrmsIn: mrms.rainIn,
        rainMrmsMm: mrms.rainMm,
        mrmsHoursCount: mrms.hoursCount
      };
    }

    // ✅ FUTURE → FORECAST
    return {
      ...r,
      rainIn: r.rainIn,
      rainInAdj: r.rainIn,
      rainSource: "open-meteo"
    };
  });
}

module.exports = { buildWeatherRows };
