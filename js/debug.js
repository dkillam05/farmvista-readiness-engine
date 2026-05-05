// ================================
// FILE: debug.js
// PURPOSE: Attach debug routes to existing app
// ================================

function attachDebugRoutes(app, deps) {

  const {
    db,
    loadFieldById,
    buildModelWeatherRowsForServer,
    runFieldReadinessCoreServer
  } = deps;

  app.get("/debug", async (req, res) => {
    try {
      const fieldId = String(req.query.fieldId || "").trim();

      if (!fieldId) {
        return res.json({ error: "missing fieldId" });
      }

      // 🔍 LOAD FIELD
      const f = await loadFieldById(fieldId);
      if (!f) {
        return res.json({ error: "field not found" });
      }

      // 🔍 LOAD WEATHER CACHE
      const wxSnap = await db.collection("field_weather_cache").doc(fieldId).get();
      const wx = wxSnap.exists ? wxSnap.data() : null;

      // 🔍 BUILD MODEL ROWS
      let weatherRows = [];

      if (wx) {
        try {
          weatherRows = buildModelWeatherRowsForServer(wx, null);
        } catch (e) {
          console.log("ROW BUILD ERROR:", e.message);
        }
      }

      // 🔍 RUN MODEL
      let result = null;

      if (weatherRows.length) {
        try {
          result = await runFieldReadinessCoreServer(
            weatherRows,
            60,
            45,
            null
          );
        } catch (e) {
          console.log("MODEL ERROR:", e.message);
        }
      }

      return res.json({
        field: {
          id: f.id,
          name: f.name,
          lat: f.lat,
          lng: f.lng
        },

        weatherCache: {
          exists: !!wx,
          dailySeriesCount: wx?.dailySeries?.length || 0,
          hasNormalized: !!wx?.normalized
        },

        modelInput: {
          rowCount: weatherRows.length,
          firstRow: weatherRows[0] || null,
          lastRow: weatherRows[weatherRows.length - 1] || null
        },

        modelOutput: result
      });

    } catch (e) {
      return res.json({ error: e.message });
    }
  });
}

module.exports = { attachDebugRoutes };
