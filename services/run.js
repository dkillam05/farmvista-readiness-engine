// ================================
// FILE: services/run.js
// PURPOSE: Main batch flow (FULL RESTORE)
// ================================

const { loadFields } = require("./fields");
const { runFieldReadinessCoreServer } = require("./readiness");
const db = require("../config/firestore");
const admin = require("firebase-admin");

async function runBatch(req) {
  const fields = await loadFields();

  let ok = 0, fail = 0;

  for (const f of fields) {
    try {
      // 🔥 READ WEATHER CACHE (REAL SOURCE)
      const wxSnap = await db.collection("field_weather_cache").doc(f.id).get();

      if (!wxSnap.exists) {
        console.log("NO WEATHER:", f.id);
        fail++;
        continue;
      }

      const wx = wxSnap.data() || {};
      const rows = wx.dailySeries || [];

      if (!rows.length) {
        console.log("NO ROWS:", f.id);
        fail++;
        continue;
      }

      // 🔥 READ EXISTING STATE (ROLLING STORAGE)
      const latestSnap = await db
        .collection("field_readiness_latest")
        .doc(f.id)
        .get();

      const latestDoc = latestSnap.exists ? latestSnap.data() : null;

      // 🔥 RUN REAL MODEL
      const result = await runFieldReadinessCoreServer(
        rows,
        60,  // temp default (we’ll wire real later)
        45,
        latestDoc
      );

      if (!result) {
        console.log("NO RESULT:", f.id);
        fail++;
        continue;
      }

      // 🔥 WRITE OUTPUT
      await db.collection("field_readiness_latest").doc(f.id).set({
        fieldId: f.id,

        readiness: result.readiness,
        readinessR: result.readinessR,

        wetness: result.wetness,
        wetnessR: result.wetnessR,

        storageFinal: result.storageFinal,
        surfaceFinal: result.surfaceFinal,

        rows: result.rows || [],

        seedSource: result.seedSource || null,
        computedAt: admin.firestore.FieldValue.serverTimestamp(),

        status: "ready"
      }, { merge: true });

      ok++;

    } catch (e) {
      fail++;
      console.log("FIELD FAILED:", f.id);
      console.log(e.message);
    }
  }

  return { ok: true, total: fields.length, okCount: ok, fail };
}

module.exports = { runBatch };
