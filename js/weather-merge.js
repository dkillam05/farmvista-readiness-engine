// ============================================
// FILE: /js/weather-merge.js
// PURPOSE:
// Merge weather cache + MRMS rainfall into
// clean daily + hourly rows for readiness model
// ============================================

// --------------------------------------------
// HELPERS
// --------------------------------------------
function mmToIn(mm) {
  return (Number(mm) || 0) / 25.4;
}

function toISODate(str) {
  if (!str) return null;
  return String(str).slice(0, 10);
}

function toISOHour(str) {
  if (!str) return null;
  return String(str).slice(0, 13); // YYYY-MM-DDTHH
}

// --------------------------------------------
// MRMS DAILY MAP
// --------------------------------------------
function buildMrmsDailyMap(mrmsDoc) {
  const map = new Map();

  const rows = Array.isArray(mrmsDoc?.mrmsDailySeries30d)
    ? mrmsDoc.mrmsDailySeries30d
    : [];

  for (const r of rows) {
    const iso = toISODate(r.dateISO);
    if (!iso) continue;

    map.set(iso, mmToIn(r.rainMm));
  }

  return map;
}

// --------------------------------------------
// MRMS HOURLY MAP (TODAY)
// --------------------------------------------
function buildMrmsHourlyMap(mrmsDoc) {
  const map = new Map();

  const rows = Array.isArray(mrmsDoc?.mrmsHourlyLast24)
    ? mrmsDoc.mrmsHourlyLast24
    : [];

  for (const r of rows) {
    const ts = r.fileTimestampUtc;
    if (!ts) continue;

    const isoHour = toISOHour(ts);
    map.set(isoHour, mmToIn(r.rainMm));
  }

  return map;
}

// --------------------------------------------
// DAILY MERGE
// --------------------------------------------
function mergeDaily(wx, mrmsDoc) {
  const baseRows = Array.isArray(wx?.dailySeries)
    ? wx.dailySeries
    : [];

  const mrmsDaily = buildMrmsDailyMap(mrmsDoc);

  return baseRows.map((r) => {
    const iso = toISODate(r.dateISO);

    const rainIn = mrmsDaily.has(iso)
      ? mrmsDaily.get(iso)
      : (r.rainIn || 0);

    return {
      dateISO: iso,
      rainIn,
      tempAvg: r.tempAvg ?? null,
      tempMax: r.tempMax ?? null,
      tempMin: r.tempMin ?? null,
      humidity: r.humidity ?? null,
      wind: r.wind ?? null,
      solar: r.solar ?? null,
      rainSource: mrmsDaily.has(iso) ? "mrms-daily" : "weather"
    };
  });
}

// --------------------------------------------
// HOURLY MERGE (CRITICAL FOR TODAY)
// --------------------------------------------
function mergeHourly(wx, mrmsDoc) {
  const baseRows = Array.isArray(wx?.hourlySeries)
    ? wx.hourlySeries
    : [];

  const mrmsHourly = buildMrmsHourlyMap(mrmsDoc);

  return baseRows.map((r) => {
    const isoHour = toISOHour(r.time || r.dateTimeISO);

    const rainIn = mrmsHourly.has(isoHour)
      ? mrmsHourly.get(isoHour)
      : (r.rainIn || 0);

    return {
      time: isoHour,
      rainIn,
      temp: r.temp ?? null,
      humidity: r.humidity ?? null,
      wind: r.wind ?? null,
      solar: r.solar ?? null,
      rainSource: mrmsHourly.has(isoHour) ? "mrms-hourly" : "weather"
    };
  });
}

// --------------------------------------------
// MAIN EXPORT
// --------------------------------------------
function mergeWeather(wx, mrmsDoc) {
  const daily = mergeDaily(wx, mrmsDoc);
  const hourly = mergeHourly(wx, mrmsDoc);

  return {
    daily,
    hourly
  };
}

module.exports = {
  mergeWeather
};
