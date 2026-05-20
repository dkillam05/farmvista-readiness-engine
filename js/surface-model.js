// ============================================
// FILE: /js/surface-model.js
// PURPOSE:
// Surface wetness logic for FarmVista model
//
// UPDATED:
// ✅ Keeps existing 0–10 surface wetness scale
// ✅ Rain surface impact increased by ~10%
// ✅ Moderate rain pushes readiness harder
// ✅ Slower rebound retained
// ✅ Added optional recent-rain shock helpers for future MRMS hourly wiring
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
  // Existing traces operate on approximate 0–10 scale.
  SURFACE_CAP_IN: 10.0,

  // UPDATED:
  // Was 1.00. Raised 10% so rain has stronger surface impact.
  SURFACE_RAIN_CAPTURE: 1.10,

  // Readiness penalty from surface wetness.
  // Slightly firm but not catastrophic.
  SURFACE_PENALTY_MAX: 44,
  SURFACE_PENALTY_EXP: 1.06,

  // Surface drydown.
  SURFACE_DRY_BASE: 0.006,

  SURFACE_DRY_DRYPWR_W: 0.22,
  SURFACE_DRY_ET0_W: 0.11,
  SURFACE_DRY_WIND_W: 0.055,
  SURFACE_DRY_SUN_W: 0.055,
  SURFACE_DRY_VPD_W: 0.045,

  SURFACE_DRY_CLOUD_W: 0.075,

  // Recent-rain shock.
  // These only apply if recent MRMS rain values are wired in later.
  RECENT_RAIN_3H_TRIGGER_IN: 0.20,
  RECENT_RAIN_3H_MAX_PENALTY: 14,
  RECENT_RAIN_6H_MAX_PENALTY: 8,
  RECENT_RAIN_12H_MAX_PENALTY: 4,

  // Surface → soil handoff.
  SURFACE_TO_STORAGE_BASE: 0.075,
  SURFACE_TO_STORAGE_DRY_W: 0.075,
  SURFACE_TO_STORAGE_MORNING_W: 0.035,
  SURFACE_TO_STORAGE_EVENING_W: 0.075,
  SURFACE_TO_STORAGE_MAX_FRAC: 0.34,

  // Surface wetness slows soil drying.
  SURFACE_WET_HOLD_START_FRAC: 0.10,
  SURFACE_WET_HOLD_MAX_REDUCTION: 0.62,

  // Surface-driven storage floor.
  SURFACE_STORAGE_FLOOR_W: 0.29,
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
// RECENT RAIN SHOCK PENALTY
//
// Optional helper.
// This will only affect readiness once recent MRMS
// values are passed into readiness calculation later.
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
  surfaceDrivenStorageFloor,
  recentRainShockPenalty
};