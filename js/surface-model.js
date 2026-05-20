// ============================================
// FILE: /js/surface-model.js
// PURPOSE:
// Surface wetness logic for FarmVista model
//
// UPDATED:
// ✅ FIXED solar drying contribution bug
// ✅ Surface rain events now persist longer
// ✅ 1"+ rains retain operational wetness longer
// ✅ Better 3–4 day surface recovery behavior
// ✅ Keeps realistic drying during hot/windy days
// ✅ Preserves soil moisture as long-term limiter
// ✅ MASTER_WETNESS_ADJUST retained
//
// MASTER_WETNESS_ADJUST:
// 0    = baseline
// +10  = slightly wetter
// +25  = noticeably wetter
// +50  = very wet/sticky
// -10  = slightly drier
// -25  = much faster drying
// ============================================

// --------------------------------------------
// MASTER WETNESS ADJUST
// --------------------------------------------
const MASTER_WETNESS_ADJUST = 0;

// --------------------------------------------
// HELPERS
// --------------------------------------------
function clamp(n, lo, hi) {

  n = Number(n);

  if (!Number.isFinite(n)) {
    return lo;
  }

  return Math.max(
    lo,
    Math.min(hi, n)
  );
}

function wetAdjust(
  base,
  pct,
  dir = 1
) {

  return base * (
    1 +
    (
      (MASTER_WETNESS_ADJUST / 100) *
      pct *
      dir
    )
  );
}

// --------------------------------------------
// TUNING
// --------------------------------------------
const TUNE = {

  // Existing traces operate on approximate 0–10 scale.
  SURFACE_CAP_IN: 10.0,

  // --------------------------------------------
  // SURFACE RAIN CAPTURE
  //
  // UPDATED:
  // Heavy rains now leave stronger surface impact.
  // This is the MAIN fix.
  // --------------------------------------------
  SURFACE_RAIN_CAPTURE:
    wetAdjust(1.10, 0.35, 1),

  // Readiness penalty.
  SURFACE_PENALTY_MAX:
    wetAdjust(44, 0.20, 1),

  SURFACE_PENALTY_EXP: 1.06,

  // --------------------------------------------
  // SURFACE DRYDOWN
  //
  // Slightly slower than before,
  // but still realistic.
  // --------------------------------------------
  SURFACE_DRY_BASE:
    wetAdjust(0.020, 0.30, -1),

  SURFACE_DRY_DRYPWR_W:
    wetAdjust(0.42, 0.35, -1),

  SURFACE_DRY_ET0_W:
    wetAdjust(0.13, 0.25, -1),

  SURFACE_DRY_WIND_W:
    wetAdjust(0.070, 0.25, -1),

  SURFACE_DRY_SUN_W:
    wetAdjust(0.090, 0.25, -1),

  SURFACE_DRY_VPD_W:
    wetAdjust(0.060, 0.25, -1),

  SURFACE_DRY_CLOUD_W:
    wetAdjust(0.055, 0.15, 1),

  // Recent-rain shock.
  RECENT_RAIN_3H_TRIGGER_IN: 0.20,
  RECENT_RAIN_3H_MAX_PENALTY: 14,
  RECENT_RAIN_6H_MAX_PENALTY: 8,
  RECENT_RAIN_12H_MAX_PENALTY: 4,

  // --------------------------------------------
  // SURFACE → SOIL HANDOFF
  //
  // Slightly slower movement into soil.
  // --------------------------------------------
  SURFACE_TO_STORAGE_BASE:
    wetAdjust(0.055, 0.25, -1),

  SURFACE_TO_STORAGE_DRY_W:
    wetAdjust(0.055, 0.25, -1),

  SURFACE_TO_STORAGE_MORNING_W:
    wetAdjust(0.028, 0.20, -1),

  SURFACE_TO_STORAGE_EVENING_W:
    wetAdjust(0.072, 0.20, 1),

  SURFACE_TO_STORAGE_MAX_FRAC:
    wetAdjust(0.26, 0.20, -1),

  // Surface wetness slows soil drying.
  SURFACE_WET_HOLD_START_FRAC:
    wetAdjust(0.06, 0.25, -1),

  SURFACE_WET_HOLD_MAX_REDUCTION:
    wetAdjust(0.72, 0.25, 1),

  // Surface-driven storage floor.
  SURFACE_STORAGE_FLOOR_W:
    wetAdjust(0.18, 0.20, 1),

  SURFACE_STORAGE_FLOOR_CAP_FRAC:
    wetAdjust(0.20, 0.20, 1)
};

