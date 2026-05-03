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
function round(v, d = 2) {
  const p = Math.pow(10, d);
  return Math.round(Number(v) * p) / p;
}

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}

function getTodayISO() {
  return new Date().toISOString().slice(0, 10);
}

/* ================================
GET FIELDS
================================ */
async function getFields() {
  const snap = await db.collection("fields").get();

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
GET WEATHER (🔥 FULL FIX HERE)
================================ */
async function getWeather(fieldId) {
  const snap = await db.collection(WEATHER).doc(fieldId).get();

  if (!snap.exists) return [];

  const d = snap.data() || {};

  const daily = Array.isArray(d.dailySeries) ? d.dailySeries : [];
  const hourly = Array.isArray(d.hourlySeries) ? d.hourlySeries : [];

  const today = getTodayISO();

  /* -------------------------------------------------------------
  1. GET YESTERDAY (last full daily)
  ------------------------------------------------------------- */
  const yesterday = daily
    .filter(d => d.dateISO < today)
    .slice(-1);

  /* -------------------------------------------------------------
  2. GET TODAY HOURLY (THIS IS THE FIX)
  ------------------------------------------------------------- */
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

  /* -------------------------------------------------------------
  3. RETURN COMBINED
  ------------------------------------------------------------- */
  return [...yesterday, ...todayHourly];
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
WRITE RESULT
================================ */
async function writeResult(result) {
  const ref = db.collection(LATEST).doc(result.fieldId);

  await ref.set({
    fieldId: result.fieldId,
    readiness: result.readiness,
    wetness: result.wetness,
    storageFinal: result.storageFinal,
    surfaceFinal: result.surfaceFinal,
    seedSource: result.seedSource,
    Smax: result.Smax,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

module.exports = {
  getFields,
  getWeather,
  getLatest,
  writeResult,
  saveWeatherCache
};
