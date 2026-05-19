// ============================================
// FILE: /js/soil-model.js
// PURPOSE:
// FULL model loop (WITH SEED SUPPORT)
// Dynamic infiltration wired in
// Stabilized intraday drydown
//
// UPDATED:
// ✅ Slower soil drydown
// ✅ True current-day hour proration
// ✅ Forecast days do NOT affect current readiness storage/surface
// ✅ Slower overnight drying
// ✅ Reduced surface-to-soil handoff
// ✅ Surface wetness now lingers longer after repeated rain
// ✅ Keeps audit values for before/add/loss/floor/after
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
    return 0.03;
  }

  return clamp(hours / 24, 0.03, 1);
}

function getIntradayScale(row, dayFraction) {
  if (!row || row.isTodayLive !== true) {
    return 1;
  }

  // This is only a weather-quality modifier.
  // Actual current-day proration is handled separately by dayFraction.
  return clamp(
    0.42 + dayFraction * 0.38,
    0.42,
    0.80
  );
}

function isForecastRow(row, todayLiveISO) {
  if (!row) return false;

  if (
    row.isForecast === true ||
    row.forecast === true ||
    row.isForecastDay === true ||
    row.rowType === "forecast" ||
    row.sourceMode === "forecast"
  ) {
    return true;
  }

  const iso =
    String(row.dateISO || "").slice(0, 10);

  if (
    todayLiveISO &&
    iso &&
    iso > todayLiveISO
  ) {
    return true;
  }

  return false;
}

// Slower than previous model.
const LOSS_SCALE = 0.46;
const SURFACE_LOSS_SCALE = 0.74;

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

  const todayLiveRow =
    weatherRows.find(r => r?.isTodayLive === true);

  const todayLiveISO =
    todayLiveRow?.dateISO
      ? String(todayLiveRow.dateISO).slice(0, 10)
      : null;

  const trace = [];

  for (const row of weatherRows) {
    const before = storage;
    const surfaceBefore = surface;

    const dry =
      calcDryingPower(row);

    const rain = Number(
      row.rainInAdj ??
      row.rainIn ??
      0
    );

    const dayFraction =
      getDayFraction(row);

    const intradayScale =
      getIntradayScale(
        row,
        dayFraction
      );

    const forecastRow =
      isForecastRow(row, todayLiveISO);

    if (forecastRow) {
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

        rainEff: 0,

        infilMult: 0,
        runoffFrac: 0,
        saturation: 0,
        dryBoost: 0,
        saturationCollapse: 0,
        rainIntensityPenalty: 0,
        infilSurfacePenalty: 0,

        addRain: 0,
        surfaceAdd: 0,
        rawSurfaceAdd: 0,
        surfaceToSoil: 0,
        addTotal: 0,

        loss: 0,
        surfaceLoss: 0,

        afterRaw:
          round(storage, 4),

        storageFloor:
          round(
            surfaceDrivenStorageFloor(
              surface,
              factors.Smax
            ),
            4
          ),

        dayFraction: 0,
        intradayScale: 0,

        isTodayLive:
          row.isTodayLive === true,

        isForecast: true,

        hoursCount:
          Number(
            row.hoursCount || 0
          ),

        dryPwr: 0,
        weatherCore: 0,
        atmosphere: 0,

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
            surfacePenaltyFromStorage(
              surface
            ),
            4
          )
      });

      continue;
    }

    const infil =
      dynamicInfiltration({
        storage: before,
        surface,
        rain,
        factors
      });

    const rawSurfaceAdd =
      surfaceStorageAddFromRain(rain);

    // More rain remains operationally visible on the surface.
    const surfaceAdd =
      rawSurfaceAdd *
      clamp(
        0.55 + infil.runoffFrac * 0.75,
        0.35,
        1.35
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
      surfaceToStorageFrac(row, dry);

    const handoffFrac =
      clamp(
        handoffFracBase *
          clamp(
            infil.infilMult,
            0.20,
            1.00
          ),
        0,
        0.20
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

    if (row.isTodayLive === true) {
      loss *= dayFraction;
      loss *= intradayScale;
    }

    const afterRaw =
      before + add - loss;

    let surfaceLoss =
      surfaceDrydownInchesPerDay(
        dry,
        row.et0N ||
          row.et0In ||
          0,
        surface
      );

    surfaceLoss *= SURFACE_LOSS_SCALE;

    if (row.isTodayLive === true) {
      surfaceLoss *= dayFraction;
      surfaceLoss *= intradayScale;
    }

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

      isForecast: false,

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