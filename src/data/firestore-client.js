// FILE: /data/firestore-client.js
// FULL FIX: stable mapping + guaranteed rows + correct ordering

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
GET WEATHER (🔥 FIXED)
================================ */
async function getWeather(fieldId) {
  const snap = await db.collection(WEATHER).doc(fieldId).get();

  if (!snap.exists) return [];

  const d = snap.data() || {};

  const daily = Array.isArray(d.dailySeries) ? d.dailySeries : [];
  const hourly = Array.isArray(d.hourlySeries) ? d.hourlySeries : [];

  const today = getTodayISO();

  const rows = [];

  /* -------------------------------
     DAILY HISTORY
  ------------------------------- */
  for (const r of daily) {
    if (!r || !r.dateISO) continue;

    rows.push({
      dateISO: r.dateISO,
      tempF: Number(r.tempAvg || 0),
      windMph: Number(r.windAvg || 0),
      rh: Number(r.rhAvg || 0),
      solarWm2: Number(r.solarAvg || 0),
      rainIn: Number(r.rainTotal || 0)
    });
  }

  /* -------------------------------
     HOURLY TODAY
  ------------------------------- */
  for (const h of hourly) {
    if (!h || !h.time) continue;
    if (!h.time.startsWith(today)) continue;

    rows.push({
      dateISO: h.time,
      tempF: Number(h.tempF || 0),
      windMph: Number(h.windMph || 0),
      rh: Number(h.rh || 0),
      solarWm2: Number(h.solarWm2 || 0),
      rainIn: Number(h.rainIn || 0)
    });
  }

  /* -------------------------------
     🔥 CRITICAL: SORT TIME
  ------------------------------- */
  rows.sort((a, b) => new Date(a.dateISO) - new Date(b.dateISO));

  return rows;
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

  const todayISO = getTodayISO();

  await ref.set({
    fieldId: result.fieldId,

    readiness: result.readiness,
    wetness: result.wetness,
    storageFinal: result.storageFinal,
    surfaceFinal: result.surfaceFinal,

    seedSource: result.seedSource,
    Smax: result.Smax,

    asOfDateISO: todayISO,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),

    mode: result.mode
  }, { merge: true });
}

module.exports = {
  getFields,
  getWeather,
  getLatest,
  writeResult,
  saveWeatherCache
};
