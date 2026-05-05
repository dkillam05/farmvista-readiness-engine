// ================================
// FILE: services/run.js
// PURPOSE: Main batch flow + WRITE readiness
// ================================

const { loadFields } = require("./fields");
const { ensureWeatherCacheForField } = require("./weather-cache");
const { runFieldReadinessCoreServer } = require("./readiness");
const db = require("../config/firestore");
const admin = require("firebase-admin");

async function runBatch(req) {
  const fields = await loadFields();

  let ok = 0, fail = 0;

  for (const f of fields) {
    try {
      const wx = await ensureWeatherCacheForField(f, req);

      const result = await runFieldReadinessCoreServer(
        wx.rows,
        wx.soilWetness,
        wx.drainageIndex,
        wx.latestDoc
      );

      // 🔥 WRITE TO FIRESTORE
      if (result) {
        await db.collection("field_readiness_latest").doc(f.id).set({
          fieldId: f.id,
          fieldName: f.name || null,

          location: {
            lat: f.lat,
            lng: f.lng
          },

          // === READINESS OUTPUT ===
          readiness: result.readiness,
          readinessR: result.readinessR,
          wetness: result.wetness,
          wetnessR: result.wetnessR,

          storageFinal: result.storageFinal,
          surfaceFinal: result.surfaceFinal,

          // === DEBUG / TRACE ===
          rows: result.rows || [],

          // === META ===
          seedSource: result.seedSource || null,
          computedAt: admin.firestore.FieldValue.serverTimestamp(),

          status: "ready"
        }, { merge: true });
      }

      ok++;

    } catch (e) {
      fail++;
      console.log("FIELD FAILED:", f.id);
      console.log("ERROR:", e.message);
    }
  }

  return { ok: true, total: fields.length, okCount: ok, fail };
}

module.exports = { runBatch };
