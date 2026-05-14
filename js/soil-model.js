// ============================================
// FILE: /js/soil-model.js
// PURPOSE:
// FULL model loop (WITH SEED SUPPORT)
// Dynamic infiltration wired in
// Stabilized intraday drydown
//
// UPDATED:
// ✅ Fixes slider value 0 being ignored
// ✅ Uses field.soilWetness / field.drainageIndex safely
// ✅ Faster drydown conversion from DryPwr
// ✅ Keeps intraday stabilization
// ✅ Adds audit values for before/add/loss/floor/after
// ✅ Does not change storage tank size logic
// ============================================

const { calcDryingPower } = require("./drying-power");
const { mapFactors, dynamicInfiltration } = require("./infiltration");
const { effectiveRainInches } = require("./rain-effective");

const {
  surfaceStorageAddFromRain,
  surfaceDrydownInchesPerDay,
  surfacePenaltyFromStorage,
  surfaceToStorageFrac,
  surfaceWetHoldDryMult,
  surfaceDrivenStorageFloor
} = require("./surface-model");

function clamp(n, lo, hi) {
  n = Number(n);

  if (!Number.isFinite(n)) {
    return lo;
  }

  return Math.max(lo, Math.min(hi, n));
}

function round(v, d = 2) {
  const p = Math.pow(10, d);

  return Math.round(Number(v) * p) / p;
}

function readFieldNumber(field, key, fallback) {
  const n = Number(field?.[key]);

  if (Number.isFinite(n)) {
    return n;
  }

  return fallback;
}

function getDayFraction(row) {
  if (!row || row.isTodayLive !== true) {
    return 1;
  }

  const hours = Number(row.hoursCount || 0);

  if (!Number.isFinite(hours) || hours <= 0) {
    return 0.05;
  }

  return clamp(hours / 24, 0.05, 1);
}

function getIntradayScale(row, dayFraction) {
  if (!row || row.isTodayLive !== true) {
    return 1;
  }

  return clamp(
    0.65 + dayFraction * 0.35,
    0.65,
    1
  );
}

const LOSS_SCALE = 0.70;
const SURFACE_LOSS_SCALE = 1.08;

