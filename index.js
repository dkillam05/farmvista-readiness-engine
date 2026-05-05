// ================================
// FILE: index.js
// PURPOSE: Entry + debug endpoint
// ================================

const express = require("express");
const { runBatch } = require("./services/run");

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
// DEBUG SINGLE FIELD
// ================================
app.get("/debug", async (req, res) => {
  try {
    const fieldId = req.query.fieldId;

    if (!fieldId) {
      return res.json({ error: "missing fieldId" });
    }

    const { loadFields } = require("./services/fields");
    const { ensureWeatherCacheForField } = require("./services/weather-cache");
    const { runFieldReadinessCoreServer } = require("./services/readiness");

    const fields = await loadFields();
    const f = fields.find(x => x.id === fieldId);

    if (!f) {
      return res.json({ error: "field not found" });
    }

    const wx = await ensureWeatherCacheForField(f, req);

    const result = await runFieldReadinessCoreServer(
      wx.rows,
      wx.soilWetness,
      wx.drainageIndex,
      wx.latestDoc
    );

    return res.json({
      field: {
        id: f.id,
        name: f.name,
        lat: f.lat,
        lng: f.lng
      },

      sampleInput: {
        firstRow: wx.rows?.[0] || null,
        lastRow: wx.rows?.[wx.rows.length - 1] || null,
        totalRows: wx.rows?.length || 0
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
