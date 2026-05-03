const express = require("express");
const router = express.Router();

const { runBatch } = require("../pipeline/run-batch");
const {
  getFields,
  getWeather,
  getLatest,
  writeResult
} = require("../data/firestore-client");

/* ================================
RUN FULL BATCH
================================ */
router.get("/run", async (req, res) => {
  try {
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

module.exports = router;
