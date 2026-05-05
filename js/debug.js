// ================================
// FILE: debug.js (FULL DEEP DEBUG)
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

      // ================================
      // FIELD
      // ================================
      const f = await loadFieldById(fieldId);
      if (!f) {
        return res.json({ error: "field not found" });
      }

      // ================================
      // WEATHER CACHE
      // ================================
      const wxSnap = await db.collection("field_weather_cache").doc(fieldId).get();
      const wx = wxSnap.exists ? wxSnap.data() : null;

      // ================================
      // MODEL ROWS
      // ================================
      let weatherRows = [];
      let rowBuildError = null;

      if (wx) {
        try {
          weatherRows = buildModelWeatherRowsForServer(wx, null);
        } catch (e) {
          rowBuildError = e.message;
        }
      }

      // ================================
      // RUN MODEL
      // ================================
      let result = null;
      let modelError = null;

      if (weatherRows.length) {
        try {
          result = await runFieldReadinessCoreServer(
            weatherRows,
            60,
            45,
            null
          );
        } catch (e) {
          modelError = e.message;
        }
      }

      // ================================
      // TRACE SUMMARY
      // ================================
      let traceSummary = null;

      if (result?.trace?.length) {
        const t = result.trace;

        traceSummary = {
          totalDays: t.length,
          firstDay: t[0],
          lastDay: t[t.length - 1],
          peakStorage: Math.max(...t.map(x => x.storage || 0)),
          minStorage: Math.min(...t.map(x => x.storage || 0))
        };
      }

      // ================================
      // RESPONSE
      // ================================
      return res.json({

        // ================================
        // FIELD INFO
        // ================================
        field: {
          id: f.id,
          name: f.name,
          lat: f.lat,
          lng: f.lng
        },

        // ================================
        // WEATHER CACHE (FULL VIEW)
        // ================================
        weatherCache: {
          exists: !!wx,
          keys: wx ? Object.keys(wx) : [],
          dailySeriesCount: wx?.dailySeries?.length || 0,
          forecastCount: wx?.dailySeriesFcst?.length || 0,
          hasNormalized: !!wx?.normalized,
          sampleDailyFirst: wx?.dailySeries?.[0] || null,
          sampleDailyLast: wx?.dailySeries?.[wx?.dailySeries?.length - 1] || null
        },

        // ================================
        // MODEL INPUT
        // ================================
        modelInput: {
          rowCount: weatherRows.length,
          firstRow: weatherRows[0] || null,
          lastRow: weatherRows[weatherRows.length - 1] || null,
          rowBuildError
        },

        // ================================
        // MODEL OUTPUT (FULL)
        // ================================
        modelOutput: result || null,
        modelError,

        // ================================
        // 🔥 TRACE (FULL ENGINE VISIBILITY)
        // ================================
        trace: result?.trace || [],

        // ================================
        // TRACE SUMMARY (QUICK VIEW)
        // ================================
        traceSummary,

        // ================================
        // SANITY CHECKS
        // ================================
        checks: {
          hasWeather: !!wx,
          hasRows: weatherRows.length > 0,
          modelRan: !!result,
          hasTrace: !!result?.trace?.length
        }

      });

    } catch (e) {
      return res.json({
        error: e.message
      });
    }
  });
}

module.exports = { attachDebugRoutes };
