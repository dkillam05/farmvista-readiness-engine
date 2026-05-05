// ============================================
// FILE: /js/soil-model.js
// PURPOSE:
// FULL model loop (soil + surface integrated)
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
// CONSTANTS (same as old)
// --------------------------------------------
const LOSS_SCALE = 0.55;

// --------------------------------------------
// MAIN MODEL
// --------------------------------------------
function runSoilModel(weatherRows, field) {
  if (!Array.isArray(weatherRows) || !weatherRows.length) {
    return null;
  }

  const soilWetness = Number(field?.soilWetness || 50);
  const drainageIndex = Number(field?.drainageIndex || 50);

  const last = weatherRows[weatherRows.length - 1];
  const factors = mapFactors(soilWetness, drainageIndex, last?.sm010);

  let storage = clamp(0.1 * factors.Smax, 0, factors.Smax);
  let surface = 0;

  const trace = [];

  for (const row of weatherRows) {
    const before = storage;

    // --------------------------------------------
    // DRYING POWER
    // --------------------------------------------
    const dry = calcDryingPower(row);

    // --------------------------------------------
    // RAIN INPUT
    // --------------------------------------------
    const rain = Number(row.rainInAdj ?? row.rainIn ?? 0);

    // --------------------------------------------
    // SURFACE ADD
    // --------------------------------------------
    const surfaceAdd = surfaceStorageAddFromRain(rain);
    surface += surfaceAdd;

    // --------------------------------------------
    // EFFECTIVE RAIN TO SOIL
    // --------------------------------------------
    let rainEff = effectiveRainInches(
      rain,
      before,
      factors.Smax,
      factors
    );

    // --------------------------------------------
    // INFILTRATION
    // --------------------------------------------
    const addRain = rainEff * factors.infilMult;

    // --------------------------------------------
    // SURFACE → SOIL HANDOFF
    // --------------------------------------------
    const handoffFrac = surfaceToStorageFrac(row);
    const surfaceToSoil = surface * handoffFrac;

    surface -= surfaceToSoil;

    // --------------------------------------------
    // TOTAL ADD
    // --------------------------------------------
    const add = addRain + surfaceToSoil;

    // --------------------------------------------
    // DRYING (SOIL)
    // --------------------------------------------
    let loss =
      Number(dry.dryPwr || 0) *
      LOSS_SCALE *
      factors.dryMult;

    // surface slows soil drying
    const surfaceDryMult = surfaceWetHoldDryMult(surface);
    loss *= surfaceDryMult;

    // --------------------------------------------
    // UPDATE STORAGE
    // --------------------------------------------
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

    // soil cannot go below surface-driven floor
    const floor = surfaceDrivenStorageFloor(
      surface,
      factors.Smax
    );

    after = clamp(after, floor, factors.Smax);

    storage = after;

    // --------------------------------------------
    // PENALTY
    // --------------------------------------------
    const surfacePenalty =
      surfacePenaltyFromStorage(surface);

    // --------------------------------------------
    // OUTPUT
    // --------------------------------------------
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
    factors
  };
}

// --------------------------------------------
// EXPORT
// --------------------------------------------
module.exports = {
  runSoilModel
};
