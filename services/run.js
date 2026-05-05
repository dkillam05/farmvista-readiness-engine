// ================================
// FILE: services/run.js
// PURPOSE: Main batch flow (with error logging)
// ================================

const { loadFields } = require("./fields");
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

      // 🔥 THIS IS THE IMPORTANT PART
      console.log("FIELD FAILED:", f.id);
      console.log(e.message);
    }
  }

  return { ok: true, total: fields.length, okCount: ok, fail };
}

module.exports = { runBatch };
