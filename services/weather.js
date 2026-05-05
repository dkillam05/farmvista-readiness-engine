// ================================
// FILE: services/weather.js
// PURPOSE: Weather fetch + cache write
// ================================

const fetch = require("node-fetch");
const { db, admin } = require("../config/firestore");

/* ================================
FETCH WEATHER
================================ */
async function fetchWeather(lat, lng) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=temperature_2m,precipitation&timezone=America/Chicago`;

  const r = await fetch(url);
  return await r.json();
}

/* ================================
WRITE WEATHER
================================ */
async function writeWeather(field, data) {
  await db.collection("field_weather_cache").doc(field.id).set({
    fieldId: field.id,
    location: { lat: field.lat, lng: field.lng },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    raw: data
  }, { merge: true });
}

module.exports = { fetchWeather, writeWeather };
