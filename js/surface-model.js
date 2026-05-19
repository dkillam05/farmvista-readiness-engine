// ============================================
// FILE: /js/surface-model.js
// PURPOSE:
// Surface wetness logic for FarmVista model
//
// UPDATED:
// ✅ Surface wetness lingers longer after rain
// ✅ Slower surface rebound in humid/cloudy/low-sun conditions
// ✅ Reduced surface-to-soil handoff
// ✅ Stronger operational penalty from small/moderate surface wetness
// ✅ Keeps 0–10 surface wetness scale
// ============================================

// --------------------------------------------
// HELPERS
// --------------------------------------------
function clamp(n, lo, hi) {
  n = Number(n);

  if (!Number.isFinite(n)) {
    return lo;
  }

  return Math.max(lo, Math.min(hi, n));
}

// --------------------------------------------
// TUNING
// --------------------------------------------
const TUNE = {
  SURFACE_CAP_IN: 10.0,

  // Slightly stronger rain capture.
  SURFACE_RAIN_CAPTURE: 1.18,

  // Stronger penalty at low/moderate wetness.
  SURFACE_PENALTY_MAX: 48,
  SURFACE_PENALTY_EXP: 0.82,

  // Slower surface drydown.
  SURFACE_DRY_BASE: 0.002,

  SURFACE_DRY_DRYPWR_W: 0.105,
  SURFACE_DRY_ET0_W: 0.055,
  SURFACE_DRY_WIND_W: 0.025,
  SURFACE_DRY_SUN_W: 0.030,
  SURFACE_DRY_VPD_W: 0.025,

  SURFACE_DRY_CLOUD_W: 0.095,
  SURFACE_DRY_HUMIDITY_HOLD_W: 0.065,

  // Recent-rain shock helpers.
  RECENT_RAIN_3H_TRIGGER_IN: 0.20,
  RECENT_RAIN_3H_MAX_PENALTY: 14,
  RECENT_RAIN_6H_MAX_PENALTY: 8,
  RECENT_RAIN_12H_MAX_PENALTY: 4,

  // Surface → soil handoff.
  // Reduced so surface wetness does not disappear instantly.
  SURFACE_TO_STORAGE_BASE: 0.035,
  SURFACE_TO_STORAGE_DRY_W: 0.030,
  SURFACE_TO_STORAGE_MORNING_W: 0.015,
  SURFACE_TO_STORAGE_EVENING_W: 0.055,
  SURFACE_TO_STORAGE_MAX_FRAC: 0.18,

  // Surface wetness slows soil drying.
  SURFACE_WET_HOLD_START_FRAC: 0.035,
  SURFACE_WET_HOLD_MAX_REDUCTION: 0.72,

  // Surface-driven storage floor.
  SURFACE_STORAGE_FLOOR_W: 0.42,
  SURFACE_STORAGE_FLOOR_CAP_FRAC: 0.38
};

// --------------------------------------------
// SURFACE ADD FROM RAIN
// --------------------------------------------
function surfaceStorageAddFromRain(rainIn) {
  const rain =
    Math.max(0, Number(rainIn || 0));

  if (!Number.isFinite(rain) || rain <= 0) {
    return 0;
  }

  let capture;

  if (rain <= 0.10) {
    capture = rain * 1.35;
  } else if (rain <= 0.25) {
    capture =
      0.135 +
      (rain - 0.10) * 1.75;
  } else if (rain <= 0.50) {
    capture =
      0.3975 +
      (rain - 0.25) * 1.45;
  } else if (rain <= 1.00) {
    capture =
      0.76 +
      (rain - 0.50) * 0.92;
  } else {
    capture =
      1.22 +
      (rain - 1.00) * 0.28;
  }

  capture *= TUNE.SURFACE_RAIN_CAPTURE;

  return clamp(
    capture,
    0,
    TUNE.SURFACE_CAP_IN
  );
}

// --------------------------------------------
// SURFACE DRYDOWN
// --------------------------------------------
function surfaceDrydownInchesPerDay(parts, et0N, surfaceStorage = 0) {
  const p =
    parts && typeof parts === "object"
      ? parts
      : {};

  const dryPwr =
    clamp(Number(p.dryPwr || 0), 0, 1);

  const windN =
    clamp(Number(p.windN || 0), 0, 1);

  const sunshineN =
    clamp(
      Number(
        p.sunshineN ??
          p.solarN ??
          0
      ),
      0,
      1
    );

  const vpdN =
    clamp(Number(p.vpdN || 0), 0, 1);

  const cloudN =
    clamp(Number(p.cloudN || 0), 0, 1);

  const rhN =
    clamp(Number(p.rhN || 0), 0, 1);

  const etN =
    clamp(Number(et0N || 0), 0, 1);

  const surfaceFrac =
    clamp(
      Number(surfaceStorage || 0) /
        Math.max(1e-6, TUNE.SURFACE_CAP_IN),
      0,
      1
    );

  let loss =
    TUNE.SURFACE_DRY_BASE +
    TUNE.SURFACE_DRY_DRYPWR_W * dryPwr +
    TUNE.SURFACE_DRY_ET0_W * etN +
    TUNE.SURFACE_DRY_WIND_W * windN +
    TUNE.SURFACE_DRY_SUN_W * sunshineN +
    TUNE.SURFACE_DRY_VPD_W * vpdN -
    TUNE.SURFACE_DRY_CLOUD_W * cloudN -
    TUNE.SURFACE_DRY_HUMIDITY_HOLD_W * rhN;

  // If the surface is carrying more water, do not let it fully erase in one weak drying period.
  const wetHoldMult =
    clamp(
      1 - surfaceFrac * 0.35,
      0.58,
      1
    );

  loss *= wetHoldMult;

  return clamp(
    loss,
    0,
    TUNE.SURFACE_CAP_IN
  );
}

