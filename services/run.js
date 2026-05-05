// ================================
// FILE: services/run.js
// PURPOSE: Main batch flow
// ================================

// THIS IS YOUR "/" ROUTE LOGIC MOVED

const { loadFields } = require("./fields");   // ✅ FIXED
const buildWeather = require("./weather-cache");
const { runFieldReadinessCoreServer } = require("./readiness");

async function runBatch(req) {
  const fields = await loadFields();

  let ok = 0, fail = 0;

  for (const f of fields) {
    try {
      const wx = await buildWeather(f, req);

      await runFieldReadinessCoreServer(
        wx.rows,
        wx.soilWetness,
        wx.drainageIndex,
        wx.latestDoc
      );

      ok++;
    } catch (e) {
      fail++;
    }
  }

  return { ok: true, total: fields.length, okCount: ok, fail };
}

module.exports = { runBatch };
