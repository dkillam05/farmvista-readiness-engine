// ============================================
// FILE: /js/soil-model.js
// PURPOSE:
// Run soil storage trace using original FarmVista model logic
// ============================================

const { calcDryingPower } = require("./drying-power");
const { mapFactors } = require("./infiltration");
const { effectiveRainInches } = require("./rain-effective");

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
// ORIGINAL MODEL CONSTANTS
// --------------------------------------------
const LOSS_SCALE = 0.55;

const EXTRA = {
  LOSS_ET0_W: 0.08,
  ADD_SM010_W: 0.10,
  DRY_LOSS_MULT: 1.0,
  RAIN_EFF_MULT: 1.0
};

const TUNE = {
  DRY_TAIL_START: 0.12,
  DRY_TAIL_MIN_MULT: 0.55,

  WET_HOLD_START: 0.62,
  WET_HOLD_MAX_REDUCTION: 0.32,
  WET_HOLD_EXP: 1.7,

  MID_ACCEL_START: 0.5,
  MID_ACCEL_MAX_BOOST: 0.18,
  MID_ACCEL_EXP: 1.35,

  SAME_DAY_LATE_RAIN_DRY_FLOOR: 0.18,
  SAME_DAY_MORNING_RAIN_DRY_MIN: 0.70,
  SAME_DAY_MIDDAY_RAIN_DRY_MIN: 0.45,
  SAME_DAY_EVENING_RAIN_DRY_MIN: 0.12
};

// --------------------------------------------
// SAME-DAY RAIN DRYING FACTOR
// --------------------------------------------
function sameDayRainDryFactor(row) {
  const rain = Math.max(0, Number(row?.rainInAdj ?? row?.rainIn ?? 0));
  if (!rain) return 1;

  const morning = Math.max(0, Number(row?.rainMorningIn || 0));
  const midday = Math.max(0, Number(row?.rainMiddayIn || 0));
  const evening = Math.max(0, Number(row?.rainEveningIn || 0));

  const total = Math.max(1e-6, morning + midday + evening);

  const morningShare = clamp(morning / total, 0, 1);
  const middayShare = clamp(midday / total, 0, 1);
  const eveningShare = clamp(evening / total, 0, 1);

  const factor =
    morningShare * TUNE.SAME_DAY_MORNING_RAIN_DRY_MIN +
    middayShare * TUNE.SAME_DAY_MIDDAY_RAIN_DRY_MIN +
    eveningShare * TUNE.SAME_DAY_EVENING_RAIN_DRY_MIN;

  return clamp(factor, TUNE.SAME_DAY_LATE_RAIN_DRY_FLOOR, 1);
}

// --------------------------------------------
// STORAGE DRYDOWN MULTIPLIER
// --------------------------------------------
function storageDrydownMult(storageBefore, Smax) {
  if (!Number.isFinite(storageBefore) || !Number.isFinite(Smax) || Smax <= 0) {
    return 1;
  }

  const sat = clamp(storageBefore / Smax, 0, 1);
  let mult = 1;

  if (sat > TUNE.WET_HOLD_START) {
    const wetFrac = clamp(
      (sat - TUNE.WET_HOLD_START) /
        Math.max(1e-6, 1 - TUNE.WET_HOLD_START),
      0,
      1
    );

    const wetReduction =
      TUNE.WET_HOLD_MAX_REDUCTION *
      Math.pow(wetFrac, TUNE.WET_HOLD_EXP);

    mult *= 1 - wetReduction;
  }

  if (sat < TUNE.MID_ACCEL_START && sat > TUNE.DRY_TAIL_START) {
    const midFrac = clamp(
      (TUNE.MID_ACCEL_START - sat) /
        Math.max(1e-6, TUNE.MID_ACCEL_START - TUNE.DRY_TAIL_START),
      0,
      1
    );

    const boost =
      TUNE.MID_ACCEL_MAX_BOOST *
      Math.pow(midFrac, TUNE.MID_ACCEL_EXP);

    mult *= 1 + boost;
  }

  return clamp(mult, 0.2, 2.5);
}

