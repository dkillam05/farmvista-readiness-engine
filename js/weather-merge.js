// ============================================
// FILE: /js/weather-merge.js
// PURPOSE:
// Merge Open-Meteo weather + MRMS rainfall
// into FINAL model-ready rows
//
// IMPORTANT RULES:
// ✔ Historical rainfall = MRMS
// ✔ Forecast rainfall = Open-Meteo
// ✔ Preserve ALL weather fields
// ✔ Do NOT reshape schema
// ✔ Do NOT collapse rows
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
  return String(str).slice(0, 13);
}

function safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function getTodayISO() {
  return new Date().toISOString().slice(0, 10);
}

// --------------------------------------------
// MRMS DAILY MAP
// --------------------------------------------
function buildMrmsDailyMap(mrmsDoc) {
  const map = new Map();

  const rows = Array.isArray(
    mrmsDoc?.mrmsDailySeries30d
  )
    ? mrmsDoc.mrmsDailySeries30d
    : [];

  for (const r of rows) {
    const iso = toISODate(r?.dateISO);

    if (!iso) continue;

    map.set(iso, {
      rainIn: mmToIn(r?.rainMm),
      rainMm: safeNum(r?.rainMm),
      hoursCount: safeNum(r?.hoursCount)
    });
  }

  return map;
}

// --------------------------------------------
// MRMS HOURLY MAP
// --------------------------------------------
function buildMrmsHourlyMap(mrmsDoc) {
  const map = new Map();

  const rows = Array.isArray(
    mrmsDoc?.mrmsHourlyLast24
  )
    ? mrmsDoc.mrmsHourlyLast24
    : [];

  for (const r of rows) {
    const ts = r?.fileTimestampUtc;

    if (!ts) continue;

    const isoHour = toISOHour(ts);

    map.set(isoHour, {
      rainIn: mmToIn(r?.rainMm),
      rainMm: safeNum(r?.rainMm)
    });
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

  const todayISO = getTodayISO();

  return baseRows.map((r) => {
    const iso = toISODate(r?.dateISO);

    const isForecast = iso > todayISO;

    const mrms = mrmsDaily.get(iso);

    // --------------------------------------------
    // RAINFALL SOURCE LOGIC
    // --------------------------------------------
    let rainIn = safeNum(r?.rainIn);

    let rainSource = "open-meteo";

    let rainMrmsIn = null;

    let rainOpenMeteoIn = safeNum(r?.rainIn);

    // Historical + today = MRMS
    if (!isForecast && mrms) {
      rainIn = safeNum(mrms.rainIn);

      rainMrmsIn = safeNum(mrms.rainIn);

      rainSource = "mrms";
    }

    // Forecast = Open-Meteo
    if (isForecast) {
      rainSource = "open-meteo-forecast";
    }

    // --------------------------------------------
    // IMPORTANT:
    // preserve ALL original fields
    // --------------------------------------------
    return {
      ...r,

      dateISO: iso,

      // FINAL rain used by model
      rainIn,

      // DEBUG / TRANSPARENCY
      rainMrmsIn,
      rainOpenMeteoIn,

      rainSource
    };
  });
}

// --------------------------------------------
// HOURLY MERGE
// --------------------------------------------
function mergeHourly(wx, mrmsDoc) {
  const baseRows = Array.isArray(wx?.hourlyToday)
    ? wx.hourlyToday
    : [];

  const mrmsHourly = buildMrmsHourlyMap(mrmsDoc);

  return baseRows.map((r) => {
    const isoHour = toISOHour(
      r?.timeISO || r?.time
    );

    const mrms = mrmsHourly.get(isoHour);

    let rainIn = safeNum(r?.rainIn);

    let rainSource = "open-meteo";

    let rainMrmsIn = null;

    let rainOpenMeteoIn = safeNum(r?.rainIn);

    // --------------------------------------------
    // USE MRMS FOR CURRENT DAY HOURLY
    // --------------------------------------------
    if (mrms) {
      rainIn = safeNum(mrms.rainIn);

      rainMrmsIn = safeNum(mrms.rainIn);

      rainSource = "mrms-hourly";
    }

    return {
      ...r,

      timeISO: r?.timeISO || null,

      rainIn,

      rainMrmsIn,
      rainOpenMeteoIn,

      rainSource
    };
  });
}

// --------------------------------------------
// MAIN MERGE
// --------------------------------------------
function mergeWeather(wx, mrmsDoc) {
  const daily = mergeDaily(wx, mrmsDoc);

  const hourly = mergeHourly(wx, mrmsDoc);

  return {
    daily,
    hourly
  };
}

// --------------------------------------------
// EXPORT
// --------------------------------------------
module.exports = {
  mergeWeather
};