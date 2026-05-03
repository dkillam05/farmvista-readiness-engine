// run-batch.js
// Runs readiness for ALL fields (WITH WEATHER REBUILD FIX)

const { runField } = require("./run-field");
const { buildWeatherCache } = require("./build-weather-cache");

/* =========================================================================
HELPERS
========================================================================= */

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/* =========================================================================
MAIN BATCH RUNNER
========================================================================= */

async function runBatch(deps, opts = {}) {
  const {
    getFields,
    getWeather,
    getLatest,
    writeResult,
    saveWeatherCache   // 👈 NEW DEP (we will use this)
  } = deps;

  const {
    concurrency = 6,
    soilWetnessDefault = 60,
    drainageDefault = 45
  } = opts;

  if (!getFields || !getWeather || !getLatest || !writeResult) {
    throw new Error("Missing required dependencies");
  }

  const fields = await getFields();

  let ok = 0;
  let fail = 0;

  const chunks = chunkArray(fields, concurrency);

  for (const group of chunks) {
    await Promise.all(
      group.map(async (field) => {
        try {
          /* -------------------------------------------------------------
          1. BUILD WEATHER (NEW FIX)
          ------------------------------------------------------------- */

          let weatherCache = null;

          try {
            weatherCache = await buildWeatherCache(field);

            // Save if function provided
            if (saveWeatherCache && weatherCache) {
              await saveWeatherCache(field.id, weatherCache);
            }
          } catch (e) {
            console.warn("[weather-build] failed:", field.id, e?.message || e);
          }

          /* -------------------------------------------------------------
          2. LOAD DATA
          ------------------------------------------------------------- */

          const [weatherRows, latestDoc] = await Promise.all([
            getWeather(field.id),
            getLatest(field.id)
          ]);

          if (!weatherRows || !weatherRows.length) {
            fail++;
            return;
          }

          /* -------------------------------------------------------------
          FIELD PARAMS
          ------------------------------------------------------------- */

          const soilWetness = Number.isFinite(Number(field.soilWetness))
            ? Number(field.soilWetness)
            : soilWetnessDefault;

          const drainageIndex = Number.isFinite(Number(field.drainageIndex))
            ? Number(field.drainageIndex)
            : drainageDefault;

          /* -------------------------------------------------------------
          3. RUN FIELD
          ------------------------------------------------------------- */

          const result = await runField({
            field,
            weatherRows,
            latestDoc,
            soilWetness,
            drainageIndex
          });

          if (!result || !result.ok) {
            fail++;
            return;
          }

          /* -------------------------------------------------------------
          4. WRITE RESULT
          ------------------------------------------------------------- */

          await writeResult(result);

          ok++;
        } catch (e) {
          console.warn("[runBatch] field failed:", field.id, e?.message || e);
          fail++;
        }
      })
    );
  }

  return {
    ok,
    fail,
    total: fields.length
  };
}

module.exports = {
  runBatch
};