// --------------------------------------------
// NORMALIZE ROWS FOR MODEL
// --------------------------------------------
function normalizeWeatherRowsForModel(rows) {
  return (Array.isArray(rows) ? rows : []).map((w) => {
    const rainInAdj = Number.isFinite(Number(w.rainInAdj))
      ? Number(w.rainInAdj)
      : Number.isFinite(Number(w.rainIn))
      ? Number(w.rainIn)
      : 0;

    const rainMorningIn = Number.isFinite(Number(w.rainMorningIn))
      ? Number(w.rainMorningIn)
      : 0;

    const rainMiddayIn = Number.isFinite(Number(w.rainMiddayIn))
      ? Number(w.rainMiddayIn)
      : 0;

    const rainEveningIn = Number.isFinite(Number(w.rainEveningIn))
      ? Number(w.rainEveningIn)
      : 0;

    const totalTimingRain = Math.max(
      1e-6,
      rainMorningIn + rainMiddayIn + rainEveningIn
    );

    const rainMorningShare =
      rainInAdj > 0 ? clamp(rainMorningIn / totalTimingRain, 0, 1) : 0;

    const rainMiddayShare =
      rainInAdj > 0 ? clamp(rainMiddayIn / totalTimingRain, 0, 1) : 0;

    const rainEveningShare =
      rainInAdj > 0 ? clamp(rainEveningIn / totalTimingRain, 0, 1) : 0;

    const dryParts = calcDryingPower(w);

    const et0 =
      w.et0In === null || w.et0In === undefined
        ? null
        : Number(w.et0In);

    const et0N =
      et0 === null || !Number.isFinite(et0)
        ? 0
        : clamp(et0 / 0.3, 0, 1);

    const smN_day =
      w.sm010 === null ||
      w.sm010 === undefined ||
      !Number.isFinite(Number(w.sm010))
        ? 0
        : clamp((Number(w.sm010) - 0.1) / 0.25, 0, 1);

    const rowOut = {
      ...w,
      rainInAdj,
      rainMorningIn,
      rainMiddayIn,
      rainEveningIn,
      rainMorningShare,
      rainMiddayShare,
      rainEveningShare,
      rainSource: String(w.rainSource || "open-meteo"),
      et0: Number.isFinite(et0) ? et0 : 0,
      et0N,
      smN_day,
      ...dryParts
    };

    rowOut.rainTimingDryFactor = sameDayRainDryFactor(rowOut);

    return rowOut;
  });
}

// --------------------------------------------
// BASELINE SEED
// --------------------------------------------
function baselineSeedFromWindow(rowsWindow, factors) {
  const first7 = rowsWindow.slice(0, 7);

  const rain7 = first7.reduce(
    (s, x) => s + Number((x && x.rainInAdj) || 0),
    0
  );

  const rainNudgeFrac = clamp(rain7 / 8.0, 0, 1);
  const rainNudge = rainNudgeFrac * (0.10 * factors.Smax);

  const storage0 = clamp(
    0.10 * factors.Smax + rainNudge,
    0,
    factors.Smax
  );

  return { storage0 };
}

function pickSeed(rows, factors, rewindDays = 10) {
  const days = clamp(rewindDays, 3, 21);
  const startIdx = Math.max(0, rows.length - days);
  const recentRows = rows.slice(startIdx);
  const b0 = baselineSeedFromWindow(recentRows, factors);

  return {
    seedStorage: b0.storage0,
    startIdx,
    source: "rewind"
  };
}