// --------------------------------------------
// RECENT RAIN SHOCK PENALTY
// --------------------------------------------
function recentRainShockPenalty(row = {}) {
  const rain3h =
    clamp(
      Number(
        row.recentRain3hIn ??
          row.mrmsRain3hIn ??
          row.rainLast3hIn ??
          0
      ),
      0,
      5
    );

  const rain6h =
    clamp(
      Number(
        row.recentRain6hIn ??
          row.mrmsRain6hIn ??
          row.rainLast6hIn ??
          0
      ),
      0,
      5
    );

  const rain12h =
    clamp(
      Number(
        row.recentRain12hIn ??
          row.mrmsRain12hIn ??
          row.rainLast12hIn ??
          0
      ),
      0,
      5
    );

  let penalty = 0;

  if (rain3h >= TUNE.RECENT_RAIN_3H_TRIGGER_IN) {
    penalty += clamp(
      (rain3h / 0.50) *
        TUNE.RECENT_RAIN_3H_MAX_PENALTY,
      0,
      TUNE.RECENT_RAIN_3H_MAX_PENALTY
    );
  }

  if (rain6h > rain3h) {
    penalty += clamp(
      ((rain6h - rain3h) / 0.50) *
        TUNE.RECENT_RAIN_6H_MAX_PENALTY,
      0,
      TUNE.RECENT_RAIN_6H_MAX_PENALTY
    );
  }

  if (rain12h > rain6h) {
    penalty += clamp(
      ((rain12h - rain6h) / 0.75) *
        TUNE.RECENT_RAIN_12H_MAX_PENALTY,
      0,
      TUNE.RECENT_RAIN_12H_MAX_PENALTY
    );
  }

  return clamp(
    penalty,
    0,
    TUNE.RECENT_RAIN_3H_MAX_PENALTY +
      TUNE.RECENT_RAIN_6H_MAX_PENALTY +
      TUNE.RECENT_RAIN_12H_MAX_PENALTY
  );
}

// --------------------------------------------
// SURFACE PENALTY
// --------------------------------------------
function surfacePenaltyFromStorage(surfaceStorage) {
  const cap =
    Math.max(
      1e-6,
      Number(TUNE.SURFACE_CAP_IN || 10)
    );

  const frac =
    clamp(
      Number(surfaceStorage || 0) / cap,
      0,
      1
    );

  return clamp(
    Math.pow(
      frac,
      TUNE.SURFACE_PENALTY_EXP
    ) *
      TUNE.SURFACE_PENALTY_MAX,
    0,
    TUNE.SURFACE_PENALTY_MAX
  );
}

// --------------------------------------------
// SURFACE → STORAGE HANDOFF FRACTION
// --------------------------------------------
function surfaceToStorageFrac(row, dryParts = {}) {
  const dryPwr =
    clamp(
      Number(
        dryParts?.dryPwr ??
          row?.dryPwr ??
          0
      ),
      0,
      1
    );

  const morning =
    clamp(
      Number(row?.rainMorningShare || 0),
      0,
      1
    );

  const evening =
    clamp(
      Number(row?.rainEveningShare || 0),
      0,
      1
    );

  const frac =
    TUNE.SURFACE_TO_STORAGE_BASE +
    TUNE.SURFACE_TO_STORAGE_DRY_W * dryPwr +
    TUNE.SURFACE_TO_STORAGE_MORNING_W * morning -
    TUNE.SURFACE_TO_STORAGE_EVENING_W * evening;

  return clamp(
    frac,
    0,
    TUNE.SURFACE_TO_STORAGE_MAX_FRAC
  );
}

// --------------------------------------------
// SURFACE WETNESS SLOWS SOIL DRYING
// --------------------------------------------
function surfaceWetHoldDryMult(surfaceStorage) {
  const cap =
    Math.max(
      1e-6,
      Number(TUNE.SURFACE_CAP_IN || 10)
    );

  const frac =
    clamp(
      Number(surfaceStorage || 0) / cap,
      0,
      1
    );

  const start =
    clamp(
      Number(
        TUNE.SURFACE_WET_HOLD_START_FRAC || 0.035
      ),
      0,
      1
    );

  if (frac <= start) {
    return 1;
  }

  const wetFrac =
    clamp(
      (frac - start) /
        Math.max(1e-6, 1 - start),
      0,
      1
    );

  const reduction =
    clamp(
      wetFrac *
        Number(
          TUNE.SURFACE_WET_HOLD_MAX_REDUCTION || 0
        ),
      0,
      0.92
    );

  return clamp(
    1 - reduction,
    0.06,
    1
  );
}

// --------------------------------------------
// SURFACE STORAGE FLOOR
// --------------------------------------------
function surfaceDrivenStorageFloor(
  surfaceStorage,
  Smax
) {
  const floorRaw =
    Number(surfaceStorage || 0) *
    Number(
      TUNE.SURFACE_STORAGE_FLOOR_W || 0
    );

  const cap =
    Number(Smax || 0) *
    Number(
      TUNE.SURFACE_STORAGE_FLOOR_CAP_FRAC || 0
    );

  return clamp(
    floorRaw,
    0,
    Math.max(0, cap)
  );
}

// --------------------------------------------
// EXPORT
// --------------------------------------------
module.exports = {
  TUNE,
  surfaceStorageAddFromRain,
  surfaceDrydownInchesPerDay,
  surfacePenaltyFromStorage,
  surfaceToStorageFrac,
  surfaceWetHoldDryMult,
  surfaceDrivenStorageFloor,
  recentRainShockPenalty
};