function runSoilModel(weatherRows, field, opts = {}) {
  if (
    !Array.isArray(weatherRows) ||
    !weatherRows.length
  ) {
    return null;
  }

  const soilWetness = clamp(
    readFieldNumber(field, "soilWetness", 50),
    0,
    100
  );

  const drainageIndex = clamp(
    readFieldNumber(field, "drainageIndex", 50),
    0,
    100
  );

  console.log("🧪 SOIL MODEL ACTIVE VALUES:", {
    fieldId: field?.id || field?.fieldId || null,
    soilWetness,
    drainageIndex
  });

  const last =
    weatherRows[weatherRows.length - 1];

  const factors = mapFactors(
    soilWetness,
    drainageIndex,
    last?.sm010
  );

  const seed = opts.seed || {};

  let storage;
  let surface;

  if (
    seed.mode === "rolling" &&
    Number.isFinite(seed.storage) &&
    Number.isFinite(seed.surface)
  ) {
    storage = clamp(
      seed.storage,
      0,
      factors.Smax
    );

    surface = clamp(
      seed.surface,
      0,
      10
    );
  } else {
    storage = clamp(
      0.1 * factors.Smax,
      0,
      factors.Smax
    );

    surface = 0;
  }

  const trace = [];

  for (const row of weatherRows) {
    const before = storage;
    const surfaceBefore = surface;

    const dayFraction =
      getDayFraction(row);

    const intradayScale =
      getIntradayScale(
        row,
        dayFraction
      );

    const dry =
      calcDryingPower(row);

    const rain = Number(
      row.rainInAdj ??
      row.rainIn ??
      0
    );

    const infil =
      dynamicInfiltration({
        storage: before,
        surface,
        rain,
        factors
      });

    const rawSurfaceAdd =
      surfaceStorageAddFromRain(rain);

    const surfaceAdd =
      rawSurfaceAdd *
      clamp(
        0.35 + infil.runoffFrac,
        0.15,
        1.25
      );

    surface += surfaceAdd;

    const rainEff =
      effectiveRainInches(
        rain,
        before,
        factors.Smax,
        factors
      );

    const addRain =
      rainEff *
      infil.infilMult;

    const handoffFracBase =
      surfaceToStorageFrac(row);

    const handoffFrac =
      clamp(
        handoffFracBase *
          clamp(
            infil.infilMult,
            0.15,
            1.25
          ),
        0,
        1
      );

    const surfaceToSoil =
      surface * handoffFrac;

    surface -= surfaceToSoil;

    const add =
      addRain + surfaceToSoil;

    let loss =
      Number(dry.dryPwr || 0) *
      LOSS_SCALE *
      factors.dryMult;

    const surfaceDryMult =
      surfaceWetHoldDryMult(surface);

    loss *= surfaceDryMult;
    loss *= intradayScale;

    const afterRaw =
      before + add - loss;

    let surfaceLoss =
      surfaceDrydownInchesPerDay(
        dry,
        row.et0N ||
          row.et0In ||
          0
      );

    surfaceLoss *= SURFACE_LOSS_SCALE;
    surfaceLoss *= intradayScale;

    surface -= surfaceLoss;

    surface = clamp(
      surface,
      0,
      10
    );

    const floor =
      surfaceDrivenStorageFloor(
        surface,
        factors.Smax
      );

    const after =
      clamp(
        afterRaw,
        floor,
        factors.Smax
      );

    storage = after;

    const surfacePenalty =
      surfacePenaltyFromStorage(
        surface
      );

    trace.push({
      dateISO: row.dateISO,

      storageBefore:
        round(before, 4),

      surfaceBefore:
        round(surfaceBefore, 4),

      storage:
        round(storage, 3),

      surface:
        round(surface, 3),

      rain:
        round(rain, 4),

      rainEff:
        round(rainEff, 4),

      infilMult:
        round(
          infil.infilMult,
          4
        ),

      runoffFrac:
        round(
          infil.runoffFrac,
          4
        ),

      saturation:
        round(
          infil.saturation,
          4
        ),

      dryBoost:
        round(
          infil.dryBoost,
          4
        ),

      saturationCollapse:
        round(
          infil.saturationCollapse,
          4
        ),

      rainIntensityPenalty:
        round(
          infil.rainIntensityPenalty,
          4
        ),

      infilSurfacePenalty:
        round(
          infil.surfacePenalty,
          4
        ),

      addRain:
        round(addRain, 4),

      surfaceAdd:
        round(surfaceAdd, 4),

      rawSurfaceAdd:
        round(rawSurfaceAdd, 4),

      surfaceToSoil:
        round(
          surfaceToSoil,
          4
        ),

      addTotal:
        round(add, 4),

      loss:
        round(loss, 4),

      surfaceLoss:
        round(surfaceLoss, 4),

      afterRaw:
        round(afterRaw, 4),

      storageFloor:
        round(floor, 4),

      dayFraction:
        round(
          dayFraction,
          4
        ),

      intradayScale:
        round(
          intradayScale,
          4
        ),

      isTodayLive:
        row.isTodayLive === true,

      hoursCount:
        Number(
          row.hoursCount || 0
        ),

      dryPwr:
        round(
          dry.dryPwr,
          4
        ),

      weatherCore:
        round(
          dry.weatherCore,
          4
        ),

      atmosphere:
        round(
          dry.atmosphere,
          4
        ),

      temp:
        round(dry.temp, 2),

      tempN:
        round(dry.tempN, 4),

      wind:
        round(dry.wind, 2),

      windN:
        round(dry.windN, 4),

      rh:
        round(dry.rh, 2),

      rhN:
        round(dry.rhN, 4),

      solar:
        round(dry.solar, 4),

      solarN:
        round(dry.solarN, 4),

      vpd:
        round(dry.vpd, 4),

      vpdN:
        round(dry.vpdN, 4),

      cloud:
        dry.cloud === null
          ? null
          : round(dry.cloud, 2),

      cloudN:
        round(dry.cloudN, 4),

      cloudDryN:
        round(dry.cloudDryN, 4),

      et0In:
        round(dry.et0In, 4),

      et0N:
        round(dry.et0N, 4),

      raw:
        round(dry.raw, 4),

      surfacePenalty:
        round(
          surfacePenalty,
          4
        )
    });
  }

  return {
    trace,

    storageFinal: storage,

    surfaceFinal: surface,

    factors,

    seedMode:
      seed.mode ||
      "baseline_30d"
  };
}

module.exports = {
  runSoilModel
};