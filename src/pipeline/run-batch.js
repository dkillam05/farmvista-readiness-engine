// run-batch.js
// Runs readiness for ALL fields (clean replacement for your batch loop)

const { runField } = require("./run-field");

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

/**
 * runBatch
 *
 * @param {Object} deps
 * @param {Function} deps.getFields            → async () => fields[]
 * @param {Function} deps.getWeather           → async (fieldId) => weatherRows[]
 * @param {Function} deps.getLatest            → async (fieldId) => latestDoc
 * @param {Function} deps.writeResult          → async (result) => void
 *
 * @param {Object} opts
 * @param {number} opts.concurrency
 * @param {number} opts.soilWetnessDefault
 * @param {number} opts.drainageDefault
 */
async function runBatch(deps, opts = {}) {
  const {
    getFields,
    getWeather,
    getLatest,
    writeResult
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
          LOAD DATA
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
          RUN FIELD
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
          WRITE RESULT
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
