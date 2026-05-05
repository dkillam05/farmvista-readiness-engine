// ================================
// FILE: services/weather-cache.js
// PURPOSE: Fetch + build 30d history + 7d forecast (FIXED)
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

      // temp defaults (unchanged)
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

  const start = getISO(-30);
  const end = getISO(7);

  // 🔥 THIS IS THE FIX
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${field.lat}&longitude=${field.lng}&start_date=${start}&end_date=${end}&hourly=temperature_2m,precipitation&timezone=America/Chicago`;

  const data = await fetchOpenMeteo(url);

  const dailySeries = buildDailyRows(data);

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
