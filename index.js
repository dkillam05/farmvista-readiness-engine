// ================================
// FILE: index.js
// PURPOSE: Entry + debug endpoint (FIXED)
// ================================

const express = require("express");
const { runBatch } = require("./services/run");
const db = require("./config/firestore");

const app = express();
const PORT = process.env.PORT || 8080;

// ================================
// MAIN RUN
// ================================
app.get("/", async (req, res) => {
  if (req.query.run === "1") {
    return res.json(await runBatch(req));
  }
  res.send("FarmVista Field Weather OK");
});

// ================================
// DEBUG SINGLE FIELD (FIXED)
// ================================
app.get("/debug", async (req, res) => {
  try {
    const fieldId = req.query.fieldId;

    if (!fieldId) {
      return res.json({ error: "missing fieldId" });
    }

    const { runFieldReadinessCoreServer } = require("./services/readiness");

    // 🔥 READ FROM SAME SOURCE AS run.js
    const wxSnap = await db.collection("field_weather_cache").doc(fieldId).get();

    if (!wxSnap.exists) {
      return res.json({ error: "no weather cache" });
    }

    const wx = wxSnap.data() || {};

    const rows = wx.dailySeries || wx.rows || [];

    // 🔥 READ EXISTING STATE
    const latestSnap = await db
      .collection("field_readiness_latest")
      .doc(fieldId)
      .get();

    const latestDoc = latestSnap.exists ? latestSnap.data() : null;

    const result = await runFieldReadinessCoreServer(
      rows,
      60,
      45,
      latestDoc
    );

    return res.json({
      fieldId,

      sampleInput: {
        firstRow: rows[0] || null,
        lastRow: rows[rows.length - 1] || null,
        totalRows: rows.length
      },

      modelOutput: result
    });

  } catch (e) {
    return res.json({
      error: e.message
    });
  }
});

app.listen(PORT);
