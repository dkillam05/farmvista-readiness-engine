// ============================================
// FILE: /js/etaRate.js
// PURPOSE:
// Centralized ETA drydown engine
//
// UPDATED:
// ✅ Keeps same soil model
// ✅ Keeps same readiness math
// ✅ Keeps same sliders
// ✅ Uses hourlyToday when available
// ✅ Day 1 now projects remaining today from hourly forecast
// ✅ Reduces weak/diluted daily-bucket ETA problem
// ✅ Keeps backward compatibility with forecastRows only
// ✅ Does NOT change soil-model/readiness behavior
// ============================================

const { runSoilModel } = require("./soil-model");
const { calculateReadiness } = require("./readiness");

// --------------------------------------------
// HELPERS
// --------------------------------------------
function safeNum(v, fallback = null) {
  const n = Number(v);

  return Number.isFinite(n)
    ? n
    : fallback;
}

function round(v, d = 4) {
  const n = Number(v);

  if (!Number.isFinite(n)) {
    return null;
  }

  const p = Math.pow(10, d);

  return Math.round(n * p) / p;
}

function clamp(n, lo, hi) {
  n = Number(n);

  if (!Number.isFinite(n)) {
    return lo;
  }

  return Math.max(lo, Math.min(hi, n));
}

function avg(arr) {
  const clean =
    Array.isArray(arr)
      ? arr
          .map(Number)
          .filter(Number.isFinite)
      : [];

  if (!clean.length) {
    return null;
  }

  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

function sum(arr) {
  const clean =
    Array.isArray(arr)
      ? arr
          .map(Number)
          .filter(Number.isFinite)
      : [];

  return clean.reduce((a, b) => a + b, 0);
}

function weightedAvg(values, weights) {
  const pairs = [];

  for (let i = 0; i < values.length; i++) {
    const v = Number(values[i]);
    const w = Number(weights[i]);

    if (
      Number.isFinite(v) &&
      Number.isFinite(w) &&
      w > 0
    ) {
      pairs.push({ v, w });
    }
  }

  if (!pairs.length) {
    return avg(values);
  }

  const totalWeight =
    pairs.reduce((a, p) => a + p.w, 0);

  if (totalWeight <= 0) {
    return avg(values);
  }

  return pairs.reduce(
    (a, p) => a + p.v * p.w,
    0
  ) / totalWeight;
}

function getTodayISOFromHourly(hourlyToday = []) {
  const row =
    hourlyToday.find(r => r?.timeISO);

  return row?.timeISO
    ? String(row.timeISO).slice(0, 10)
    : null;
}

function getFutureHourlyRows(hourlyToday = []) {
  return Array.isArray(hourlyToday)
    ? hourlyToday.filter(r =>
        r &&
        r.isFutureHour === true &&
        r.timeISO
      )
    : [];
}

// --------------------------------------------
// Build remaining-today row from hourly forecast
//
// This fixes the ETA problem where Day 1 was
// using one weak daily bucket instead of the
// stronger remaining daytime weather.
// --------------------------------------------
function buildRemainingTodayRow(hourlyToday = []) {
  const future =
    getFutureHourlyRows(hourlyToday);

  if (!future.length) {
    return null;
  }

  const dateISO =
    getTodayISOFromHourly(future);

  if (!dateISO) {
    return null;
  }

  const temp = [];
  const wind = [];
  const rh = [];
  const solar = [];
  const rain = [];
  const et0 = [];
  const sm = [];
  const st = [];
  const vpd = [];
  const cloud = [];
  const weights = [];

  for (const h of future) {
    const solarVal =
      safeNum(h.solarWm2, 0);

    const windVal =
      safeNum(h.windMph, 0);

    const tempVal =
      safeNum(h.tempF, 0);

    // --------------------------------------------
    // Weight remaining-today ETA toward actual
    // drying-window hours instead of overnight.
    //
    // This keeps morning ETA from being too slow
    // when the afternoon is sunny/windy/warm.
    // --------------------------------------------
    const dryWeight =
      1 +
      clamp(solarVal / 500, 0, 1.5) +
      clamp((tempVal - 45) / 35, 0, 1) * 0.45 +
      clamp(windVal / 18, 0, 1) * 0.35;

    weights.push(dryWeight);

    temp.push(h.tempF);
    wind.push(h.windMph);
    rh.push(h.rh);
    solar.push(h.solarWm2);
    rain.push(h.rainIn);
    et0.push(h.et0In);
    sm.push(h.sm010);
    st.push(h.st010);
    vpd.push(h.vpdKpa);
    cloud.push(h.cloudPct);
  }

  return {
    dateISO,

    rainIn:
      sum(rain),

    rainInAdj:
      sum(rain),

    rainSource:
      "open-meteo-hourly-forecast",

    tempF:
      weightedAvg(temp, weights) ?? 0,

    windMph:
      weightedAvg(wind, weights) ?? 8,

    rh:
      weightedAvg(rh, weights) ?? 70,

    solarWm2:
      weightedAvg(solar, weights) ?? 0,

    et0In:
      sum(et0),

    sm010:
      avg(sm),

    st010:
      avg(st),

    vpdKpa:
      weightedAvg(vpd, weights),

    cloudPct:
      weightedAvg(cloud, weights),

    isTodayLive:
      true,

    hoursCount:
      clamp(future.length, 1, 24),

    etaRowSource:
      "hourly_today_remaining"
  };
}

function normalizeForecastRow(row) {
  const r = {
    ...row
  };

  const forecastRain =
    safeNum(r.rainOpenMeteoIn) ??
    safeNum(r.rainForecastIn) ??
    safeNum(r.forecastRainIn) ??
    safeNum(r.rainInAdj) ??
    safeNum(r.rainIn) ??
    0;

  r.rainIn = forecastRain;
  r.rainInAdj = forecastRain;
  r.rainSource =
    r.rainSource ||
    "open-meteo-forecast";

  r.isTodayLive = false;
  r.hoursCount = 24;

  return r;
}

function buildProjectionRows({
  forecastRows = [],
  hourlyToday = []
}) {
  const rows = [];

  const todayRow =
    buildRemainingTodayRow(hourlyToday);

  if (todayRow) {
    rows.push(todayRow);
  }

  const todayISO =
    todayRow?.dateISO || null;

  const futureDaily =
    Array.isArray(forecastRows)
      ? forecastRows
          .filter(r =>
            r &&
            r.dateISO &&
            String(r.dateISO) !== String(todayISO)
          )
          .map(normalizeForecastRow)
      : [];

  for (const r of futureDaily) {
    rows.push(r);
  }

  return rows.slice(0, 7);
}

// ============================================
// MAIN ETA ENGINE
// ============================================
function calculateEtaRate({
  currentReadiness = null,
  currentStorage = null,
  currentSurface = null,

  // Existing input
  forecastRows = [],

  // New optional input from weather-fetch.js
  hourlyToday = [],

  fieldDoc = null,
  globalStorageMult = 1.0
}) {
  const rows =
    buildProjectionRows({
      forecastRows,
      hourlyToday
    });

  if (!rows.length) {
    return {
      ok: false,
      source: "forecast_projection",
      reason: "no_projection_rows",
      etaDays: [],
      drydownPointsPerHour: null
    };
  }

  const startReadiness =
    safeNum(currentReadiness);

  let rollingStorage =
    safeNum(currentStorage);

  let rollingSurface =
    safeNum(currentSurface, 0);

  if (
    startReadiness === null ||
    rollingStorage === null
  ) {
    return {
      ok: false,
      source: "forecast_projection",
      reason: "missing_current_state",
      currentReadiness: startReadiness,
      currentStorage: rollingStorage,
      currentSurface: rollingSurface,
      etaDays: [],
      drydownPointsPerHour: null
    };
  }

  const etaDays = [];

  let priorReadiness =
    startReadiness;

  // ============================================
  // LOOP PROJECTION ROWS
  // ============================================
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    const storageStart =
      rollingStorage;

    const surfaceStart =
      rollingSurface;

    const readinessStart =
      priorReadiness;

    const model =
      runSoilModel(
        [row],
        fieldDoc || {},
        {
          seed: {
            mode: "rolling",
            storage: rollingStorage,
            surface: rollingSurface
          }
        }
      );

    if (!model) {
      etaDays.push({
        day: i + 1,
        dateISO: row.dateISO,
        ok: false,
        reason: "soil_model_failed",
        hours: safeNum(row.hoursCount, 24),
        readinessStart: round(readinessStart, 4),
        readinessEnd: round(readinessStart, 4),
        readinessGain: 0,
        drydownPointsPerHour: 0
      });

      continue;
    }

    const projected =
      calculateReadiness(
        model,
        {
          globalStorageMult,

          // ETA projects future state from current state.
          // Current live readiness already includes recent
          // rain shock, so we do not double-apply it here.
          recentRain3hIn: 0,
          recentRain6hIn: 0,
          recentRain12hIn: 0
        }
      );

    if (!projected) {
      etaDays.push({
        day: i + 1,
        dateISO: row.dateISO,
        ok: false,
        reason: "readiness_failed",
        hours: safeNum(row.hoursCount, 24),
        readinessStart: round(readinessStart, 4),
        readinessEnd: round(readinessStart, 4),
        readinessGain: 0,
        drydownPointsPerHour: 0
      });

      continue;
    }

    const projectedReadiness =
      safeNum(projected.readiness);

    if (projectedReadiness === null) {
      etaDays.push({
        day: i + 1,
        dateISO: row.dateISO,
        ok: false,
        reason: "projected_readiness_missing",
        hours: safeNum(row.hoursCount, 24),
        readinessStart: round(readinessStart, 4),
        readinessEnd: round(readinessStart, 4),
        readinessGain: 0,
        drydownPointsPerHour: 0
      });

      continue;
    }

    const hours =
      safeNum(row.hoursCount, 24);

    const readinessGain =
      projectedReadiness -
      readinessStart;

    const drydownPointsPerHour =
      hours > 0
        ? readinessGain / hours
        : 0;

    etaDays.push({
      ok: true,

      day:
        i + 1,

      dateISO:
        row.dateISO,

      rowSource:
        row.etaRowSource ||
        row.rainSource ||
        "forecast_daily",

      hours:
        round(hours, 2),

      readinessStart:
        round(readinessStart, 4),

      readinessEnd:
        round(projectedReadiness, 4),

      readinessGain:
        round(readinessGain, 4),

      drydownPointsPerHour:
        round(drydownPointsPerHour, 6),

      storageStart:
        round(storageStart, 4),

      storageEnd:
        round(model.storageFinal, 4),

      surfaceStart:
        round(surfaceStart, 4),

      surfaceEnd:
        round(model.surfaceFinal, 4),

      storageForReadiness:
        round(projected.storageForReadiness, 4),

      surfacePenalty:
        round(projected.surfacePenalty, 4),

      recentRainPenalty:
        round(projected.recentRainPenalty, 4),

      rainIn:
        round(row.rainInAdj ?? row.rainIn ?? 0, 4),

      rainSource:
        row.rainSource || "open-meteo-forecast",

      tempF:
        round(row.tempF, 2),

      windMph:
        round(row.windMph, 2),

      rh:
        round(row.rh, 2),

      solarWm2:
        round(row.solarWm2, 2),

      vpdKpa:
        round(row.vpdKpa, 4),

      cloudPct:
        round(row.cloudPct, 2),

      trace:
        Array.isArray(model.trace)
          ? model.trace
          : []
    });

    priorReadiness =
      projectedReadiness;

    rollingStorage =
      safeNum(
        model.storageFinal,
        rollingStorage
      );

    rollingSurface =
      safeNum(
        model.surfaceFinal,
        rollingSurface
      );
  }

  const totalHours =
    etaDays.reduce(
      (sum, d) =>
        sum + Number(d.hours || 0),
      0
    );

  const totalGain =
    etaDays.reduce(
      (sum, d) =>
        sum + Number(d.readinessGain || 0),
      0
    );

  const avgDrydownPerHour =
    totalHours > 0
      ? totalGain / totalHours
      : 0;

  return {
    ok: true,
    source: "forecast_projection",

    currentReadiness:
      round(startReadiness, 4),

    projectedReadiness:
      round(priorReadiness, 4),

    readinessGain:
      round(totalGain, 4),

    projectionHours:
      round(totalHours, 2),

    drydownPointsPerHour:
      round(avgDrydownPerHour, 6),

    currentStorage:
      round(currentStorage, 4),

    currentSurface:
      round(currentSurface, 4),

    projectedStorageFinal:
      round(rollingStorage, 4),

    projectedSurfaceFinal:
      round(rollingSurface, 4),

    etaDays,

    forecastRows:
      rows.length,

    usedHourlyToday:
      etaDays.some(d =>
        d.rowSource === "hourly_today_remaining"
      )
  };
}

module.exports = {
  calculateEtaRate
};