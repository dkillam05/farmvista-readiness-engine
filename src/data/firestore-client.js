const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const FIELDS = "fields";
const WEATHER = "field_weather_cache";
const LATEST = "field_readiness_latest";

/* ================================
HELPERS (small + safe)
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
GET WEATHER (FIXED HERE)
================================ */
async function getWeather(fieldId) {
  const snap = await db.collection(WEATHER).doc(fieldId).get();

  if (!snap.exists) return [];

  const d = snap.data() || {};

  // existing stored daily data
  let daily = Array.isArray(d.dailySeries) ? [...d.dailySeries] : [];

  // hourly data (must exist for fix to work)
  const hourly = Array.isArray(d.hourlySeries) ? d.hourlySeries : [];

  if (!hourly.length) return daily;

  const today = getTodayISO();

  // find all hourly rows for today
  const todayRows = hourly.filter(r => r.dateISO?.startsWith(today));

  if (!todayRows.length) return daily;

  // rebuild today's daily row
  const rebuiltToday = {
    dateISO: today,

    tempAvg: round(avg(todayRows.map(r => Number(r.tempF || 0))), 1),
    windAvg: round(avg(todayRows.map(r => Number(r.windMph || 0))), 1),
    rhAvg: round(avg(todayRows.map(r => Number(r.rh || 0))), 1),
    solarAvg: round(avg(todayRows.map(r => Number(r.solarWm2 || 0))), 1),

    rainTotal: round(sum(todayRows.map(r => Number(r.rainIn || 0))), 3),

    hoursUsed: todayRows.length
  };

  // replace or insert today
  const idx = daily.findIndex(x => x.dateISO === today);

  if (idx >= 0) {
    daily[idx] = rebuiltToday;
  } else {
    daily.push(rebuiltToday);
  }

  return daily;
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
  writeResult
};
