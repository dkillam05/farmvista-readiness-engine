// ================================
// FILE: services/weather-cache.js
// PURPOSE: Fetch + cache weather
// ================================

const db = require("../config/firestore");   // ✅ FIXED
const admin = require("firebase-admin");     // ✅ FIXED
const { fetchOpenMeteo } = require("./weather-fetch");

async function ensureWeatherCacheForField(field) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${field.lat}&longitude=${field.lng}&hourly=temperature_2m,precipitation&timezone=America/Chicago`;

  const data = await fetchOpenMeteo(url);

  const rows = data?.hourly?.time?.map((t, i) => ({
    time: t,
    rain: data.hourly.precipitation[i] || 0,
    temp: data.hourly.temperature_2m[i] || 0
  })) || [];

  await db.collection("field_weather_cache").doc(field.id).set({
    fieldId: field.id,
    rows,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  return {
    rows,
    soilWetness: 60,
    drainageIndex: 45,
    latestDoc: null
  };
}

module.exports = { ensureWeatherCacheForField };
