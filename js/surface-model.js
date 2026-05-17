// ============================================
// FILE: /js/surface-model.js
// PURPOSE:
// Surface wetness logic for FarmVista model
//
// UPDATED:
// ✅ Rain creates stronger operational readiness drop
// ✅ Readiness recovery is slower after rain
// ✅ Larger rains create longer wetness memory
// ✅ 0.50" rain on a dry/ready field should need several hours
//    of very good drying weather before fully recovering
// ✅ More rain = slower rebound
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
  // Higher cap allows bigger rains to linger longer.
  // --------------------------------------------
  SURFACE_CAP_IN: 1.10,

  // --------------------------------------------
  // SURFACE RAIN CAPTURE
  // Rain should create meaningful operational drag.
  // --------------------------------------------
  SURFACE_RAIN_CAPTURE: 1.00,

  // --------------------------------------------
  // READINESS PENALTY
  // Strong but not crazy. This is the direct readiness shock.
  // --------------------------------------------
  SURFACE_PENALTY_MAX: 76,
  SURFACE_PENALTY_EXP: 0.92,

  // --------------------------------------------
  // SURFACE DRYDOWN
  // Slower than previous version.
  // Good drying weather still helps, but it should not erase
  // a half-inch rain too fast.
  // --------------------------------------------
  SURFACE_DRY_BASE: 0.006,

  SURFACE_DRY_DRYPWR_W: 0.22,
  SURFACE_DRY_ET0_W: 0.11,
  SURFACE_DRY_WIND_W: 0.055,
  SURFACE_DRY_SUN_W: 0.055,
  SURFACE_DRY_VPD_W: 0.045,

  SURFACE_DRY_CLOUD_W: 0.075,

  // --------------------------------------------
  // RAIN MEMORY DRYDOWN THROTTLE
  // More surface water = slower recovery.
  // This makes bigger rains rebound slower.
  // --------------------------------------------
  SURFACE_DRY_THROTTLE_START_FRAC: 0.18,
  SURFACE_DRY_THROTTLE_MAX_REDUCTION: 0.46,

  // --------------------------------------------
  // SURFACE → SOIL HANDOFF
  // Slower handoff keeps the operational surface effect around longer.
  // --------------------------------------------
  SURFACE_TO_STORAGE_BASE: 0.075,
  SURFACE_TO_STORAGE_DRY_W: 0.075,
  SURFACE_TO_STORAGE_MORNING_W: 0.035,
  SURFACE_TO_STORAGE_EVENING_W: 0.075,
  SURFACE_TO_STORAGE_MAX_FRAC: 0.34,

  // --------------------------------------------
  // SURFACE HOLDING REDUCES DRYING
  // Wet surface should hold back soil drying harder.
  // --------------------------------------------
  SURFACE_WET_HOLD_START_FRAC: 0.10,
  SURFACE_WET_HOLD_MAX_REDUCTION: 0.88,

  // --------------------------------------------
  // SURFACE-DRIVEN STORAGE FLOOR
  // Keeps some wetness memory in the soil side after rain.
  // --------------------------------------------
  SURFACE_STORAGE_FLOOR_W: 0.48,
  SURFACE_STORAGE_FLOOR_CAP_FRAC: 0.30
};

// --------------------------------------------
// SURFACE ADD FROM RAIN
// --------------------------------------------
function surfaceStorageAddFromRain(rainIn) {
  const rain = Math.max(0, Number(rainIn || 0));

  if (!Number.isFinite(rain) || rain <= 0) {
    return 0;
  }

  let capture;

  if (rain <= 0.10) {
    // Very light rain / dew-like rain.
    capture = rain * 1.25;
  } else if (rain <= 0.25) {
    // Light rain should still be noticeable.
    capture =
      0.125 +
      (rain - 0.10) * 1.55;
  } else if (rain <= 0.50) {
    // Operationally meaningful rain.
    // 0.50" should create a real delay.
    capture =
      0.36 +
      (rain - 0.25) * 1.25;
  } else if (rain <= 1.00) {
    // Moderate rain. Bigger memory.
    capture =
      0.67 +
      (rain - 0.50) * 0.72;
  } else {
    // Heavy rain. Cap prevents insane values but keeps field wet.
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

  const dryPwr = clamp(Number(p.dryPwr || 0), 0, 1);
  const windN = clamp(Number(p.windN || 0), 0, 1);
  const sunshineN = clamp(Number(p.sunshineN || 0), 0, 1);
  const vpdN = clamp(Number(p.vpdN || 0), 0, 1);
  const cloudN = clamp(Number(p.cloudN || 0), 0, 1);
  const etN = clamp(Number(et0N || 0), 0, 1);

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
      Number(TUNE.SURFACE_CAP_IN || 1.1)
    );

  const frac =
    clamp(
      Number(surfaceStorage || 0) / cap,
      0,
      1
    );

  return clamp(
    Math.pow(frac, TUNE.SURFACE_PENALTY_EXP) *
      TUNE.SURFACE_PENALTY_MAX,
    0,
    TUNE.SURFACE_PENALTY_MAX
  );
}

// --------------------------------------------
// SURFACE → STORAGE HANDOFF FRACTION
// --------------------------------------------
function surfaceToStorageFrac(row) {
  const dryPwr = clamp(Number(row?.dryPwr || 0), 0, 1);

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
      Number(TUNE.SURFACE_CAP_IN || 1.1)
    );

  const frac =
    clamp(
      Number(surfaceStorage || 0) / cap,
      0,
      1
    );

  const start =
    clamp(
      Number(TUNE.SURFACE_WET_HOLD_START_FRAC || 0.10),
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
        Number(TUNE.SURFACE_WET_HOLD_MAX_REDUCTION || 0),
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
function surfaceDrivenStorageFloor(surfaceStorage, Smax) {
  const floorRaw =
    Number(surfaceStorage || 0) *
    Number(TUNE.SURFACE_STORAGE_FLOOR_W || 0);

  const cap =
    Number(Smax || 0) *
    Number(TUNE.SURFACE_STORAGE_FLOOR_CAP_FRAC || 0);

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