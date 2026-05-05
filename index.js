// ================================
// FILE: index.js
// PURPOSE: Main entry / route control
// ================================

const express = require("express");

const { loadFields } = require("./services/fields");
const { fetchWeather } = require("./services/weather");
const { writeWeather } = require("./services/weather");
const { writeReadiness } = require("./services/readiness");

const app = express();
app.disable("x-powered-by");

const PORT = process.env.PORT || 8080;

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

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
