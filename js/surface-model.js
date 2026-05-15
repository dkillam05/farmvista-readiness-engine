// ============================================
// FILE: /js/surface-model.js
// PURPOSE:
// Surface wetness logic for FarmVista model
//
// UPDATED:
// ✅ Light rain now creates a meaningful surface response
// ✅ Dry fields react properly to overnight rainfall
// ✅ Surface wetness dries rapidly with hot/windy conditions
// ✅ Better separation between surface wetness and soil storage
// ✅ Faster operational recovery after sunrise
// ✅ Improved realism for spring tillage / planting conditions
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
  // --------------------------------------------
  SURFACE_CAP_IN: 0.90,

  // --------------------------------------------
  // SURFACE RAIN CAPTURE
  // --------------------------------------------
  SURFACE_RAIN_CAPTURE: 0.95,

  // --------------------------------------------
  // READINESS PENALTY
  // Stronger early penalty from light surface wetness
  // --------------------------------------------
  SURFACE_PENALTY_MAX: 72,
  SURFACE_PENALTY_EXP: 0.78,

  // --------------------------------------------
  // SURFACE DRYDOWN
  // Aggressive atmospheric recovery
  // --------------------------------------------
  SURFACE_DRY_BASE: 0.01,

  SURFACE_DRY_DRYPWR_W: 0.34,
  SURFACE_DRY_ET0_W: 0.18,
  SURFACE_DRY_WIND_W: 0.10,
  SURFACE_DRY_SUN_W: 0.10,
  SURFACE_DRY_VPD_W: 0.09,

  SURFACE_DRY_CLOUD_W: 0.06,

  // --------------------------------------------
  // SURFACE → SOIL HANDOFF
  // --------------------------------------------
  SURFACE_TO_STORAGE_BASE: 0.10,
  SURFACE_TO_STORAGE_DRY_W: 0.16,
  SURFACE_TO_STORAGE_MORNING_W: 0.06,
  SURFACE_TO_STORAGE_EVENING_W: 0.06,
  SURFACE_TO_STORAGE_MAX_FRAC: 0.55,

  // --------------------------------------------
  // SURFACE HOLDING REDUCES DRYING
  // --------------------------------------------
  SURFACE_WET_HOLD_START_FRAC: 0.14,
  SURFACE_WET_HOLD_MAX_REDUCTION: 0.78,

  // --------------------------------------------
  // SURFACE-DRIVEN STORAGE FLOOR
  // --------------------------------------------
  SURFACE_STORAGE_FLOOR_W: 0.38,
  SURFACE_STORAGE_FLOOR_CAP_FRAC: 0.24
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

  // --------------------------------------------
  // GOAL:
  //
  // Small overnight rains should visibly impact
  // surface readiness even on very dry fields.
  //
  // EXAMPLE TARGET:
  // 0.15" rain on dry field:
  // readiness shock into 80s
  //
  // BUT:
  // hot/windy conditions should recover rapidly.
  // --------------------------------------------
  let capture;

  if (rain <= 0.10) {

    // very light rains
    capture = rain * 1.10;

  } else if (rain <= 0.35) {

    // light operationally meaningful rains
    capture = rain * 1.45;

  } else if (rain <= 1.0) {

    // moderate rainfall
    capture =
      0.50 +
      (rain - 0.35) * 0.78;

  } else {

    // heavy rainfall
    capture =
      1.00 +
      (rain - 1.0) * 0.10;
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

  // --------------------------------------------
  // Aggressive atmospheric drying
  //
  // Allows:
  // wet sunrise
  // → operational by afternoon
  // --------------------------------------------
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
      Number(TUNE.SURFACE_CAP_IN || 0.9)
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

  // --------------------------------------------
  // Dry sunny days:
  // surface infiltrates faster.
  //
  // Evening wetness:
  // slower infiltration transfer.
  // --------------------------------------------
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
      Number(TUNE.SURFACE_CAP_IN || 0.9)
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
        TUNE.SURFACE_WET_HOLD_START_FRAC || 0.14
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
      0.9
    );

  return clamp(
    1 - reduction,
    0.08,
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
