// ============================================
// FILE: /js/soil-model.js
// PURPOSE:
// FULL model loop (WITH SEED SUPPORT)
// ============================================

const { calcDryingPower } = require("./drying-power");
const { mapFactors } = require("./infiltration");
const { effectiveRainInches } = require("./rain-effective");

const {
  surfaceStorageAddFromRain,
  surfaceDrydownInchesPerDay,
  surfacePenaltyFromStorage,
  surfaceToStorageFrac,
  surfaceWetHoldDryMult,
  surfaceDrivenStorageFloor
} = require("./surface-model");

// --------------------------------------------
// HELPERS
// --------------------------------------------
function clamp(n, lo, hi) {
  n = Number(n);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function round(v, d = 2) {
  const p = Math.pow(10, d);
  return Math.round(Number(v) * p) / p;
}

// --------------------------------------------
// CONSTANTS
// --------------------------------------------
const LOSS_SCALE = 0.55;

// --------------------------------------------
// MAIN MODEL
// --------------------------------------------
function runSoilModel(weatherRows, field, opts = {}) {
  if (!Array.isArray(weatherRows) || !weatherRows.length) {
    return null;
  }

  const soilWetness = Number(field?.soilWetness || 50);
  const drainageIndex = Number(field?.drainageIndex || 50);

  const last = weatherRows[weatherRows.length - 1];

  const factors = mapFactors(
    soilWetness,
    drainageIndex,
    last?.sm010
  );

  // --------------------------------------------
  // SEED LOGIC
  // --------------------------------------------
  const seed = opts.seed || {};

  let storage;
  let surface;

  if (
    seed.mode === "rolling" &&
    Number.isFinite(seed.storage) &&
    Number.isFinite(seed.surface)
  ) {
    storage = clamp(seed.storage, 0, factors.Smax);
    surface = clamp(seed.surface, 0, 10);
  } else {
    // baseline (new field OR location change)
    storage = clamp(0.1 * factors.Smax, 0, factors.Smax);
    surface = 0;
  }

  // --------------------------------------------
  // TRACE
  // --------------------------------------------
  const trace = [];

  // --------------------------------------------
  // LOOP DAYS
  // --------------------------------------------
  for (const row of weatherRows) {
    const before = storage;

    // --------------------------------------------
    // DRYING POWER
    // --------------------------------------------
    const dry = calcDryingPower(row);

    // --------------------------------------------
    // RAIN
    // --------------------------------------------
    const rain = Number(
      row.rainInAdj ??
      row.rainIn ??
      0
    );

    // --------------------------------------------
    // SURFACE ADD
    // --------------------------------------------
    const surfaceAdd =
      surfaceStorageAddFromRain(rain);

    surface += surfaceAdd;

    // --------------------------------------------
    // EFFECTIVE RAIN
    // --------------------------------------------
    let rainEff = effectiveRainInches(
      rain,
      before,
      factors.Smax,
      factors
    );

    const addRain =
      rainEff * factors.infilMult;

    // --------------------------------------------
    // SURFACE → SOIL
    // --------------------------------------------
    const handoffFrac =
      surfaceToStorageFrac(row);

    const surfaceToSoil =
      surface * handoffFrac;

    surface -= surfaceToSoil;

    const add =
      addRain + surfaceToSoil;

    // --------------------------------------------
    // DRYING LOSS
    // --------------------------------------------
    let loss =
      Number(dry.dryPwr || 0) *
      LOSS_SCALE *
      factors.dryMult;

    const surfaceDryMult =
      surfaceWetHoldDryMult(surface);

    loss *= surfaceDryMult;

    // --------------------------------------------
    // STORAGE UPDATE
    // --------------------------------------------
    let after =
      before + add - loss;

    // --------------------------------------------
    // SURFACE DRYDOWN
    // --------------------------------------------
    const surfaceLoss =
      surfaceDrydownInchesPerDay(
        dry,
        row.et0N || 0
      );

    surface -= surfaceLoss;

    // --------------------------------------------
    // CLAMPS
    // --------------------------------------------
    surface = clamp(surface, 0, 10);

    const floor =
      surfaceDrivenStorageFloor(
        surface,
        factors.Smax
      );

    after = clamp(
      after,
      floor,
      factors.Smax
    );

    storage = after;

    // --------------------------------------------
    // SURFACE PENALTY
    // --------------------------------------------
    const surfacePenalty =
      surfacePenaltyFromStorage(surface);

    // --------------------------------------------
    // TRACE SAVE
    // --------------------------------------------
    trace.push({
      dateISO: row.dateISO,

      // --------------------------------------------
      // STORAGE
      // --------------------------------------------
      storage: round(storage, 3),
      surface: round(surface, 3),

      // --------------------------------------------
      // RAIN
      // --------------------------------------------
      rain: round(rain, 4),
      rainEff: round(rainEff, 4),

      addRain: round(addRain, 4),

      surfaceAdd: round(surfaceAdd, 4),
      surfaceToSoil: round(surfaceToSoil, 4),

      // --------------------------------------------
      // DRYING
      // --------------------------------------------
      loss: round(loss, 4),
      surfaceLoss: round(surfaceLoss, 4),

      // --------------------------------------------
      // DRY POWER BREAKDOWN
      // --------------------------------------------
      dryPwr: round(dry.dryPwr, 4),

      temp: round(dry.temp, 2),
      tempN: round(dry.tempN, 4),

      wind: round(dry.wind, 2),
      windN: round(dry.windN, 4),

      rh: round(dry.rh, 2),
      rhN: round(dry.rhN, 4),

      solar: round(dry.solar, 4),
      solarN: round(dry.solarN, 4),

      vpd: round(dry.vpd, 4),
      vpdN: round(dry.vpdN, 4),

      cloud: round(dry.cloud, 2),
      cloudN: round(dry.cloudN, 4),

      raw: round(dry.raw, 4),

      // --------------------------------------------
      // SURFACE
      // --------------------------------------------
      surfacePenalty: round(surfacePenalty, 4)
    });
  }

  // --------------------------------------------
  // RETURN
  // --------------------------------------------
  return {
    trace,

    storageFinal: storage,
    surfaceFinal: surface,

    factors,

    // DEBUG
    seedMode:
      seed.mode || "baseline_30d"
  };
}

// --------------------------------------------
// EXPORT
// --------------------------------------------
module.exports = {
  runSoilModel
};