// --------------------------------------------
// MAIN SOIL MODEL
// --------------------------------------------
function runSoilModel(weatherRows, field, opts = {}) {
  if (!Array.isArray(weatherRows) || !weatherRows.length) {
    return null;
  }

  const rows = normalizeWeatherRowsForModel(weatherRows);
  if (!rows.length) return null;

  const soilWetness = Number.isFinite(Number(field?.soilWetness))
    ? Number(field.soilWetness)
    : 60;

  const drainageIndex = Number.isFinite(Number(field?.drainageIndex))
    ? Number(field.drainageIndex)
    : 45;

  const last = rows[rows.length - 1] || {};
  const factors = mapFactors(soilWetness, drainageIndex, last.sm010);

  const rewindDays = Number.isFinite(Number(opts.rewindDays))
    ? Number(opts.rewindDays)
    : 10;

  const seedPick = pickSeed(rows, factors, rewindDays);

  let storage = clamp(seedPick.seedStorage, 0, factors.Smax);

  const trace = [];

  for (let i = seedPick.startIdx; i < rows.length; i++) {
    const d = rows[i];

    const before = storage;
    const rain = Number(d.rainInAdj || 0);

    let rainEff = effectiveRainInches(
      rain,
      before,
      factors.Smax,
      factors
    );

    rainEff = clamp(
      rainEff * EXTRA.RAIN_EFF_MULT,
      0,
      1000
    );

    const addSm = EXTRA.ADD_SM010_W * d.smN_day * 0.05;

    let rainForStorage = rainEff;

    if (rainForStorage <= 0.15) {
      rainForStorage *= 0.25;
    } else if (rainForStorage <= 0.30) {
      rainForStorage *= 0.60;
    }

    const addRain = rainForStorage * factors.infilMult;
    const add = addRain + addSm;

    let lossBase =
      Number(d.dryPwr || 0) *
      LOSS_SCALE *
      factors.dryMult *
      (1 + EXTRA.LOSS_ET0_W * d.et0N);

    const rainTimingDryFactorVal = clamp(
      Number(d.rainTimingDryFactor ?? sameDayRainDryFactor(d)),
      TUNE.SAME_DAY_LATE_RAIN_DRY_FLOOR,
      1
    );

    lossBase *= rainTimingDryFactorVal;

    const stateDryMult = storageDrydownMult(before, factors.Smax);

    let loss = lossBase * stateDryMult;
    loss = Math.max(0, loss * EXTRA.DRY_LOSS_MULT);

    if (factors.Smax > 0 && Number.isFinite(before)) {
      const sat = clamp(before / factors.Smax, 0, 1);

      if (sat < TUNE.DRY_TAIL_START) {
        const frac = clamp(
          sat / Math.max(1e-6, TUNE.DRY_TAIL_START),
          0,
          1
        );

        const mult =
          TUNE.DRY_TAIL_MIN_MULT +
          (1 - TUNE.DRY_TAIL_MIN_MULT) * frac;

        loss = loss * mult;
      }
    }

    const after = clamp(
      before + add - loss,
      0,
      factors.Smax
    );

    storage = after;

    const infilMultEff =
      rain > 0
        ? clamp(addRain / Math.max(1e-6, rain), 0, 5)
        : 0;

    trace.push({
      dateISO: d.dateISO,
      before,
      after: storage,

      rain,
      rainSource: String(d.rainSource || "unknown"),

      rainMorningIn: Number(d.rainMorningIn || 0),
      rainMiddayIn: Number(d.rainMiddayIn || 0),
      rainEveningIn: Number(d.rainEveningIn || 0),
      rainTimingDryFactor: round(rainTimingDryFactorVal, 3),

      rainEff,
      rainForStorage,
      infilMult: infilMultEff,
      addRain,
      addSm,
      add,

      lossBase,
      stateDryMult,
      loss,

      dryPwr: d.dryPwr
    });
  }

  return {
    rows,
    trace,
    factors,
    storageFinal: storage,
    seedSource: seedPick.source,
    seedStorageRaw: seedPick.seedStorage,
    startIdx: seedPick.startIdx,
    rewindDays
  };
}

// --------------------------------------------
// EXPORT
// --------------------------------------------
module.exports = {
  runSoilModel,
  normalizeWeatherRowsForModel,
  sameDayRainDryFactor,
  storageDrydownMult
};
