// ================================
// FILE: services/weather-cache.js
// PURPOSE: Fetch + build 30d history + 7d forecast (CORRECT)
// ================================

const db = require("../config/firestore");
const admin = require("firebase-admin");
const { fetchOpenMeteo } = require("./weather-fetch");

// ================================
// DATE HELPERS
// ================================
function getISO(daysOffset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  return d.toISOString().slice(0, 10);
}

// ================================
// BUILD DAILY ROWS FROM HOURLY
// ================================
function buildDailyRows(data) {
  const h = data?.hourly || {};
  const times = h.time || [];

  const map = new Map();

  for (let i = 0; i < times.length; i++) {
    const iso = times[i];
    const dateISO = iso.slice(0, 10);
    const hour = Number(iso.slice(11, 13));

    if (!map.has(dateISO)) {
      map.set(dateISO, {
        dateISO,
        rainIn: 0,
        rainMorningIn: 0,
        rainMiddayIn: 0,
        rainEveningIn: 0,
        tempSum: 0,
        tempCount: 0
      });
    }

    const row = map.get(dateISO);

    const rainMM = h.precipitation?.[i] || 0;
    const rainIn = rainMM / 25.4;

    const tempC = h.temperature_2m?.[i] || 0;
    const tempF = (tempC * 9 / 5) + 32;

    row.rainIn += rainIn;

    if (hour < 11) row.rainMorningIn += rainIn;
    else if (hour < 17) row.rainMiddayIn += rainIn;
    else row.rainEveningIn += rainIn;

    row.tempSum += tempF;
    row.tempCount++;
  }

  const out = [];

  for (const r of map.values()) {
    out.push({
      dateISO: r.dateISO,
      rainIn: r.rainIn,
      rainMorningIn: r.rainMorningIn,
      rainMiddayIn: r.rainMiddayIn,
      rainEveningIn: r.rainEveningIn,
      tempF: r.tempCount ? r.tempSum / r.tempCount : 50,

      windMph: 6,
      rh: 65,
      solarWm2: 180,
      et0In: 0.15,
      sm010: 0.25
    });
  }

  out.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  return out;
}

// ================================
// MAIN FUNCTION
// ================================
async function ensureWeatherCacheForField(field) {

  const lat = field.lat;
  const lng = field.lng;

  const histStart = getISO(-30);
  const histEnd = getISO(-1);
  const fcstEnd = getISO(7);

  // 🔥 TRUE FIX: use correct APIs
  const histUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=${histStart}&end_date=${histEnd}&hourly=temperature_2m,precipitation&timezone=America/Chicago`;

  const fcstUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=temperature_2m,precipitation&forecast_days=7&timezone=America/Chicago`;

  const histData = await fetchOpenMeteo(histUrl);
  const fcstData = await fetchOpenMeteo(fcstUrl);

  // 🔥 MERGE HOURLY DATA
  const merged = {
    hourly: {
      time: [
        ...(histData?.hourly?.time || []),
        ...(fcstData?.hourly?.time || [])
      ],
      temperature_2m: [
        ...(histData?.hourly?.temperature_2m || []),
        ...(fcstData?.hourly?.temperature_2m || [])
      ],
      precipitation: [
        ...(histData?.hourly?.precipitation || []),
        ...(fcstData?.hourly?.precipitation || [])
      ]
    }
  };

  const dailySeries = buildDailyRows(merged);

  await db.collection("field_weather_cache").doc(field.id).set({
    fieldId: field.id,
    dailySeries,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  return {
    dailySeries,
    soilWetness: 60,
    drainageIndex: 45,
    latestDoc: null
  };
}

module.exports = { ensureWeatherCacheForField };
