// ============================================
// FILE: /js/weather-builder.js
// PURPOSE:
// Build + update field_weather_cache (clean)
// ============================================

const admin = require("firebase-admin");
const { fetchWeather } = require("./weather-fetch");

// --------------------------------------------
// HELPERS
// --------------------------------------------
function isSameLocation(a, b, epsilon = 0.00001) {
  if (!a || !b) return false;

  return (
    Math.abs(Number(a.lat) - Number(b.lat)) < epsilon &&
    Math.abs(Number(a.lng) - Number(b.lng)) < epsilon
  );
}

// --------------------------------------------
// MAIN BUILDER
// --------------------------------------------
async function buildWeatherCache(db) {
  console.log("🌦️ Starting weather rebuild...");

  const FIELDS = "fields";
  const WEATHER = "field_weather_cache";

  const fieldsSnap = await db.collection(FIELDS).get();

  let built = 0;

  for (const doc of fieldsSnap.docs) {
    const field = { id: doc.id, ...doc.data() };

    if (field.status !== "active") continue;

    const fieldId = doc.id;

    console.log(`\n🌾 Weather → ${field.name}`);

    const existingSnap = await db
      .collection(WEATHER)
      .doc(fieldId)
      .get();

    const existing = existingSnap.exists ? existingSnap.data() : null;

    let needsFullRebuild = false;

    if (!existing) {
      needsFullRebuild = true;
      console.log("🆕 New field → full rebuild");
    } else if (!isSameLocation(existing.location, field.location)) {
      needsFullRebuild = true;
      console.log("📍 Location changed → full rebuild");
    }

    // --------------------------------------------
    // FETCH WEATHER
    // --------------------------------------------
    let weather;

    try {
      weather = await fetchWeather(field.location.lat, field.location.lng);
    } catch (err) {
      console.log("❌ Weather fetch failed:", err.message);
      continue;
    }

    // --------------------------------------------
    // BUILD FINAL DOC
    // --------------------------------------------
    const outRef = db.collection(WEATHER).doc(fieldId);

    const outDoc = {
      fieldId,
      fieldName: field.name || null,

      location: field.location || null,
      county: field.county || null,
      state: field.state || null,

      dailySeries: weather.dailySeries,
      hourlyToday: weather.hourlyToday,
      dailyForecast: weather.dailyForecast,

      dailySeriesMeta: weather.meta,

      updatedAt: admin.firestore.FieldValue.serverTimestamp(),

      status: "ok"
    };

    await outRef.set(outDoc, { merge: false });

    built++;
  }

  console.log(`\n✅ Weather rebuild complete (${built} fields)`);

  return {
    ok: true,
    built
  };
}

// --------------------------------------------
// EXPORT
// --------------------------------------------
module.exports = {
  buildWeatherCache
};
