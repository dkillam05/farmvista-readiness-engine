// ============================================
// FILE: run-batch.js
// ============================================

const { loadActiveFields } = require("../firestore/fields");
const { getWeatherCache } = require("../firestore/weather-cache");
const { writeReadiness } = require("../firestore/readiness-writer");

const { buildWeatherRows } = require("../weather/weather-row-builder");
const { runFieldReadinessCoreServer } = require("../readiness/readiness-engine");

async function runBatch() {
  const fields = await loadActiveFields();

  for (const f of fields) {
    const wx = await getWeatherCache(f.id);
    if (!wx) continue;

    const rows = buildWeatherRows(wx, null);

    const snapshot = await runFieldReadinessCoreServer(rows);
    if (!snapshot) continue;

    await writeReadiness(f.id, snapshot);
  }

  return { ok: true };
}

module.exports = { runBatch };
