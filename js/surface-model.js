// ============================================
// FILE: /js/surface-model.js
// PURPOSE:
// Surface wetness logic for FarmVista model
//
// UPDATED:
// ✅ Corrected surface storage scaling
// ✅ Prevents readiness collapsing near zero
// ✅ Moderate rains now create realistic operational drag
// ✅ Slower rebound retained
// ✅ Better alignment with existing historical surface traces
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

  // --------------------------------------------
  // SURFACE STORAGE CAPACITY
  //
  // IMPORTANT:
  // Existing model traces operate on an
  // approximate 0–10 scale.
  //
  // Prior rebuild accidentally reduced cap
  // to ~1, causing nearly all fields to hit
  // maximum readiness penalty.
  // --------------------------------------------
  SURFACE_CAP_IN: 10.0,

  // --------------------------------------------
  // SURFACE RAIN CAPTURE
  // --------------------------------------------
  SURFACE_RAIN_CAPTURE: 1.00,

  // --------------------------------------------
  // READINESS PENALTY
  //
  // Moderate operational penalty.
  // Goal:
  // 0.5" rain on fit field ≈ 75-82 readiness
  // instead of collapsing to zero.
  // --------------------------------------------
  SURFACE_PENALTY_MAX: 42,
  SURFACE_PENALTY_EXP: 1.08,

  // --------------------------------------------
  // SURFACE DRYDOWN
  //
  // Slower rebound retained.
  // --------------------------------------------
  SURFACE_DRY_BASE: 0.006,

  SURFACE_DRY_DRYPWR_W: 0.22,
  SURFACE_DRY_ET0_W: 0.11,
  SURFACE_DRY_WIND_W: 0.055,
  SURFACE_DRY_SUN_W: 0.055,
  SURFACE_DRY_VPD_W: 0.045,

  SURFACE_DRY_CLOUD_W: 0.075,

  // --------------------------------------------
  // RAIN MEMORY THROTTLE
  // --------------------------------------------
  SURFACE_DRY_THROTTLE_START_FRAC: 0.18,
  SURFACE_DRY_THROTTLE_MAX_REDUCTION: 0.46,

  // --------------------------------------------
  // SURFACE → SOIL HANDOFF
  // --------------------------------------------
  SURFACE_TO_STORAGE_BASE: 0.075,
  SURFACE_TO_STORAGE_DRY_W: 0.075,
  SURFACE_TO_STORAGE_MORNING_W: 0.035,
  SURFACE_TO_STORAGE_EVENING_W: 0.075,
  SURFACE_TO_STORAGE_MAX_FRAC: 0.34,

  // --------------------------------------------
  // SURFACE HOLDING REDUCES DRYING
  // --------------------------------------------
  SURFACE_WET_HOLD_START_FRAC: 0.10,
  SURFACE_WET_HOLD_MAX_REDUCTION: 0.58,

  // --------------------------------------------
  // SURFACE-DRIVEN STORAGE FLOOR
  // --------------------------------------------
  SURFACE_STORAGE_FLOOR_W: 0.26,
  SURFACE_STORAGE_FLOOR_CAP_FRAC: 0.30
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

    capture = rain * 1.25;

  } else if (rain <= 0.25) {

    capture =
      0.125 +
      (rain - 0.10) * 1.55;

  } else if (rain <= 0.50) {

    capture =
      0.36 +
      (rain - 0.25) * 1.25;

  } else if (rain <= 1.00) {

    capture =
      0.67 +
      (rain - 0.50) * 0.72;

  } else {

    capture =
      1.03 +
      (rain - 1.00) * 0.18;
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
function surfaceDrydownInchesPerDay(parts, et0N) {

  const p =
    parts && typeof parts === "object"
      ? parts
      : {};

  const dryPwr =
    clamp(Number(p.dryPwr || 0), 0, 1);

  const windN =
    clamp(Number(p.windN || 0), 0, 1);

  const sunshineN =
    clamp(Number(p.sunshineN || 0), 0, 1);

  const vpdN =
    clamp(Number(p.vpdN || 0), 0, 1);

  const cloudN =
    clamp(Number(p.cloudN || 0), 0, 1);

  const etN =
    clamp(Number(et0N || 0), 0, 1);

  const loss =
    TUNE.SURFACE_DRY_BASE +
    TUNE.SURFACE_DRY_DRYPWR_W * dryPwr +
    TUNE.SURFACE_DRY_ET0_W * etN +
    TUNE.SURFACE_DRY_WIND_W * windN +
    TUNE.SURFACE_DRY_SUN_W * sunshineN +
    TUNE.SURFACE_DRY_VPD_W * vpdN -
    TUNE.SURFACE_DRY_CLOUD_W * cloudN;

  return clamp(
    loss,
    0,
    TUNE.SURFACE_CAP_IN
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
function surfaceToStorageFrac(row) {

  const dryPwr =
    clamp(Number(row?.dryPwr || 0), 0, 1);

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
        TUNE.SURFACE_WET_HOLD_START_FRAC || 0.10
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
  surfaceDrivenStorageFloor
};