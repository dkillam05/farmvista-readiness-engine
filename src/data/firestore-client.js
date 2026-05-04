// FILE: /data/firestore-client.js
// FIX: clean daily data + safe fallback to hourly when daily is garbage

const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const FIELDS = "fields";
const WEATHER = "field_weather_cache";
const LATEST = "field_readiness_latest";

/* ================================
HELPERS
================================ */
function getTodayISO() {
  return new Date().toISOString().slice(0, 10);
}

/* ================================
GET FIELDS
================================ */
async function getFields() {
  const snap = await db.collection(FIELDS).get();

  const out = [];

  snap.forEach(doc => {
    const d = doc.data() || {};

    if (String(d.status || "").toLowerCase() === "inactive") return;

    const lat = d.lat ?? d.location?.lat;
    const lng = d.lng ?? d.location?.lng;

    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return;

    out.push({
      id: doc.id,
      lat: Number(lat),
      lng: Number(lng),
      soilWetness: d.soilWetness,
      drainageIndex: d.drainageIndex
    });
  });

  return out;
}

/* ================================
GET WEATHER (🔥 REAL FIX HERE)
================================ */
async function getWeather(fieldId) {
  const snap = await db.collection(WEATHER).doc(fieldId).get();

  if (!snap.exists) return [];

  const d = snap.data() || {};

  const daily = Array.isArray(d.dailySeries) ? d.dailySeries : [];
  const hourly = Array.isArray(d.hourlySeries) ? d.hourlySeries : [];

  const today = getTodayISO();

  /* -------------------------------------------------
  🔥 CLEAN DAILY (REMOVE ZERO / FAKE DAYS)
  ------------------------------------------------- */
  const cleanDaily = daily
    .filter(r => {
      // remove garbage days (your main issue)
      return (
        r &&
        (
          Number(r.tempF) > 0 ||
          Number(r.rainIn) > 0 ||
          Number(r.windMph) > 0 ||
          Number(r.rh) > 0
        )
      );
    })
    .map(r => ({
      dateISO: r.dateISO,
      tempF: Number(r.tempF || 0),
      windMph: Number(r.windMph || 0),
      rh: Number(r.rh || 0),
      solarWm2: Number(r.solarWm2 || 0),
      rainIn: Number(r.rainIn || 0)
    }))
    .slice(-30);

  /* -------------------------------------------------
  HOURLY (TODAY ONLY — CLEAN)
  ------------------------------------------------- */
  const todayHourly = hourly
    .filter(h => h.time?.startsWith(today))
    .map(h => ({
      dateISO: h.time,
      tempF: Number(h.tempF || 0),
      windMph: Number(h.windMph || 0),
      rh: Number(h.rh || 0),
      solarWm2: Number(h.solarWm2 || 0),
      rainIn: Number(h.rainIn || 0)
    }));

  /* -------------------------------------------------
  🔥 FALLBACK: if daily is garbage, use recent hourly
  ------------------------------------------------- */
  if (!cleanDaily.length) {
    const fallbackHourly = hourly
      .slice(-72) // last ~3 days
      .map(h => ({
        dateISO: h.time,
        tempF: Number(h.tempF || 0),
        windMph: Number(h.windMph || 0),
        rh: Number(h.rh || 0),
        solarWm2: Number(h.solarWm2 || 0),
        rainIn: Number(h.rainIn || 0)
      }));

    return fallbackHourly;
  }

  /* -------------------------------------------------
  NORMAL RETURN
  ------------------------------------------------- */
  return [...cleanDaily, ...todayHourly];
}

/* ================================
SAVE WEATHER
================================ */
async function saveWeatherCache(fieldId, data) {
  await db.collection(WEATHER).doc(fieldId).set({
    ...data,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

/* ================================
GET LATEST
================================ */
async function getLatest(fieldId) {
  const snap = await db.collection(LATEST).doc(fieldId).get();

  if (!snap.exists) return null;

  return snap.data() || null;
}

/* ================================
WRITE RESULT (UNCHANGED — CORRECT)
================================ */
async function writeResult(result) {
  const ref = db.collection(LATEST).doc(result.fieldId);

  const todayISO = getTodayISO();

  await ref.set({
    fieldId: result.fieldId,

    // CORE VALUES
    readiness: result.readiness,
    wetness: result.wetness,
    storageFinal: result.storageFinal,
    surfaceFinal: result.surfaceFinal,

    // ENGINE META
    seedSource: result.seedSource,
    Smax: result.Smax,

    // REQUIRED FOR UI
    asOfDateISO: todayISO,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),

    // debug
    mode: result.mode,

  }, { merge: true });
}

module.exports = {
  getFields,
  getWeather,
  getLatest,
  writeResult,
  saveWeatherCache
};