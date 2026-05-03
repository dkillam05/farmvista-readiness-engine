const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const FIELDS = "fields";
const WEATHER = "field_weather_cache";
const LATEST = "field_readiness_latest";

/* ================================
GET FIELDS
================================ */
async function getFields() {
  const snap = await db.collection(FIELDS).get();

  const out = [];
  snap.forEach(doc => {
    const d = doc.data() || {};

    if (String(d.status || "").toLowerCase() === "inactive") return;

    if (!d.lat || !d.lng) return;

    out.push({
      id: doc.id,
      lat: Number(d.lat),
      lng: Number(d.lng),
      soilWetness: d.soilWetness,
      drainageIndex: d.drainageIndex
    });
  });

  return out;
}

/* ================================
GET WEATHER
================================ */
async function getWeather(fieldId) {
  const snap = await db.collection(WEATHER).doc(fieldId).get();

  if (!snap.exists) return [];

  const d = snap.data() || {};

  return Array.isArray(d.dailySeries) ? d.dailySeries : [];
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
