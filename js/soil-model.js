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
  const factors = mapFactors(soilWetness, drainageIndex, last?.sm010);

  // --------------------------------------------
  // NEW: SEED LOGIC
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

  const trace = [];

  for (const row of weatherRows) {
    const before = storage;

    const dry = calcDryingPower(row);

    const rain = Number(row.rainInAdj ?? row.rainIn ?? 0);

    // --------------------------------------------
    // SURFACE ADD
    // --------------------------------------------
    const surfaceAdd = surfaceStorageAddFromRain(rain);
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

    const addRain = rainEff * factors.infilMult;

    // --------------------------------------------
    // SURFACE → SOIL
    // --------------------------------------------
    const handoffFrac = surfaceToStorageFrac(row);
    const surfaceToSoil = surface * handoffFrac;

    surface -= surfaceToSoil;

    const add = addRain + surfaceToSoil;

    // --------------------------------------------
    // DRYING
    // --------------------------------------------
    let loss =
      Number(dry.dryPwr || 0) *
      LOSS_SCALE *
      factors.dryMult;

    const surfaceDryMult = surfaceWetHoldDryMult(surface);
    loss *= surfaceDryMult;

    let after = before + add - loss;

    // --------------------------------------------
    // SURFACE DRYING
    // --------------------------------------------
    const surfaceLoss = surfaceDrydownInchesPerDay(
      dry,
      row.et0N || 0
    );

    surface -= surfaceLoss;

    // --------------------------------------------
    // CLAMPS
    // --------------------------------------------
    surface = clamp(surface, 0, 10);

    const floor = surfaceDrivenStorageFloor(
      surface,
      factors.Smax
    );

    after = clamp(after, floor, factors.Smax);

    storage = after;

    const surfacePenalty =
      surfacePenaltyFromStorage(surface);

    trace.push({
      dateISO: row.dateISO,

      storage: round(storage, 3),
      surface: round(surface, 3),

      rain,
      rainEff,
      addRain,
      surfaceAdd,
      surfaceToSoil,

      loss,
      surfaceLoss,

      dryPwr: dry.dryPwr,
      surfacePenalty
    });
  }

  return {
    trace,
    storageFinal: storage,
    surfaceFinal: surface,
    factors,

    // DEBUG
    seedMode: seed.mode || "baseline_30d"
  };
}

// --------------------------------------------
// EXPORT
// --------------------------------------------
module.exports = {
  runSoilModel
};
