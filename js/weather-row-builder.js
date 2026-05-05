// ================================
// FILE: weather-row-builder.js
// PURPOSE: Clean MRMS + Forecast merge
// ================================

function buildWeatherRows(wxDoc, mrmsDoc, timezone) {
  const baseRows = Array.isArray(wxDoc?.dailySeries)
    ? wxDoc.dailySeries.slice()
    : [];

  if (!baseRows.length) return [];

  const todayISO = new Date().toISOString().slice(0, 10);

  const mrmsMap = buildMrmsDailyMapRows(mrmsDoc);

  return baseRows.map((r) => {
    const iso = String(r?.dateISO || "").slice(0, 10);

    const isPast = iso < todayISO;
    const mrms = mrmsMap.get(iso);

    // ✅ PAST → USE MRMS IF AVAILABLE
    if (isPast && mrms) {
      return {
        ...r,
        rainInAdj: mrms.rainIn,
        rainSource: "mrms",
        rainMrmsIn: mrms.rainIn,
        rainMrmsMm: mrms.rainMm,
        mrmsHoursCount: mrms.hoursCount
      };
    }

    // ✅ TODAY + FUTURE → OPEN METEO
    return {
      ...r,
      rainInAdj: r.rainIn,
      rainSource: "open-meteo"
    };
  });
}

module.exports = { buildWeatherRows };
