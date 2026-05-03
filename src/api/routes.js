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
  saveWeatherCache   // 👈 ADD THIS
} = require("../data/firestore-client");

/* ================================
RUN FULL BATCH
================================ */
router.get("/run", async (req, res) => {
  try {

    /* -------------------------------------------------------------
    1. BUILD WEATHER FOR ALL FIELDS (NEW)
    ------------------------------------------------------------- */

    const fields = await getFields();

    for (const field of fields) {
      try {
        const weatherCache = await buildWeatherCache(field);

        if (weatherCache) {
          await saveWeatherCache(field.id, weatherCache);
        }
      } catch (e) {
        console.warn("[weather-build] failed:", field.id, e?.message || e);
      }
    }

    /* -------------------------------------------------------------
    2. RUN READINESS
    ------------------------------------------------------------- */

    const result = await runBatch(
      {
        getFields,
        getWeather,
        getLatest,
        writeResult
      },
      {
        concurrency: 6
      }
    );

    res.json({
      ok: true,
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
      latestDoc,
      soilWetness: field.soilWetness,
      drainageIndex: field.drainageIndex
    });

    res.json({
      ok: true,
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