// --------------------------------------------
// SURFACE ADD FROM RAIN
// --------------------------------------------
function surfaceStorageAddFromRain(rainIn) {

  const rain =
    Math.max(
      0,
      Number(rainIn || 0)
    );

  if (
    !Number.isFinite(rain) ||
    rain <= 0
  ) {
    return 0;
  }

  let capture;

  // --------------------------------------------
  // LIGHT RAIN
  // --------------------------------------------
  if (rain <= 0.10) {

    capture =
      rain * 1.20;

  // --------------------------------------------
  // SMALL RAIN
  // --------------------------------------------
  } else if (rain <= 0.25) {

    capture =
      0.12 +
      (rain - 0.10) * 1.45;

  // --------------------------------------------
  // MODERATE RAIN
  // --------------------------------------------
  } else if (rain <= 0.50) {

    capture =
      0.34 +
      (rain - 0.25) * 1.40;

  // --------------------------------------------
  // HEAVY RAIN
  //
  // UPDATED:
  // Stronger persistence zone.
  // --------------------------------------------
  } else if (rain <= 1.00) {

    capture =
      0.69 +
      (rain - 0.50) * 1.05;

  // --------------------------------------------
  // VERY HEAVY RAIN
  //
  // UPDATED:
  // 1"+ rains now create meaningful
  // multi-day surface impact.
  // --------------------------------------------
  } else {

    capture =
      1.22 +
      (rain - 1.00) * 0.52;
  }

  capture *=
    TUNE.SURFACE_RAIN_CAPTURE;

  return clamp(
    capture,
    0,
    TUNE.SURFACE_CAP_IN
  );
}

// --------------------------------------------
// SURFACE DRYDOWN
// --------------------------------------------
function surfaceDrydownInchesPerDay(
  parts,
  et0N
) {

  const p =
    parts &&
    typeof parts === "object"
      ? parts
      : {};

  const dryPwr =
    clamp(
      Number(p.dryPwr || 0),
      0,
      1
    );

  const windN =
    clamp(
      Number(p.windN || 0),
      0,
      1
    );

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
    clamp(
      Number(p.vpdN || 0),
      0,
      1
    );

  const cloudN =
    clamp(
      Number(p.cloudN || 0),
      0,
      1
    );

  const etN =
    clamp(
      Number(et0N || 0),
      0,
      1
    );

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
// --------------------------------------------
function recentRainShockPenalty(
  row = {}
) {

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

  if (
    rain3h >=
    TUNE.RECENT_RAIN_3H_TRIGGER_IN
  ) {

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
function surfacePenaltyFromStorage(
  surfaceStorage
) {

  const cap =
    Math.max(
      1e-6,
      Number(
        TUNE.SURFACE_CAP_IN || 10
      )
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
    clamp(
      Number(row?.dryPwr || 0),
      0,
      1
    );

  const morning =
    clamp(
      Number(
        row?.rainMorningShare || 0
      ),
      0,
      1
    );

  const evening =
    clamp(
      Number(
        row?.rainEveningShare || 0
      ),
      0,
      1
    );

  const frac =
    TUNE.SURFACE_TO_STORAGE_BASE +
    TUNE.SURFACE_TO_STORAGE_DRY_W *
      dryPwr +
    TUNE.SURFACE_TO_STORAGE_MORNING_W *
      morning -
    TUNE.SURFACE_TO_STORAGE_EVENING_W *
      evening;

  return clamp(
    frac,
    0,
    TUNE.SURFACE_TO_STORAGE_MAX_FRAC
  );
}

// --------------------------------------------
// SURFACE WETNESS SLOWS SOIL DRYING
// --------------------------------------------
function surfaceWetHoldDryMult(
  surfaceStorage
) {

  const cap =
    Math.max(
      1e-6,
      Number(
        TUNE.SURFACE_CAP_IN || 10
      )
    );

  const frac =
    clamp(
      Number(surfaceStorage || 0) /
        cap,
      0,
      1
    );

  const start =
    clamp(
      Number(
        TUNE.SURFACE_WET_HOLD_START_FRAC ||
          0.10
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
        Math.max(
          1e-6,
          1 - start
        ),
      0,
      1
    );

  const reduction =
    clamp(
      wetFrac *
        Number(
          TUNE.SURFACE_WET_HOLD_MAX_REDUCTION ||
            0
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
      TUNE.SURFACE_STORAGE_FLOOR_W ||
        0
    );

  const cap =
    Number(Smax || 0) *
    Number(
      TUNE.SURFACE_STORAGE_FLOOR_CAP_FRAC ||
        0
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
  MASTER_WETNESS_ADJUST,
  TUNE,
  surfaceStorageAddFromRain,
  surfaceDrydownInchesPerDay,
  surfacePenaltyFromStorage,
  surfaceToStorageFrac,
  surfaceWetHoldDryMult,
  surfaceDrivenStorageFloor,
  recentRainShockPenalty
};