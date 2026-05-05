// ================================
// FILE: index.js
// PURPOSE: Main Cloud Run service (FarmVista Weather + Readiness)
// ================================

const express = require("express");
const fetch = require("node-fetch");
const admin = require("firebase-admin");

const app = express();
app.disable("x-powered-by");

const PORT = process.env.PORT || 8080;

/* ================================
FIREBASE INIT
================================ */
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/* ================================
HELPERS
================================ */
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, Number(n)));
}
function round(v, d = 2) {
  const p = Math.pow(10, d);
  return Math.round(Number(v) * p) / p;
}
function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

/* ================================
OPEN METEO
================================ */
async function fetchWeather(lat, lng) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=temperature_2m,precipitation&timezone=America/Chicago`;
  const r = await fetch(url);
  const j = await r.json();
  return j;
}

/* ================================
WEATHER CACHE WRITE
================================ */
async function writeWeather(field, data) {
  await db.collection("field_weather_cache").doc(field.id).set({
    fieldId: field.id,
    location: { lat: field.lat, lng: field.lng },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    raw: data
  }, { merge: true });
}

/* ================================
READINESS (SIMPLIFIED PASS-THROUGH)
================================ */
async function writeReadiness(field) {
  await db.collection("field_readiness_latest").doc(field.id).set({
    fieldId: field.id,
    readiness: 50,
    wetness: 50,
    storageFinal: 1,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

/* ================================
LOAD FIELDS
================================ */
async function loadFields() {
  const snap = await db.collection("fields").get();
  const out = [];
  snap.forEach(doc => {
    const d = doc.data();
    if (!d?.lat || !d?.lng) return;
    out.push({
      id: doc.id,
      lat: d.lat,
      lng: d.lng
    });
  });
  return out;
}

/* ================================
MAIN RUN
================================ */
async function runBatch() {
  const fields = await loadFields();

  for (const f of fields) {
    try {
      const wx = await fetchWeather(f.lat, f.lng);
      await writeWeather(f, wx);
      await writeReadiness(f);
    } catch (e) {
      console.log("fail", f.id, e.message);
    }
  }

  return { ok: true, count: fields.length };
}

/* ================================
ROUTES
================================ */
app.get("/", async (req, res) => {
  if (req.query.run === "1") {
    const out = await runBatch();
    return res.json(out);
  }
  res.send("OK");
});

app.get("/healthz", (req, res) => {
  res.send("ok");
});

/* ================================
START SERVER
================================ */
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
