const express = require("express");
const router = express.Router();

const { runBatch } = require("../pipeline/run-batch");
const { runField } = require("../pipeline/run-field");
const { buildWeatherCache } = require("../pipeline/build-weather-cache");

const {
  getFields,
  getWeather,
  getLatest,
  writeResult,
  saveWeatherCache
} = require("../data/firestore-client");

/* ================================
RUN FULL BATCH
================================ */
router.get("/run", async (req, res) => {
  try {

    // ✅ REBUILD FLAG
    const rebuild = req.query.rebuild === "1";

    /* -------------------------------------------------------------
    1. BUILD WEATHER FOR ALL FIELDS (🔥 SAFE MODE)
    ------------------------------------------------------------- */
    const fields = await getFields();

    let weatherBuildFailCount = 0;

    for (const field of fields) {
      try {
        const weatherCache = await buildWeatherCache(field);

        if (weatherCache) {
          await saveWeatherCache(field.id, weatherCache);
        } else {
          weatherBuildFailCount++;
          console.warn("[weather-build] empty result:", field.id);
        }

      } catch (e) {
        weatherBuildFailCount++;
        console.warn("[weather-build] failed:", field.id, e?.message || e);
      }
    }

    console.log(`[weather-build] completed with ${weatherBuildFailCount} failures`);

    /* -------------------------------------------------------------
    2. RUN READINESS (🔥 NEVER BLOCKED BY WEATHER FAILURE)
    ------------------------------------------------------------- */

    const result = await runBatch(
      {
        getFields,
        getWeather,
        getLatest,
        writeResult
      },
      {
        concurrency: 6,
        rebuild
      }
    );

    res.json({
      ok: true,
      rebuild,
      weatherBuildFailures: weatherBuildFailCount,
      ...result
    });

  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e.message
    });
  }
});

/* ================================
RUN SINGLE FIELD (DEBUG)
================================ */
router.get("/field", async (req, res) => {
  try {
    const fieldId = req.query.fieldId;
    const rebuild = req.query.rebuild === "1";

    if (!fieldId) {
      return res.status(400).json({
        ok: false,
        error: "missing fieldId"
      });
    }

    const [fields, weatherRows, latestDoc] = await Promise.all([
      getFields(),
      getWeather(fieldId),
      getLatest(fieldId)
    ]);

    const field = fields.find(f => f.id === fieldId);

    if (!field) {
      return res.status(404).json({
        ok: false,
        error: "field not found"
      });
    }

    const result = await runField({
      field,
      weatherRows,
      latestDoc: rebuild ? null : latestDoc,
      soilWetness: field.soilWetness,
      drainageIndex: field.drainageIndex,
      rebuild // 🔥 PASS IT THROUGH CORRECTLY
    });

    res.json({
      ok: true,
      rebuild,
      field,
      weatherCount: weatherRows.length,
      latestDoc,
      result
    });

  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e.message
    });
  }
});

/* ================================
GET WEATHER DEBUG
================================ */
router.get("/weather", async (req, res) => {
  try {
    const fieldId = req.query.fieldId;

    if (!fieldId) {
      return res.status(400).json({
        ok: false,
        error: "missing fieldId"
      });
    }

    const weatherRows = await getWeather(fieldId);

    res.json({
      ok: true,
      count: weatherRows.length,
      sample: weatherRows.slice(-5),
      all: weatherRows
    });

  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e.message
    });
  }
});

/* ================================
GET LATEST STATE
================================ */
router.get("/latest", async (req, res) => {
  try {
    const fieldId = req.query.fieldId;

    if (!fieldId) {
      return res.status(400).json({
        ok: false,
        error: "missing fieldId"
      });
    }

    const latest = await getLatest(fieldId);

    res.json({
      ok: true,
      latest
    });

  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e.message
    });
  }
});

/* ================================
HEALTH CHECK
================================ */
router.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "farmvista-readiness-engine",
    status: "running"
  });
});

module.exports = router;