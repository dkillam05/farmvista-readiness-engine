// ============================================
// FILE: weather-cache.js
// ============================================

const { getFirestore } = require("./firestore");

async function getWeatherCache(fieldId) {
  const db = getFirestore();
  const snap = await db.collection("field_weather_cache").doc(fieldId).get();
  return snap.exists ? snap.data() : null;
}

module.exports = { getWeatherCache };
