// /index.js (FULL FILE)
// FarmVista Field Weather proxy (Cloud Run)
// Rev: 2026-04-15a-write-fresh-weather-rows-into-latest
//
// THIS REV:
// ✅ Normal runs still roll forward from field_readiness_latest state
// ✅ Rewind is ONLY used for: new field, location change, repair/backfill, missing/bad history
// ✅ Exception rewinds still use the full 30 days
// ✅ Blends same-day forecast hours so today can keep changing intraday when archive lags
// ✅ Keeps existing Firestore write path intact
// ✅ Keeps GLOBAL_STORAGE_MULT support intact
// ✅ Adds soil temp/moisture fallback logic and extra debug fields for ST 0-10 / SM 0-10
// ✅ FIX: writes fresh weather history + forecast arrays into field_readiness_latest
// ✅ FIX: writes current rows/trace into field_readiness_latest so details panel stays current

const express = require("express");
const { attachDebugRoutes } = require("./js/debug");

// ================================
// APP SETUP
// ================================

const app = express();

app.disable("x-powered-by");

// Optional but safe defaults
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ================================
// ENV / CONFIG
// ================================

const PORT = process.env.PORT || 8080;

// Open-Meteo does NOT require a key, but we keep this for future flexibility
const OPEN_METEO_API_KEY = (process.env.OPEN_METEO_API_KEY || "").trim();

// Optional debug flag (useful later)
const IS_DEV = process.env.NODE_ENV !== "production";

// ================================
// BASIC HEALTH CHECK (recommended)
// ================================

app.get("/", async (req, res) => {
  if (req.query.run === "1") {
    try {
      const timezone = String(req.query.timezone || "America/Chicago");

      const cacheOpts = {
        days: 30,
        timezone,
        forecast_days: 7,
        gdu_base_f: 50,
        gdu_cap_f: 86
      };

      // 🔥 STEP 1: BUILD WEATHER
      const weather = await runBatchCache(cacheOpts);

      // 🔥 STEP 2: BUILD READINESS
      const runKey = makeRunKey(timezone);

      const readiness = await writeReadinessForFields(
        weather.fields,
        runKey,
        timezone,
        cacheOpts
      );

      // 🔥 FINAL RESPONSE
      return res.json({
        ok: true,
        mode: "batch_cache_plus_readiness",
        ranAt: new Date().toISOString(),
        runKey,
        weather,
        readiness
      });

    } catch (e) {
      return res.json({ error: e.message });
    }
  }

  res.send("FarmVista Weather Service Running");
});

// Optional: lock CORS to your domains (comma-separated).
const ALLOWED = (process.env.FV_ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function cors(req, res) {
  const origin = req.headers.origin || "";
  if (!ALLOWED.length) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  } else if (ALLOWED.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

app.options("*", (req, res) => {
  cors(req, res);
  res.status(204).send("");
});

/* =========================================================================
Small helpers
========================================================================= */
function num(v, d = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function clamp(n, lo, hi) {
  n = Number(n);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
function round(v, d = 2) {
  const p = Math.pow(10, d);
  return Math.round(Number(v) * p) / p;
}
function safeStr(x) {
  const s = String(x || "");
  return s ? s : "";
}
function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function safeISO10(x) {
  const s = safeStr(x);
  return s.length >= 10 ? s.slice(0, 10) : s;
}
function normalizeStatus(s) {
  return String(s || "").trim().toLowerCase();
}
function mmToIn(mm) {
  return Number(mm || 0) / 25.4;
}
function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(date, delta) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + delta);
  return d;
}
function safeArr(v) {
  return Array.isArray(v) ? v : [];
}
function safeLen(...arrs) {
  let m = 0;
  for (const a of arrs) m = Math.max(m, Array.isArray(a) ? a.length : 0);
  return m;
}
function getAt(arr, i) {
  if (!Array.isArray(arr)) return null;
  const v = arr[i];
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function getStrAt(arr, i) {
  if (!Array.isArray(arr)) return null;
  const v = arr[i];
  return typeof v === "string" && v ? v : null;
}
function cToF2(c) {
  return (Number(c) * 9) / 5 + 32;
}
function cToF(c) {
  const n = Number(c);
  if (!Number.isFinite(n)) return null;
  return (n * 9) / 5 + 32;
}
function mergeArraysByTime(a, b) {
  const out = [];
  const seen = new Set();

  for (const row of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
    const key = String(row?.time || row?.date || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }

  out.sort((x, y) =>
    String(x.time || x.date || "").localeCompare(String(y.time || y.date || ""))
  );
  return out;
}
function forecastBaseUrl() {
  return OPEN_METEO_API_KEY
    ? "https://customer-api.open-meteo.com/v1/forecast"
    : "https://api.open-meteo.com/v1/forecast";
}
function historicalBaseUrl() {
  return "https://archive-api.open-meteo.com/v1/archive";
}
function todayISOInTimeZone(timeZone) {
  try {
    const dtf = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    return dtf.format(new Date());
  } catch (_) {
    return isoDate(new Date());
  }
}
function timeToMsLocal(t) {
  try {
    if (!t || typeof t !== "string") return NaN;
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? ms : NaN;
  } catch (_) {
    return NaN;
  }
}
function locationsEqual(a, b, eps = 0.00001) {
  const alat = num(a?.lat);
  const alng = num(a?.lng);
  const blat = num(b?.lat);
  const blng = num(b?.lng);

  if (
    !Number.isFinite(alat) ||
    !Number.isFinite(alng) ||
    !Number.isFinite(blat) ||
    !Number.isFinite(blng)
  ) {
    return false;
  }

  return Math.abs(alat - blat) <= eps && Math.abs(alng - blng) <= eps;
}
function getHourLocalFromIsoLike(timeStr) {
  if (!timeStr || typeof timeStr !== "string") return null;
  const m = timeStr.match(/T(\d{2}):/);
  if (!m) return null;
  const h = Number(m[1]);
  return Number.isFinite(h) ? h : null;
}
function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/* =========================================================================
Firestore
========================================================================= */
const WEATHER_CACHE_COLLECTION =
  process.env.FV_WEATHER_CACHE_COLLECTION || "field_weather_cache";
const READINESS_LATEST_COLLECTION =
  process.env.FV_READINESS_LATEST_COLLECTION || "field_readiness_latest";
const READINESS_RUNS_COLLECTION =
  process.env.FV_READINESS_RUNS_COLLECTION || "field_readiness_runs";
const MRMS_COLLECTION = process.env.FV_MRMS_COLLECTION || "field_mrms_weather";
const READINESS_TUNING_COLLECTION =
  process.env.FV_READINESS_TUNING_COLLECTION || "field_readiness_tuning";
const READINESS_TUNING_GLOBAL_DOC =
  process.env.FV_READINESS_TUNING_GLOBAL_DOC || "global";

const DEFAULT_PAST_DAYS = 30;
const DEFAULT_FORECAST_DAYS_PROXY = 3;
const DEFAULT_FORECAST_DAYS_BATCH = 7;
const DEFAULT_BATCH_CONCURRENCY = 6;
const DEFAULT_REWIND_DAYS = Number.isFinite(Number(process.env.FV_READINESS_REWIND_DAYS))
  ? clamp(Number(process.env.FV_READINESS_REWIND_DAYS), 3, 21)
  : 10;

const LOCATION_EPSILON = Number.isFinite(Number(process.env.FV_LOCATION_EPSILON))
  ? Number(process.env.FV_LOCATION_EPSILON)
  : 0.00001;

// Open-Meteo wind_speed_10m is km/h by default.
const KMH_TO_MPH = 0.621371;

let _admin = null;
let _db = null;

function getFirestore() {
  if (_db) return _db;

  try {
    if (!_admin) _admin = require("firebase-admin");
  } catch (e) {
    const err = new Error(
      "firebase-admin is not installed. Add it to dependencies in package.json."
    );
    err.code = "MISSING_FIREBASE_ADMIN";
    throw err;
  }

  if (!_admin.apps || !_admin.apps.length) {
    _admin.initializeApp();
  }

  _db = _admin.firestore();
  return _db;
}

async function loadGlobalStorageMult() {
  try {
    const db = getFirestore();
    const snap = await db
      .collection(READINESS_TUNING_COLLECTION)
      .doc(READINESS_TUNING_GLOBAL_DOC)
      .get();

    if (!snap.exists) return 1.0;

    const d = snap.data() || {};

    const globalMult = Number(d.GLOBAL_STORAGE_MULT);
    if (Number.isFinite(globalMult) && globalMult > 0) {
      return clamp(globalMult, 0.05, 5.0);
    }

    const lastStorageMult = Number(d.lastStorageMult);
    if (Number.isFinite(lastStorageMult) && lastStorageMult > 0) {
      return clamp(lastStorageMult, 0.05, 5.0);
    }

    return 1.0;
  } catch (e) {
    console.warn("[Readiness] loadGlobalStorageMult failed:", e?.message || e);
    return 1.0;
  }
}

/* =========================================================================
Scheduler / run helpers
========================================================================= */
function isSchedulerRequest(req) {
  const ua = String(req.headers["user-agent"] || "");
  if (ua.includes("Google-Cloud-Scheduler")) return true;
  const run = String(req.query.run || "");
  return run === "1" || run === "true";
}

function makeRunKey(timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = dtf.formatToParts(new Date());
  const map = {};
  for (const p of parts) map[p.type] = p.value;

  const y = map.year || "0000";
  const mo = map.month || "01";
  const d = map.day || "01";
  const hh = map.hour || "00";
  const mm = map.minute || "00";
  return `${y}-${mo}-${d}_${hh}${mm}`;
}

async function ensureRunLockOrSkip(runKey, timezone) {
  const db = getFirestore();
  const runRef = db.collection(READINESS_RUNS_COLLECTION).doc(runKey);

  let shouldRun = false;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(runRef);
    if (snap.exists) {
      const d = snap.data() || {};
      const st = String(d.status || "");
      if (st === "done" || st === "running") {
        shouldRun = false;
        return;
      }
    }
    tx.set(
      runRef,
      {
        status: "running",
        timezone,
        startedAt: _admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    shouldRun = true;
  });

  return { shouldRun, runRef };
}

/* =========================================================================
Field extraction
========================================================================= */
function getByPath(obj, path) {
  try {
    const parts = String(path || "").split(".");
    let cur = obj;
    for (const p of parts) {
      if (!cur || typeof cur !== "object") return undefined;
      cur = cur[p];
    }
    return cur;
  } catch (_) {
    return undefined;
  }
}

function toNumMaybe(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  if (v && typeof v === "object") {
    if (typeof v.value === "number" && Number.isFinite(v.value)) return v.value;
    if (typeof v.value === "string") {
      const n = Number(String(v.value).trim());
      return Number.isFinite(n) ? n : null;
    }
    if (typeof v.n === "number" && Number.isFinite(v.n)) return v.n;
    if (typeof v.n === "string") {
      const n = Number(String(v.n).trim());
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

function pickFirstNumber(d, paths) {
  for (const p of paths) {
    const raw = getByPath(d, p);
    const n = toNumMaybe(raw);
    if (n != null) return n;
  }
  return null;
}

function isValidLatLng(lat, lng) {
  return (
    lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(Number(lat)) <= 90 &&
    Math.abs(Number(lng)) <= 180
  );
}

function extractLocation(d) {
  const lat = pickFirstNumber(d, [
    "location.lat",
    "location.latitude",
    "lat",
    "latitude",
    "gps.lat",
    "gps.latitude",
    "center.lat",
    "center.latitude",
    "fieldCenter.lat",
    "fieldCenter.latitude",
    "coordinates.lat",
    "coordinates.latitude",
    "centroid.lat",
    "centroid.latitude",
    "map.lat",
    "map.latitude"
  ]);

  const lng = pickFirstNumber(d, [
    "location.lng",
    "location.lon",
    "location.long",
    "location.longitude",
    "lng",
    "lon",
    "long",
    "longitude",
    "gps.lng",
    "gps.lon",
    "gps.long",
    "gps.longitude",
    "center.lng",
    "center.lon",
    "center.long",
    "center.longitude",
    "fieldCenter.lng",
    "fieldCenter.lon",
    "fieldCenter.long",
    "fieldCenter.longitude",
    "coordinates.lng",
    "coordinates.lon",
    "coordinates.long",
    "coordinates.longitude",
    "centroid.lng",
    "centroid.lon",
    "centroid.long",
    "centroid.longitude",
    "map.lng",
    "map.lon",
    "map.long",
    "map.longitude"
  ]);

  if (!isValidLatLng(lat, lng)) return null;

  return {
    lat: Number(lat),
    lng: Number(lng)
  };
}

function extractFieldParamsLikeFrontend(d) {
  const soilWetness = pickFirstNumber(d, [
    "soilWetness",
    "fieldReadiness.soilWetness",
    "readiness.soilWetness",
    "params.soilWetness",
    "sliders.soilWetness",
    "field_readiness.soilWetness"
  ]);

  const drainageIndex = pickFirstNumber(d, [
    "drainageIndex",
    "fieldReadiness.drainageIndex",
    "readiness.drainageIndex",
    "params.drainageIndex",
    "sliders.drainageIndex",
    "field_readiness.drainageIndex"
  ]);

  return {
    soilWetness: soilWetness == null ? null : soilWetness,
    drainageIndex: drainageIndex == null ? null : drainageIndex
  };
}

function normalizeFieldDoc(id, d) {
  const location = extractLocation(d || {});
  if (!location) return null;

  return {
    id: String(id),
    name: String(d?.name || ""),
    farmId: d?.farmId || null,
    farmName: d?.farmName || null,
    county: d?.county || null,
    state: d?.state || null,
    lat: location.lat,
    lng: location.lng,
    raw: d || {}
  };
}

async function loadActiveFieldsForBatch() {
  const db = getFirestore();
  let raw = [];

  try {
    const snap = await db.collection("fields").where("status", "==", "active").get();
    snap.forEach((doc) => raw.push({ id: doc.id, data: doc.data() || {} }));
  } catch (e) {
    console.warn("[Batch] fields query(status==active) failed:", e?.message || e);
  }

  if (!raw.length) {
    try {
      const snap2 = await db.collection("fields").get();
      snap2.forEach((doc) => raw.push({ id: doc.id, data: doc.data() || {} }));
    } catch (e) {
      console.warn("[Batch] fields query(all) failed:", e?.message || e);
      raw = [];
    }
  }

  const out = [];
  for (const r of raw) {
    const d = r.data || {};
    const st = normalizeStatus(d.status);
    if (st && st !== "active") continue;

    const field = normalizeFieldDoc(r.id, d);
    if (!field) continue;
    out.push(field);
  }

  return out;
}

async function loadFieldById(fieldId) {
  const fid = safeStr(fieldId);
  if (!fid) return null;

  const db = getFirestore();
  const snap = await db.collection("fields").doc(fid).get();
  if (!snap.exists) return null;

  const d = snap.data() || {};
  const st = normalizeStatus(d.status);
  if (st && st !== "active") return null;

  return normalizeFieldDoc(fid, d);
}

/* =========================================================================
Open-Meteo normalization
========================================================================= */
function buildSharedOpenMeteoFields() {
  return {
    hourly: [
      "precipitation",
      "temperature_2m",
      "wind_speed_10m",
      "relative_humidity_2m",
      "shortwave_radiation",
      "cloud_cover",
      "dew_point_2m",
      "vapour_pressure_deficit",
      "soil_temperature_0_to_10cm",
      "soil_temperature_10_to_40cm",
      "soil_temperature_40_to_100cm",
      "soil_temperature_100_to_200cm",
      "soil_moisture_0_to_10cm",
      "soil_moisture_10_to_40cm",
      "soil_moisture_40_to_100cm",
      "soil_moisture_100_to_200cm"
    ],
    daily: [
      "daylight_duration",
      "sunshine_duration",
      "shortwave_radiation_sum",
      "et0_fao_evapotranspiration",
      "temperature_2m_max",
      "temperature_2m_min"
    ]
  };
}

async function fetchOpenMeteoJson(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  const json = await r.json().catch(() => ({}));

  if (!r.ok) {
    const err = new Error("Open-Meteo failed");
    err.status = r.status;
    err.body = json;
    throw err;
  }

  return json;
}

function buildHistoricalUrl(lat, lng, timezone, start_date, end_date) {
  const fields = buildSharedOpenMeteoFields();
  const params = new URLSearchParams();
  params.set("latitude", String(lat));
  params.set("longitude", String(lng));
  params.set("timezone", timezone);
  params.set("start_date", start_date);
  params.set("end_date", end_date);
  params.set("hourly", fields.hourly.join(","));
  params.set("daily", fields.daily.join(","));
  if (OPEN_METEO_API_KEY) params.set("apikey", OPEN_METEO_API_KEY);
  return `${historicalBaseUrl()}?${params.toString()}`;
}

function buildForecastUrl(lat, lng, timezone, forecast_days) {
  const fields = buildSharedOpenMeteoFields();
  const params = new URLSearchParams();
  params.set("latitude", String(lat));
  params.set("longitude", String(lng));
  params.set("timezone", timezone);
  params.set("forecast_days", String(forecast_days));
  params.set("hourly", fields.hourly.join(","));
  params.set("daily", fields.daily.join(","));
  if (OPEN_METEO_API_KEY) params.set("apikey", OPEN_METEO_API_KEY);
  return `${forecastBaseUrl()}?${params.toString()}`;
}

function filterHourlyForecastBlendable(rows, todayISO) {
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    const t = String(r?.time || "");
    const d = t.slice(0, 10);
    return d >= todayISO;
  });
}

function filterDailyFutureOnly(rows, todayISO) {
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    const d = String(r?.date || "");
    return d.slice(0, 10) > todayISO;
  });
}

function normalizeHourlyCore(data) {
  const h = data?.hourly || {};
  const time = safeArr(h.time);
  const p = safeArr(h.precipitation);
  const t = safeArr(h.temperature_2m);
  const w = safeArr(h.wind_speed_10m);
  const rh = safeArr(h.relative_humidity_2m);
  const sw = safeArr(h.shortwave_radiation);

  const N = safeLen(time, p, t, w, rh, sw);
  const out = [];

  for (let i = 0; i < N; i++) {
    const rain_mm = getAt(p, i) ?? 0;
    const temp_c = getAt(t, i);
    const wind_kmh = getAt(w, i) ?? 0;
    const rh_pct = getAt(rh, i);
    const solar_wm2 = getAt(sw, i);

    out.push({
      time: getStrAt(time, i) || null,
      rain_mm,
      temp_c,
      wind_mph: Math.round(wind_kmh * KMH_TO_MPH * 10) / 10,
      rh_pct,
      solar_wm2
    });
  }
  return out;
}

function normalizeHourlyExt(data) {
  const h = data?.hourly || {};
  const time = safeArr(h.time);

  const cloud = safeArr(h.cloud_cover);
  const dp = safeArr(h.dew_point_2m);
  const vpd = safeArr(h.vapour_pressure_deficit);

  const st_0_10 = safeArr(h.soil_temperature_0_to_10cm);
  const st_10_40 = safeArr(h.soil_temperature_10_to_40cm);
  const st_40_100 = safeArr(h.soil_temperature_40_to_100cm);
  const st_100_200 = safeArr(h.soil_temperature_100_to_200cm);

  const sm_0_10 = safeArr(h.soil_moisture_0_to_10cm);
  const sm_10_40 = safeArr(h.soil_moisture_10_to_40cm);
  const sm_40_100 = safeArr(h.soil_moisture_40_to_100cm);
  const sm_100_200 = safeArr(h.soil_moisture_100_to_200cm);

  const N = safeLen(
    time,
    cloud,
    dp,
    vpd,
    st_0_10,
    st_10_40,
    st_40_100,
    st_100_200,
    sm_0_10,
    sm_10_40,
    sm_40_100,
    sm_100_200
  );

  const out = [];
  for (let i = 0; i < N; i++) {
    out.push({
      time: getStrAt(time, i) || null,

      cloud_cover_pct: getAt(cloud, i),
      dew_point_c: getAt(dp, i),
      vapour_pressure_deficit_kpa: getAt(vpd, i),

      soil_temp_c_0_10: getAt(st_0_10, i),
      soil_temp_c_10_40: getAt(st_10_40, i),
      soil_temp_c_40_100: getAt(st_40_100, i),
      soil_temp_c_100_200: getAt(st_100_200, i),

      soil_moisture_0_10: getAt(sm_0_10, i),
      soil_moisture_10_40: getAt(sm_10_40, i),
      soil_moisture_40_100: getAt(sm_40_100, i),
      soil_moisture_100_200: getAt(sm_100_200, i)
    });
  }
  return out;
}

function pickPreferredSoilTemp(row) {
  const t0 = safeNum(row?.soil_temp_c_0_10);
  const t1 = safeNum(row?.soil_temp_c_10_40);
  const t2 = safeNum(row?.soil_temp_c_40_100);
  const t3 = safeNum(row?.soil_temp_c_100_200);

  if (Number.isFinite(t0) && !(t0 === 0 && Number.isFinite(t1) && Math.abs(t1) > 0.25)) {
    return { value: t0, source: "0_10" };
  }
  if (Number.isFinite(t1)) return { value: t1, source: "10_40" };
  if (Number.isFinite(t2)) return { value: t2, source: "40_100" };
  if (Number.isFinite(t3)) return { value: t3, source: "100_200" };
  return { value: null, source: null };
}

function pickPreferredSoilMoisture(row) {
  const m0 = safeNum(row?.soil_moisture_0_10);
  const m1 = safeNum(row?.soil_moisture_10_40);
  const m2 = safeNum(row?.soil_moisture_40_100);
  const m3 = safeNum(row?.soil_moisture_100_200);

  if (Number.isFinite(m0) && !(m0 === 0 && Number.isFinite(m1) && m1 > 0.001)) {
    return { value: m0, source: "0_10" };
  }
  if (Number.isFinite(m1)) return { value: m1, source: "10_40" };
  if (Number.isFinite(m2)) return { value: m2, source: "40_100" };
  if (Number.isFinite(m3)) return { value: m3, source: "100_200" };
  return { value: null, source: null };
}

function normalizeDaily(data) {
  const d = data?.daily || {};
  const time = safeArr(d.time);

  const daylight = safeArr(d.daylight_duration);
  const sunshine = safeArr(d.sunshine_duration);
  const rad_sum = safeArr(d.shortwave_radiation_sum);
  const et0 = safeArr(d.et0_fao_evapotranspiration);

  const tmax = safeArr(d.temperature_2m_max);
  const tmin = safeArr(d.temperature_2m_min);

  const N = safeLen(time, daylight, sunshine, rad_sum, et0, tmax, tmin);
  const out = [];

  for (let i = 0; i < N; i++) {
    out.push({
      date: getStrAt(time, i) || null,
      daylight_s: getAt(daylight, i),
      sunshine_s: getAt(sunshine, i),
      shortwave_radiation_sum: getAt(rad_sum, i),
      et0_mm: getAt(et0, i),
      temp_max_c: getAt(tmax, i),
      temp_min_c: getAt(tmin, i),
      gdu: null
    });
  }
  return out;
}

function computeDailyGDU(dailyArr, gduBaseF = 50, gduCapF = 86) {
  for (const day of dailyArr) {
    const maxF = cToF(day.temp_max_c);
    const minF = cToF(day.temp_min_c);
    if (!Number.isFinite(maxF) || !Number.isFinite(minF)) {
      day.gdu = null;
      continue;
    }
    const maxFc = Math.min(maxF, gduCapF);
    const minFc = Math.min(minF, gduCapF);
    const avg = (maxFc + minFc) / 2;
    const gdu = avg - gduBaseF;
    day.gdu = Math.max(0, Math.round(gdu * 10) / 10);
  }
}

function aggregateHourlyToDailySplit(
  hourlyCore,
  hourlyExt,
  dailyArr,
  timeZone,
  keepHistDays = 30,
  keepFcstDays = 7
) {
  const map = new Map();
  const tISO = todayISOInTimeZone(timeZone || "America/Chicago");
  const nowMs = Date.now();

  function ensure(dateISO) {
    let row = map.get(dateISO);
    if (!row) {
      row = {
        dateISO,
        rain_mm_sum: 0,
        rain_mm_morning: 0,
        rain_mm_midday: 0,
        rain_mm_evening: 0,
        rain_hours_count: 0,
        last_rain_hour_local: null,

        temp_c_sum: 0,
        nt: 0,
        wind_mph_sum: 0,
        nw: 0,
        rh_sum: 0,
        nrh: 0,
        solar_sum: 0,
        ns: 0,

        cloud_sum: 0,
        ncloud: 0,
        vpd_sum: 0,
        nvpd: 0,
        dew_sum: 0,
        ndew: 0,
        sm010_sum: 0,
        nsm010: 0,
        st010_sum: 0,
        nst010: 0,
        sm010_source_counts: { "0_10": 0, "10_40": 0, "40_100": 0, "100_200": 0 },
        st010_source_counts: { "0_10": 0, "10_40": 0, "40_100": 0, "100_200": 0 },

        et0_mm: null,
        daylight_s: null,
        sunshine_s: null
      };
      map.set(dateISO, row);
    }
    return row;
  }

  function includeHour(timeStr) {
    if (!timeStr || typeof timeStr !== "string" || timeStr.length < 10) return false;
    const dateISO = timeStr.slice(0, 10);
    if (dateISO !== tISO) return true;

    const ms = timeToMsLocal(timeStr);
    if (!Number.isFinite(ms)) return true;
    return ms <= nowMs;
  }

  for (const h of hourlyCore || []) {
    const t = String(h.time || "");
    if (t.length < 10) continue;
    if (!includeHour(t)) continue;

    const dateISO = t.slice(0, 10);
    const row = ensure(dateISO);

    const rainMm = Number(h.rain_mm || 0);
    row.rain_mm_sum += rainMm;

    if (rainMm > 0) {
      row.rain_hours_count += 1;
      const hh = getHourLocalFromIsoLike(t);
      if (Number.isFinite(hh)) {
        row.last_rain_hour_local = hh;
        if (hh < 12) row.rain_mm_morning += rainMm;
        else if (hh < 17) row.rain_mm_midday += rainMm;
        else row.rain_mm_evening += rainMm;
      } else {
        row.rain_mm_midday += rainMm;
      }
    }

    const tc = Number(h.temp_c);
    if (Number.isFinite(tc)) {
      row.temp_c_sum += tc;
      row.nt++;
    }

    const w = Number(h.wind_mph);
    if (Number.isFinite(w)) {
      row.wind_mph_sum += w;
      row.nw++;
    }

    const rh = Number(h.rh_pct);
    if (Number.isFinite(rh)) {
      row.rh_sum += rh;
      row.nrh++;
    }

    const s = Number(h.solar_wm2);
    if (Number.isFinite(s)) {
      row.solar_sum += s;
      row.ns++;
    }
  }

  for (const h of hourlyExt || []) {
    const t = String(h.time || "");
    if (t.length < 10) continue;
    if (!includeHour(t)) continue;

    const dateISO = t.slice(0, 10);
    const row = ensure(dateISO);

    const cloud = Number(h.cloud_cover_pct);
    if (Number.isFinite(cloud)) {
      row.cloud_sum += cloud;
      row.ncloud++;
    }

    const vpd = Number(h.vapour_pressure_deficit_kpa);
    if (Number.isFinite(vpd)) {
      row.vpd_sum += vpd;
      row.nvpd++;
    }

    const dew = Number(h.dew_point_c);
    if (Number.isFinite(dew)) {
      row.dew_sum += dew;
      row.ndew++;
    }

    const smPick = pickPreferredSoilMoisture(h);
    if (Number.isFinite(smPick.value)) {
      row.sm010_sum += smPick.value;
      row.nsm010++;
      if (smPick.source && row.sm010_source_counts[smPick.source] != null) {
        row.sm010_source_counts[smPick.source]++;
      }
    }

    const stPick = pickPreferredSoilTemp(h);
    if (Number.isFinite(stPick.value)) {
      row.st010_sum += stPick.value;
      row.nst010++;
      if (stPick.source && row.st010_source_counts[stPick.source] != null) {
        row.st010_source_counts[stPick.source]++;
      }
    }
  }

  const dailyMap = new Map();
  for (const d of dailyArr || []) {
    const iso = String(d.dateISO || d.time || d.date || "").slice(0, 10);
    if (!iso) continue;
    dailyMap.set(iso, d);
  }

  const out = [...map.values()]
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO))
    .map((r) => {
      const rainIn = mmToIn(r.rain_mm_sum);
      const rainMorningIn = mmToIn(r.rain_mm_morning);
      const rainMiddayIn = mmToIn(r.rain_mm_midday);
      const rainEveningIn = mmToIn(r.rain_mm_evening);

      const tempF = r.nt ? cToF2(r.temp_c_sum / r.nt) : 0;
      const windMph = r.nw ? r.wind_mph_sum / r.nw : 0;
      const rh = r.nrh ? r.rh_sum / r.nrh : 0;
      const solarWm2 = r.ns ? r.solar_sum / r.ns : 0;

      const cloudPct = r.ncloud ? r.cloud_sum / r.ncloud : null;
      const vpdKpa = r.nvpd ? r.vpd_sum / r.nvpd : null;
      const dewF = r.ndew ? cToF2(r.dew_sum / r.ndew) : null;
      const sm010 = r.nsm010 ? r.sm010_sum / r.nsm010 : null;
      const st010C = r.nst010 ? (r.st010_sum / r.nst010) : null;
      const st010F = st010C === null ? null : cToF2(st010C);

      const d0 = dailyMap.get(r.dateISO) || {};
      const et0mm = Number.isFinite(Number(d0.et0_mm)) ? Number(d0.et0_mm) : null;
      const et0In = et0mm === null ? null : mmToIn(et0mm);
      const daylightHr = Number.isFinite(Number(d0.daylight_s))
        ? Number(d0.daylight_s) / 3600
        : null;
      const sunshineHr = Number.isFinite(Number(d0.sunshine_s))
        ? Number(d0.sunshine_s) / 3600
        : null;

      return {
        dateISO: r.dateISO,
        rainIn: round(rainIn, 2),
        rainMorningIn: round(rainMorningIn, 2),
        rainMiddayIn: round(rainMiddayIn, 2),
        rainEveningIn: round(rainEveningIn, 2),
        rainHoursCount: Math.round(num(r.rain_hours_count, 0)),
        lastRainHourLocal:
          Number.isFinite(Number(r.last_rain_hour_local)) ? Number(r.last_rain_hour_local) : null,

        tempF: Math.round(tempF),
        windMph: Math.round(windMph),
        rh: Math.round(rh),
        solarWm2: Math.round(solarWm2),

        cloudPct: cloudPct === null ? null : Math.round(cloudPct),
        vpdKpa: vpdKpa === null ? null : round(vpdKpa, 2),
        dewF: dewF === null ? null : Math.round(dewF),
        sm010: sm010 === null ? null : round(sm010, 3),
        sm010Pct: sm010 === null ? null : round(sm010 * 100, 1),
        sm010Hours: Math.round(num(r.nsm010, 0)),
        sm010Source:
          (Object.entries(r.sm010_source_counts || {}).sort((a, b) => b[1] - a[1])[0] || [null])[0],
        st010C: st010C === null ? null : round(st010C, 2),
        st010F: st010F === null ? null : Math.round(st010F),
        st010Hours: Math.round(num(r.nst010, 0)),
        st010Source:
          (Object.entries(r.st010_source_counts || {}).sort((a, b) => b[1] - a[1])[0] || [null])[0],

        et0In: et0In === null ? null : round(et0In, 2),
        daylightHr: daylightHr === null ? null : round(daylightHr, 1),
        sunshineHr: sunshineHr === null ? null : round(sunshineHr, 1)
      };
    });

  const hist = out.filter((d) => d.dateISO && d.dateISO <= tISO).slice(-keepHistDays);
  const fcst = out.filter((d) => d.dateISO && d.dateISO > tISO).slice(0, keepFcstDays);

  return { hist, fcst, tISO };
}

async function fetchOpenMeteo(lat, lng, days, timezone, forecast_days, gdu_base_f, gdu_cap_f) {
  const now = new Date();
  const endDate = isoDate(now);
  const startDate = isoDate(addDays(now, -(Number(days) || DEFAULT_PAST_DAYS)));
  const todayISO = todayISOInTimeZone(timezone);

  const [histJson, fcstJson] = await Promise.all([
    fetchOpenMeteoJson(buildHistoricalUrl(lat, lng, timezone, startDate, endDate)),
    fetchOpenMeteoJson(buildForecastUrl(lat, lng, timezone, forecast_days))
  ]);

  const histHourlyCore = normalizeHourlyCore(histJson);
  const histHourlyExt = normalizeHourlyExt(histJson);
  const histDaily = normalizeDaily(histJson);
  computeDailyGDU(histDaily, gdu_base_f, gdu_cap_f);

  const fcstHourlyCore = filterHourlyForecastBlendable(normalizeHourlyCore(fcstJson), todayISO);
  const fcstHourlyExt = filterHourlyForecastBlendable(normalizeHourlyExt(fcstJson), todayISO);
  const fcstDaily = filterDailyFutureOnly(normalizeDaily(fcstJson), todayISO);
  computeDailyGDU(fcstDaily, gdu_base_f, gdu_cap_f);

  const hourlyCore = mergeArraysByTime(histHourlyCore, fcstHourlyCore);
  const hourlyExt = mergeArraysByTime(histHourlyExt, fcstHourlyExt);
  const daily = mergeArraysByTime(histDaily, fcstDaily);

  const units = {
    historical: {
      hourly: histJson?.hourly_units || null,
      daily: histJson?.daily_units || null
    },
    forecast: {
      hourly: fcstJson?.hourly_units || null,
      daily: fcstJson?.daily_units || null
    }
  };

  return {
    ok: true,
    source: OPEN_METEO_API_KEY
      ? "open-meteo-historical+forecast-customer"
      : "open-meteo-historical+forecast",
    request: {
      lat,
      lng,
      days,
      timezone,
      forecast_days,
      gdu_base_f,
      gdu_cap_f,
      historical: {
        start_date: startDate,
        end_date: endDate
      }
    },
    normalized: {
      hourly: hourlyCore,
      hourly_ext: hourlyExt,
      daily,
      meta: {
        units,
        todayISO,
        note:
          "History comes from /v1/archive. Forecast hours for today and later are blended in so today can keep changing intraday when archive lag exists."
      }
    },
    raw: {
      historical: histJson,
      forecast: fcstJson
    }
  };
}

/* =========================================================================
Weather cache reset + writer
========================================================================= */
async function maybeResetWeatherCacheForLocationChange(field) {
  const db = getFirestore();
  const docRef = db.collection(WEATHER_CACHE_COLLECTION).doc(field.id);
  const snap = await docRef.get();

  if (!snap.exists) {
    return { reset: false, reason: "missing_cache_doc" };
  }

  const d = snap.data() || {};
  const cachedLoc = d.location || null;
  const fieldLoc = { lat: field.lat, lng: field.lng };

  if (locationsEqual(cachedLoc, fieldLoc, LOCATION_EPSILON)) {
    return { reset: false, reason: "location_unchanged" };
  }

  await docRef.delete();

  return {
    reset: true,
    reason: "location_changed",
    cachedLocation: cachedLoc,
    fieldLocation: fieldLoc
  };
}

async function cacheWeatherForField(field, opts) {
  const payload = await fetchOpenMeteo(
    field.lat,
    field.lng,
    opts.days,
    opts.timezone,
    opts.forecast_days,
    opts.gdu_base_f,
    opts.gdu_cap_f
  );

  const hourlyCore = Array.isArray(payload?.normalized?.hourly) ? payload.normalized.hourly : [];
  const hourlyExt = Array.isArray(payload?.normalized?.hourly_ext)
    ? payload.normalized.hourly_ext
    : [];
  const dailyArr = Array.isArray(payload?.normalized?.daily) ? payload.normalized.daily : [];

  const keepHistDays = clamp(opts.days ?? DEFAULT_PAST_DAYS, 1, 90);
  const keepFcstDays = clamp(opts.forecast_days ?? DEFAULT_FORECAST_DAYS_BATCH, 0, 16);

  const split = aggregateHourlyToDailySplit(
    hourlyCore,
    hourlyExt,
    dailyArr,
    opts.timezone,
    keepHistDays,
    keepFcstDays
  );

  const dailySeries = split.hist;
  const dailySeriesFcst = split.fcst;

  const docRef = getFirestore().collection(WEATHER_CACHE_COLLECTION).doc(field.id);

  await docRef.set(
    {
      fieldId: field.id,
      fieldName: field.name || null,
      farmId: field.farmId || null,
      farmName: field.farmName || null,
      location: { lat: field.lat, lng: field.lng },
      timezone: opts.timezone,
      fetchedAt: _admin.firestore.FieldValue.serverTimestamp(),
      source: payload.source,
      request: payload.request,
      normalized: payload.normalized,

      dailySeries,
      dailySeriesFcst,

      dailySeriesMeta: {
        todayISO: split.tISO,
        histDays: keepHistDays,
        fcstDays: keepFcstDays,
        hourlyCoreCount: hourlyCore.length,
        hourlyExtCount: hourlyExt.length
      }
    },
    { merge: true }
  );

  return true;
}

async function ensureFreshWeatherCacheForField(field, opts) {
  const resetInfo = await maybeResetWeatherCacheForLocationChange(field);
  await cacheWeatherForField(field, opts);
  return resetInfo;
}

async function runBatchCache(opts) {
  const fields = await loadActiveFieldsForBatch();
  const total = fields.length;
  const maxConc = clamp(process.env.FV_BATCH_CONCURRENCY || DEFAULT_BATCH_CONCURRENCY, 1, 20);

  let ok = 0;
  let fail = 0;
  let autoLocationResets = 0;
  const failures = [];
  let idx = 0;

  async function worker() {
    while (idx < fields.length) {
      const f = fields[idx++];
      try {
        const resetInfo = await ensureFreshWeatherCacheForField(f, opts);
        if (resetInfo?.reset) autoLocationResets++;
        ok++;
      } catch (e) {
        fail++;
        const msg = e?.body ? JSON.stringify(e.body).slice(0, 500) : e?.message || String(e);
        console.warn("[Batch] cache failed:", f.id, f.name, e?.status || "", msg);
        failures.push({
          fieldId: f.id,
          fieldName: f.name || null,
          status: e?.status || null,
          error: e?.message || "error"
        });
      }
    }
  }

  const t0 = Date.now();
  const workers = [];
  for (let i = 0; i < Math.min(maxConc, total); i++) workers.push(worker());
  await Promise.all(workers);
  const ms = Date.now() - t0;

  return {
    fields,
    total,
    ok,
    fail,
    autoLocationResets,
    ms,
    collection: WEATHER_CACHE_COLLECTION,
    failures: failures.slice(0, 25)
  };
}

/* =========================================================================
MRMS
========================================================================= */
function toYMDLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function startOfDayLocal(d) {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}
function addDaysLocal(d, delta) {
  const out = new Date(d);
  out.setDate(out.getDate() + delta);
  return out;
}
function getDefaultRainRange72h() {
  const end = new Date();
  const start = new Date(end.getTime() - 72 * 60 * 60 * 1000);
  return { start, end };
}
function getMrmsDailySeries(doc) {
  return Array.isArray(doc && doc.mrmsDailySeries30d) ? doc.mrmsDailySeries30d : [];
}
function getMrmsDailyMap(doc) {
  const rows = getMrmsDailySeries(doc);
  const map = new Map();
  for (const r of rows) {
    const key = String((r && r.dateISO) || "").trim();
    if (!key) continue;
    map.set(key, r);
  }
  return map;
}
async function loadMrmsDocMap() {
  const db = getFirestore();
  const out = new Map();

  try {
    const snap = await db.collection(MRMS_COLLECTION).get();
    snap.forEach((docSnap) => {
      out.set(String(docSnap.id), docSnap.data() || {});
    });
  } catch (e) {
    console.warn("[Readiness] loadMrmsDocMap failed:", e?.message || e);
  }

  return out;
}
function mrmsBackfillReadyServer(doc) {
  if (!doc || typeof doc !== "object") return false;

  const map = getMrmsDailyMap(doc);
  if (!map.size) return false;

  const meta = doc.mrmsHistoryMeta || {};
  const def = getDefaultRainRange72h();

  const start = startOfDayLocal(def.start);
  const end = startOfDayLocal(def.end);

  if (meta && meta.fullBackfillComplete === true) {
    let cursor = new Date(start);
    while (cursor <= end) {
      const key = toYMDLocal(cursor);
      if (!map.has(key)) return false;
      cursor = addDaysLocal(cursor, 1);
    }
    return true;
  }

  let cursor = new Date(start);
  while (cursor <= end) {
    const key = toYMDLocal(cursor);
    if (!map.has(key)) return false;
    cursor = addDaysLocal(cursor, 1);
  }

  return true;
}

function buildMrmsDailyMapRows(mrmsDoc) {
  const map = new Map();
  const rows = Array.isArray(mrmsDoc && mrmsDoc.mrmsDailySeries30d)
    ? mrmsDoc.mrmsDailySeries30d
    : [];
  for (const r of rows) {
    const iso = String((r && r.dateISO) || "").slice(0, 10);
    if (!iso) continue;
    map.set(iso, {
      dateISO: iso,
      rainMm: num(r && r.rainMm, 0),
      rainIn: mmToIn(r && r.rainMm),
      hoursCount: Math.round(num(r && r.hoursCount, 0))
    });
  }
  return map;
}

function withRainSource(rows, source) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    ...r,
    rainInAdj: num(r && r.rainInAdj, num(r && r.rainIn, 0)),
    rainSource: String(source || "open-meteo")
  }));
}

function overlayMrmsRainOntoWeatherRows(baseRows, mrmsDoc) {
  const rows = Array.isArray(baseRows) ? baseRows.slice() : [];
  if (!rows.length) return [];

  const mrmsMap = buildMrmsDailyMapRows(mrmsDoc);
  if (!mrmsMap.size) return withRainSource(rows, "open-meteo");

  return rows.map((r) => {
    const iso = String((r && r.dateISO) || "").slice(0, 10);
    const m = mrmsMap.get(iso);

    if (!m) {
      return {
        ...r,
        rainInAdj: num(r && r.rainInAdj, num(r && r.rainIn, 0)),
        rainSource: String((r && (r.rainSource || r.precipSource)) || "open-meteo")
      };
    }

    return {
      ...r,
      rainMrmsMm: round(m.rainMm, 3),
      rainMrmsIn: round(m.rainIn, 3),
      rainInAdj: round(m.rainIn, 3),
      rainSource: "mrms",
      mrmsHoursCount: m.hoursCount
    };
  });
}

function buildModelWeatherRowsForServer(wxDoc, mrmsDoc) {
  const baseRows = Array.isArray(wxDoc && wxDoc.dailySeries) ? wxDoc.dailySeries.slice() : [];
  if (!baseRows.length) return [];

  const mrmsReady = mrmsBackfillReadyServer(mrmsDoc);
  if (!mrmsReady) {
    return withRainSource(baseRows, "open-meteo");
  }

  return overlayMrmsRainOntoWeatherRows(baseRows, mrmsDoc);
}

function closedDayRowsOnly(rows, timezone) {
  const out = Array.isArray(rows) ? rows.slice() : [];
  if (!out.length) return out;

  const todayISO = todayISOInTimeZone(timezone || "America/Chicago");
  const filtered = out.filter((r) => {
    const iso = String(r?.dateISO || "").slice(0, 10);
    return !!iso && iso < todayISO;
  });

  return filtered.length ? filtered : out;
}

/* =========================================================================
Readiness math
========================================================================= */
const LOSS_SCALE = Number.isFinite(Number(process.env.FV_READINESS_LOSS_SCALE))
  ? Number(process.env.FV_READINESS_LOSS_SCALE)
  : 0.55;

const EXTRA = {
  DRYPWR_VPD_W: Number.isFinite(Number(process.env.FV_DRYPWR_VPD_W))
    ? Number(process.env.FV_DRYPWR_VPD_W)
    : 0.06,
  DRYPWR_CLOUD_W: Number.isFinite(Number(process.env.FV_DRYPWR_CLOUD_W))
    ? Number(process.env.FV_DRYPWR_CLOUD_W)
    : 0.04,
  LOSS_ET0_W: Number.isFinite(Number(process.env.FV_LOSS_ET0_W))
    ? Number(process.env.FV_LOSS_ET0_W)
    : 0.08,
  ADD_SM010_W: Number.isFinite(Number(process.env.FV_ADD_SM010_W))
    ? Number(process.env.FV_ADD_SM010_W)
    : 0.10,
  STORAGE_CAP_SM010_W: Number.isFinite(Number(process.env.FV_STORAGE_CAP_SM010_W))
    ? Number(process.env.FV_STORAGE_CAP_SM010_W)
    : 0.05,
  DRY_LOSS_MULT: Number.isFinite(Number(process.env.FV_DRY_LOSS_MULT))
    ? Number(process.env.FV_DRY_LOSS_MULT)
    : 1.0,
  RAIN_EFF_MULT: Number.isFinite(Number(process.env.FV_RAIN_EFF_MULT))
    ? Number(process.env.FV_RAIN_EFF_MULT)
    : 1.0
};

const FV_TUNE = {
  SAT_RUNOFF_START: Number.isFinite(Number(process.env.FV_SAT_RUNOFF_START))
    ? Number(process.env.FV_SAT_RUNOFF_START)
    : 0.75,
  RUNOFF_EXP: Number.isFinite(Number(process.env.FV_RUNOFF_EXP))
    ? Number(process.env.FV_RUNOFF_EXP)
    : 2.2,
  RUNOFF_DRAINPOOR_W: Number.isFinite(Number(process.env.FV_RUNOFF_DRAINPOOR_W))
    ? Number(process.env.FV_RUNOFF_DRAINPOOR_W)
    : 0.35,

  DRY_BYPASS_END: Number.isFinite(Number(process.env.FV_DRY_BYPASS_END))
    ? Number(process.env.FV_DRY_BYPASS_END)
    : 0.35,
  DRY_EXP: Number.isFinite(Number(process.env.FV_DRY_EXP))
    ? Number(process.env.FV_DRY_EXP)
    : 1.6,
  DRY_BYPASS_BASE: Number.isFinite(Number(process.env.FV_DRY_BYPASS_BASE))
    ? Number(process.env.FV_DRY_BYPASS_BASE)
    : 0.45,
  BYPASS_GOODDRAIN_W: Number.isFinite(Number(process.env.FV_BYPASS_GOODDRAIN_W))
    ? Number(process.env.FV_BYPASS_GOODDRAIN_W)
    : 0.15,

  DRY_BYPASS_CAP_SAT: Number.isFinite(Number(process.env.FV_DRY_BYPASS_CAP_SAT))
    ? Number(process.env.FV_DRY_BYPASS_CAP_SAT)
    : 0.15,
  DRY_BYPASS_CAP_MAX: Number.isFinite(Number(process.env.FV_DRY_BYPASS_CAP_MAX))
    ? Number(process.env.FV_DRY_BYPASS_CAP_MAX)
    : 0.12,

  SAT_DRYBYPASS_FLOOR: Number.isFinite(Number(process.env.FV_SAT_DRYBYPASS_FLOOR))
    ? Number(process.env.FV_SAT_DRYBYPASS_FLOOR)
    : 0.02,
  SAT_RUNOFF_CAP: Number.isFinite(Number(process.env.FV_SAT_RUNOFF_CAP))
    ? Number(process.env.FV_SAT_RUNOFF_CAP)
    : 0.85,
  RAIN_EFF_MIN: Number.isFinite(Number(process.env.FV_RAIN_EFF_MIN))
    ? Number(process.env.FV_RAIN_EFF_MIN)
    : 0.05,

  DRY_TAIL_START: Number.isFinite(Number(process.env.FV_DRY_TAIL_START))
    ? Number(process.env.FV_DRY_TAIL_START)
    : 0.12,
  DRY_TAIL_MIN_MULT: Number.isFinite(Number(process.env.FV_DRYPWR_CLOUD_W))
    ? Number(process.env.FV_DRY_TAIL_MIN_MULT)
    : 0.55,

  WET_HOLD_START: Number.isFinite(Number(process.env.FV_WET_HOLD_START))
    ? Number(process.env.FV_WET_HOLD_START)
    : 0.62,
  WET_HOLD_MAX_REDUCTION: Number.isFinite(Number(process.env.FV_WET_HOLD_MAX_REDUCTION))
    ? Number(process.env.FV_WET_HOLD_MAX_REDUCTION)
    : 0.32,
  WET_HOLD_EXP: Number.isFinite(Number(process.env.FV_WET_HOLD_EXP))
    ? Number(process.env.FV_WET_HOLD_EXP)
    : 1.7,

  MID_ACCEL_START: Number.isFinite(Number(process.env.FV_MID_ACCEL_START))
    ? Number(process.env.FV_MID_ACCEL_START)
    : 0.5,
  MID_ACCEL_MAX_BOOST: Number.isFinite(Number(process.env.FV_MID_ACCEL_MAX_BOOST))
    ? Number(process.env.FV_MID_ACCEL_MAX_BOOST)
    : 0.18,
  MID_ACCEL_EXP: Number.isFinite(Number(process.env.FV_MID_ACCEL_EXP))
    ? Number(process.env.FV_MID_ACCEL_EXP)
    : 1.35,

  SURFACE_CAP_IN: Number.isFinite(Number(process.env.FV_SURFACE_CAP_IN))
    ? Number(process.env.FV_SURFACE_CAP_IN)
    : 0.70,
  SURFACE_RAIN_CAPTURE: Number.isFinite(Number(process.env.FV_SURFACE_RAIN_CAPTURE))
    ? Number(process.env.FV_SURFACE_RAIN_CAPTURE)
    : 2.2,
  SURFACE_PENALTY_MAX: Number.isFinite(Number(process.env.FV_SURFACE_PENALTY_MAX))
    ? Number(process.env.FV_SURFACE_PENALTY_MAX)
    : 55,
  SURFACE_PENALTY_EXP: Number.isFinite(Number(process.env.FV_SURFACE_PENALTY_EXP))
    ? Number(process.env.FV_SURFACE_PENALTY_EXP)
    : 0.9,

  SURFACE_DRY_BASE: Number.isFinite(Number(process.env.FV_SURFACE_DRY_BASE))
    ? Number(process.env.FV_SURFACE_DRY_BASE)
    : 0.02,
  SURFACE_DRY_DRYPWR_W: Number.isFinite(Number(process.env.FV_SURFACE_DRY_DRYPWR_W))
    ? Number(process.env.FV_SURFACE_DRY_DRYPWR_W)
    : 0.28,
  SURFACE_DRY_ET0_W: Number.isFinite(Number(process.env.FV_SURFACE_DRY_ET0_W))
    ? Number(process.env.FV_SURFACE_DRY_ET0_W)
    : 0.18,
  SURFACE_DRY_WIND_W: Number.isFinite(Number(process.env.FV_SURFACE_DRY_WIND_W))
    ? Number(process.env.FV_SURFACE_DRY_WIND_W)
    : 0.08,
  SURFACE_DRY_SUN_W: Number.isFinite(Number(process.env.FV_SURFACE_DRY_SUN_W))
    ? Number(process.env.FV_SURFACE_DRY_SUN_W)
    : 0.08,
  SURFACE_DRY_VPD_W: Number.isFinite(Number(process.env.FV_SURFACE_DRY_VPD_W))
    ? Number(process.env.FV_SURFACE_DRY_VPD_W)
    : 0.08,
  SURFACE_DRY_CLOUD_W: Number.isFinite(Number(process.env.FV_SURFACE_DRY_CLOUD_W))
    ? Number(process.env.FV_SURFACE_DRY_CLOUD_W)
    : 0.10,

  SAME_DAY_LATE_RAIN_DRY_FLOOR: Number.isFinite(Number(process.env.FV_SAME_DAY_LATE_RAIN_DRY_FLOOR))
    ? Number(process.env.FV_SAME_DAY_LATE_RAIN_DRY_FLOOR)
    : 0.18,
  SAME_DAY_MORNING_RAIN_DRY_MIN: Number.isFinite(Number(process.env.FV_SAME_DAY_MORNING_RAIN_DRY_MIN))
    ? Number(process.env.FV_SAME_DAY_MORNING_RAIN_DRY_MIN)
    : 0.70,
  SAME_DAY_MIDDAY_RAIN_DRY_MIN: Number.isFinite(Number(process.env.FV_SAME_DAY_MIDDAY_RAIN_DRY_MIN))
    ? Number(process.env.FV_SAME_DAY_MIDDAY_RAIN_DRY_MIN)
    : 0.45,
  SAME_DAY_EVENING_RAIN_DRY_MIN: Number.isFinite(Number(process.env.FV_SAME_DAY_EVENING_RAIN_DRY_MIN))
    ? Number(process.env.FV_SAME_DAY_EVENING_RAIN_DRY_MIN)
    : 0.12,

  SURFACE_TO_STORAGE_BASE: Number.isFinite(Number(process.env.FV_SURFACE_TO_STORAGE_BASE))
    ? Number(process.env.FV_SURFACE_TO_STORAGE_BASE)
    : 0.12,
  SURFACE_TO_STORAGE_DRY_W: Number.isFinite(Number(process.env.FV_SURFACE_TO_STORAGE_DRY_W))
    ? Number(process.env.FV_SURFACE_TO_STORAGE_DRY_W)
    : 0.08,
  SURFACE_TO_STORAGE_MORNING_W: Number.isFinite(Number(process.env.FV_SURFACE_TO_STORAGE_MORNING_W))
    ? Number(process.env.FV_SURFACE_TO_STORAGE_MORNING_W)
    : 0.10,
  SURFACE_TO_STORAGE_EVENING_W: Number.isFinite(Number(process.env.FV_SURFACE_TO_STORAGE_EVENING_W))
    ? Number(process.env.FV_SURFACE_TO_STORAGE_EVENING_W)
    : 0.08,
  SURFACE_TO_STORAGE_MAX_FRAC: Number.isFinite(Number(process.env.FV_SURFACE_TO_STORAGE_MAX_FRAC))
    ? Number(process.env.FV_SURFACE_TO_STORAGE_MAX_FRAC)
    : 0.35,

  SURFACE_WET_HOLD_START_FRAC: Number.isFinite(Number(process.env.FV_SURFACE_WET_HOLD_START_FRAC))
    ? Number(process.env.FV_SURFACE_WET_HOLD_START_FRAC)
    : 0.18,
  SURFACE_WET_HOLD_MAX_REDUCTION: Number.isFinite(Number(process.env.FV_SURFACE_WET_HOLD_MAX_REDUCTION))
    ? Number(process.env.FV_SURFACE_WET_HOLD_MAX_REDUCTION)
    : 0.75,

  SURFACE_STORAGE_FLOOR_W: Number.isFinite(Number(process.env.FV_SURFACE_STORAGE_FLOOR_W))
    ? Number(process.env.FV_SURFACE_STORAGE_FLOOR_W)
    : 0.45,
  SURFACE_STORAGE_FLOOR_CAP_FRAC: Number.isFinite(
    Number(process.env.FV_SURFACE_STORAGE_FLOOR_CAP_FRAC)
  )
    ? Number(process.env.FV_SURFACE_STORAGE_FLOOR_CAP_FRAC)
    : 0.22
};

function safePct01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return clamp(n / 100, 0, 1);
}
function snap01(x) {
  const v = Number(x);
  if (!Number.isFinite(v)) return 0;
  if (v <= 0.01) return 0;
  if (v >= 0.99) return 1;
  return v;
}

function getTune() {
  const t = { ...FV_TUNE };

  t.SAT_RUNOFF_START = clamp(t.SAT_RUNOFF_START, 0.4, 0.95);
  t.RUNOFF_EXP = clamp(t.RUNOFF_EXP, 0.8, 6.0);
  t.RUNOFF_DRAINPOOR_W = clamp(t.RUNOFF_DRAINPOOR_W, 0.0, 0.8);

  t.DRY_BYPASS_END = clamp(t.DRY_BYPASS_END, 0.1, 0.7);
  t.DRY_EXP = clamp(t.DRY_EXP, 0.8, 6.0);
  t.DRY_BYPASS_BASE = clamp(t.DRY_BYPASS_BASE, 0.0, 0.85);
  t.BYPASS_GOODDRAIN_W = clamp(t.BYPASS_GOODDRAIN_W, 0.0, 0.6);

  t.DRY_BYPASS_CAP_SAT = clamp(t.DRY_BYPASS_CAP_SAT, 0.03, 0.35);
  t.DRY_BYPASS_CAP_MAX = clamp(t.DRY_BYPASS_CAP_MAX, 0.0, 0.35);

  t.SAT_DRYBYPASS_FLOOR = clamp(t.SAT_DRYBYPASS_FLOOR, 0.0, 0.2);
  t.SAT_RUNOFF_CAP = clamp(t.SAT_RUNOFF_CAP, 0.2, 0.95);
  t.RAIN_EFF_MIN = clamp(t.RAIN_EFF_MIN, 0.0, 0.2);

  t.DRY_TAIL_START = clamp(t.DRY_TAIL_START, 0.03, 0.3);
  t.DRY_TAIL_MIN_MULT = clamp(t.DRY_TAIL_MIN_MULT, 0.2, 1.0);

  t.WET_HOLD_START = clamp(t.WET_HOLD_START, 0.4, 0.9);
  t.WET_HOLD_MAX_REDUCTION = clamp(t.WET_HOLD_MAX_REDUCTION, 0.0, 0.6);
  t.WET_HOLD_EXP = clamp(t.WET_HOLD_EXP, 0.6, 4.0);

  t.MID_ACCEL_START = clamp(t.MID_ACCEL_START, t.DRY_TAIL_START + 0.05, 0.8);
  t.MID_ACCEL_MAX_BOOST = clamp(t.MID_ACCEL_MAX_BOOST, 0.0, 0.4);
  t.MID_ACCEL_EXP = clamp(t.MID_ACCEL_EXP, 0.6, 4.0);

  t.SURFACE_CAP_IN = clamp(t.SURFACE_CAP_IN, 0.1, 1.25);
  t.SURFACE_RAIN_CAPTURE = clamp(t.SURFACE_RAIN_CAPTURE, 0.2, 1.5);
  t.SURFACE_PENALTY_MAX = clamp(t.SURFACE_PENALTY_MAX, 5, 60);
  t.SURFACE_PENALTY_EXP = clamp(t.SURFACE_PENALTY_EXP, 0.6, 2.0);

  t.SURFACE_DRY_BASE = clamp(t.SURFACE_DRY_BASE, 0.0, 0.2);
  t.SURFACE_DRY_DRYPWR_W = clamp(t.SURFACE_DRY_DRYPWR_W, 0.0, 0.4);
  t.SURFACE_DRY_ET0_W = clamp(t.SURFACE_DRY_ET0_W, 0.0, 0.25);
  t.SURFACE_DRY_WIND_W = clamp(t.SURFACE_DRY_WIND_W, 0.0, 0.2);
  t.SURFACE_DRY_SUN_W = clamp(t.SURFACE_DRY_SUN_W, 0.0, 0.2);
  t.SURFACE_DRY_VPD_W = clamp(t.SURFACE_DRY_VPD_W, 0.0, 0.2);
  t.SURFACE_DRY_CLOUD_W = clamp(t.SURFACE_DRY_CLOUD_W, 0.0, 0.2);

  t.SAME_DAY_LATE_RAIN_DRY_FLOOR = clamp(t.SAME_DAY_LATE_RAIN_DRY_FLOOR, 0.05, 0.5);
  t.SAME_DAY_MORNING_RAIN_DRY_MIN = clamp(t.SAME_DAY_MORNING_RAIN_DRY_MIN, 0.35, 1.0);
  t.SAME_DAY_MIDDAY_RAIN_DRY_MIN = clamp(t.SAME_DAY_MIDDAY_RAIN_DRY_MIN, 0.2, 0.9);
  t.SAME_DAY_EVENING_RAIN_DRY_MIN = clamp(t.SAME_DAY_EVENING_RAIN_DRY_MIN, 0.05, 0.6);

  t.SURFACE_TO_STORAGE_BASE = clamp(t.SURFACE_TO_STORAGE_BASE, 0.02, 0.3);
  t.SURFACE_TO_STORAGE_DRY_W = clamp(t.SURFACE_TO_STORAGE_DRY_W, 0.0, 0.25);
  t.SURFACE_TO_STORAGE_MORNING_W = clamp(t.SURFACE_TO_STORAGE_MORNING_W, 0.0, 0.25);
  t.SURFACE_TO_STORAGE_EVENING_W = clamp(t.SURFACE_TO_STORAGE_EVENING_W, 0.0, 0.25);
  t.SURFACE_TO_STORAGE_MAX_FRAC = clamp(t.SURFACE_TO_STORAGE_MAX_FRAC, 0.05, 0.6);

  t.SURFACE_WET_HOLD_START_FRAC = clamp(t.SURFACE_WET_HOLD_START_FRAC, 0.05, 0.6);
  t.SURFACE_WET_HOLD_MAX_REDUCTION = clamp(t.SURFACE_WET_HOLD_MAX_REDUCTION, 0.0, 0.8);

  t.SURFACE_STORAGE_FLOOR_W = clamp(t.SURFACE_STORAGE_FLOOR_W, 0.0, 1.0);
  t.SURFACE_STORAGE_FLOOR_CAP_FRAC = clamp(t.SURFACE_STORAGE_FLOOR_CAP_FRAC, 0.0, 0.6);

  return t;
}

function getRateMults() {
  return {
    dryLossMult: clamp(num(EXTRA.DRY_LOSS_MULT, 1.0), 0.3, 3.0),
    rainEffMult: clamp(num(EXTRA.RAIN_EFF_MULT, 1.0), 0.3, 3.0)
  };
}

const SMAX_MIN = 3.0;
const SMAX_MAX = 5.0;
const SMAX_MID = 4.0;
const REV_POINTS_MAX = 20;

function signedCreditInchesFromSmax(Smax) {
  const s = clamp(Number(Smax), SMAX_MIN, SMAX_MAX);
  const signed = clamp((SMAX_MID - s) / 1.0, -1, 1);
  return signed * ((REV_POINTS_MAX / 100) * s);
}

function calcDryParts(r) {
  const temp = Number(r.tempF || 0);
  const wind = Number(r.windMph || 0);
  const rh = Number(r.rh || 0);
  const solar = Number(r.solarWm2 || 0);

  const tempN = clamp((temp - 20) / 45, 0, 1);
  const windN = clamp((wind - 2) / 20, 0, 1);
  const solarN = clamp((solar - 60) / 300, 0, 1);
  const rhN = clamp((rh - 35) / 65, 0, 1);

  const rawBase = 0.35 * tempN + 0.3 * solarN + 0.25 * windN - 0.25 * rhN;
  let dryPwr = clamp(rawBase, 0, 1);

  const vpd = r.vpdKpa === null || r.vpdKpa === undefined ? null : Number(r.vpdKpa);
  const cloud = r.cloudPct === null || r.cloudPct === undefined ? null : Number(r.cloudPct);

  const vpdN = vpd === null || !Number.isFinite(vpd) ? 0 : clamp(vpd / 2.6, 0, 1);
  const cloudN = cloud === null || !Number.isFinite(cloud) ? 0 : clamp(cloud / 100, 0, 1);

  dryPwr = clamp(dryPwr + EXTRA.DRYPWR_VPD_W * vpdN - EXTRA.DRYPWR_CLOUD_W * cloudN, 0, 1);

  return {
    temp,
    wind,
    rh,
    solar,
    tempN,
    windN,
    rhN,
    solarN,
    sunshineN: solarN,
    vpd: Number.isFinite(vpd) ? vpd : 0,
    vpdN,
    cloud: Number.isFinite(cloud) ? cloud : 0,
    cloudN,
    raw: rawBase,
    dryPwr
  };
}

function mapFactors(soilWetness0_100, drainageIndex0_100, sm010) {
  const soilHoldRaw = safePct01(soilWetness0_100);
  const drainPoorRaw = safePct01(drainageIndex0_100);

  const soilHold = snap01(soilHoldRaw);
  const drainPoor = snap01(drainPoorRaw);

  const smN =
    sm010 === null || sm010 === undefined || !Number.isFinite(Number(sm010))
      ? 0
      : clamp((Number(sm010) - 0.1) / 0.25, 0, 1);

  const infilMult = 0.6 + 0.3 * soilHold + 0.35 * drainPoor;
  const dryMult = 1.2 - 0.35 * soilHold - 0.4 * drainPoor;

  const SmaxBase = 3.0 + 1.0 * soilHold + 1.0 * drainPoor;
  const Smax = clamp(SmaxBase, 3.0, 5.0);

  return { soilHold, drainPoor, smN, infilMult, dryMult, Smax, SmaxBase };
}

function effectiveRainInches(rainIn, storageBefore, Smax, factors, tune) {
  const rain = Math.max(0, Number(rainIn || 0));
  if (
    !rain ||
    !Number.isFinite(rain) ||
    !Number.isFinite(storageBefore) ||
    !Number.isFinite(Smax) ||
    Smax <= 0
  ) {
    return 0;
  }

  const satRaw = storageBefore / Smax;
  const sat = clamp(satRaw, 0, 1);
  const drainPoor = clamp(Number(factors && factors.drainPoor), 0, 1);

  const sr = clamp(
    (sat - tune.SAT_RUNOFF_START) / Math.max(1e-6, 1 - tune.SAT_RUNOFF_START),
    0,
    1
  );
  let runoffFrac = Math.pow(sr, tune.RUNOFF_EXP);

  runoffFrac = runoffFrac * (1 + tune.RUNOFF_DRAINPOOR_W * drainPoor);
  runoffFrac = clamp(runoffFrac, 0, tune.SAT_RUNOFF_CAP);

  const rainAfterRunoff = rain * (1 - runoffFrac);

  const satB = Math.max(tune.SAT_DRYBYPASS_FLOOR, sat);
  const db = clamp(
    (tune.DRY_BYPASS_END - satB) / Math.max(1e-6, tune.DRY_BYPASS_END),
    0,
    1
  );
  const dryBypassCurve = Math.pow(db, tune.DRY_EXP);

  const goodDrain = 1 - drainPoor;
  let bypassFrac =
    tune.DRY_BYPASS_BASE * dryBypassCurve * (1 + tune.BYPASS_GOODDRAIN_W * goodDrain);
  bypassFrac = clamp(bypassFrac, 0, 0.9);

  if (sat < tune.DRY_BYPASS_CAP_SAT) {
    bypassFrac = Math.min(bypassFrac, tune.DRY_BYPASS_CAP_MAX);
  }

  const rainEffective = rainAfterRunoff * (1 - bypassFrac);
  const minEff = tune.RAIN_EFF_MIN * rain;
  return Math.max(minEff, rainEffective);
}

function storageDrydownMult(storageBefore, Smax, tune) {
  if (!Number.isFinite(storageBefore) || !Number.isFinite(Smax) || Smax <= 0) return 1;

  const sat = clamp(storageBefore / Smax, 0, 1);
  let mult = 1;

  if (sat > tune.WET_HOLD_START) {
    const wetFrac = clamp(
      (sat - tune.WET_HOLD_START) / Math.max(1e-6, 1 - tune.WET_HOLD_START),
      0,
      1
    );
    const wetReduction = tune.WET_HOLD_MAX_REDUCTION * Math.pow(wetFrac, tune.WET_HOLD_EXP);
    mult *= 1 - wetReduction;
  }

  if (sat < tune.MID_ACCEL_START && sat > tune.DRY_TAIL_START) {
    const midFrac = clamp(
      (tune.MID_ACCEL_START - sat) /
        Math.max(1e-6, tune.MID_ACCEL_START - tune.DRY_TAIL_START),
      0,
      1
    );
    const boost = tune.MID_ACCEL_MAX_BOOST * Math.pow(midFrac, tune.MID_ACCEL_EXP);
    mult *= 1 + boost;
  }

  return clamp(mult, 0.2, 2.5);
}

function surfaceStorageAddFromRain(rainIn, tune) {
  const rain = Math.max(0, Number(rainIn || 0));
  if (!Number.isFinite(rain) || rain <= 0) return 0;
  return clamp(rain * tune.SURFACE_RAIN_CAPTURE, 0, tune.SURFACE_CAP_IN);
}

function surfaceDrydownInchesPerDay(parts, et0N, tune) {
  const p = parts && typeof parts === "object" ? parts : {};

  const dryPwr = clamp(Number(p.dryPwr || 0), 0, 1);
  const windN = clamp(Number(p.windN || 0), 0, 1);
  const sunshineN = clamp(Number(p.sunshineN || 0), 0, 1);
  const vpdN = clamp(Number(p.vpdN || 0), 0, 1);
  const cloudN = clamp(Number(p.cloudN || 0), 0, 1);
  const etN = clamp(Number(et0N || 0), 0, 1);

  const loss =
    tune.SURFACE_DRY_BASE +
    tune.SURFACE_DRY_DRYPWR_W * dryPwr +
    tune.SURFACE_DRY_ET0_W * etN +
    tune.SURFACE_DRY_WIND_W * windN +
    tune.SURFACE_DRY_SUN_W * sunshineN +
    tune.SURFACE_DRY_VPD_W * vpdN -
    tune.SURFACE_DRY_CLOUD_W * cloudN;

  return clamp(loss, 0, tune.SURFACE_CAP_IN);
}

function surfacePenaltyFromStorage(surfaceStorage, tune) {
  const cap = Math.max(1e-6, Number(tune.SURFACE_CAP_IN || 0.6));
  const frac = clamp(Number(surfaceStorage || 0) / cap, 0, 1);
  return clamp(
    Math.pow(frac, tune.SURFACE_PENALTY_EXP) * tune.SURFACE_PENALTY_MAX,
    0,
    tune.SURFACE_PENALTY_MAX
  );
}

function sameDayRainDryFactor(row, tune) {
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
    morningShare * tune.SAME_DAY_MORNING_RAIN_DRY_MIN +
    middayShare * tune.SAME_DAY_MIDDAY_RAIN_DRY_MIN +
    eveningShare * tune.SAME_DAY_EVENING_RAIN_DRY_MIN;

  return clamp(factor, tune.SAME_DAY_LATE_RAIN_DRY_FLOOR, 1);
}

function surfaceToStorageFrac(row, tune) {
  const dryPwr = clamp(Number(row?.dryPwr || 0), 0, 1);
  const morning = clamp(Number(row?.rainMorningShare || 0), 0, 1);
  const evening = clamp(Number(row?.rainEveningShare || 0), 0, 1);

  const frac =
    tune.SURFACE_TO_STORAGE_BASE +
    tune.SURFACE_TO_STORAGE_DRY_W * dryPwr +
    tune.SURFACE_TO_STORAGE_MORNING_W * morning -
    tune.SURFACE_TO_STORAGE_EVENING_W * evening;

  return clamp(frac, 0, tune.SURFACE_TO_STORAGE_MAX_FRAC);
}

function surfaceWetHoldDryMult(surfaceStorage, tune) {
  const cap = Math.max(1e-6, Number(tune.SURFACE_CAP_IN || 0.7));
  const frac = clamp(Number(surfaceStorage || 0) / cap, 0, 1);
  const start = clamp(Number(tune.SURFACE_WET_HOLD_START_FRAC || 0.18), 0, 1);
  if (frac <= start) return 1;

  const wetFrac = clamp((frac - start) / Math.max(1e-6, 1 - start), 0, 1);
  const reduction = clamp(
    wetFrac * Number(tune.SURFACE_WET_HOLD_MAX_REDUCTION || 0),
    0,
    0.9
  );
  return clamp(1 - reduction, 0.1, 1);
}

function surfaceDrivenStorageFloor(surfaceStorage, Smax, tune) {
  const floorRaw = Number(surfaceStorage || 0) * Number(tune.SURFACE_STORAGE_FLOOR_W || 0);
  const cap = Number(Smax || 0) * Number(tune.SURFACE_STORAGE_FLOOR_CAP_FRAC || 0);
  return clamp(floorRaw, 0, Math.max(0, cap));
}

function applyCalToStorage(storagePhys, Smax) {
  const smax = Number(Smax);
  const s0 = Number(storagePhys);

  if (!Number.isFinite(smax) || smax <= 0 || !Number.isFinite(s0)) {
    return {
      storageEff: Number.isFinite(s0) ? s0 : 0,
      wetBiasApplied: 0,
      readinessShiftApplied: 0,
      wetnessDeltaApplied: 0,
      storageDeltaApplied: 0
    };
  }

  const wetBias = 0;
  const readinessShift = 0;
  const wetnessDelta = clamp(wetBias - readinessShift, -60, 60);
  const storageDelta = (wetnessDelta / 100) * smax;
  const storageEff = clamp(s0 + storageDelta, 0, smax);

  return {
    storageEff,
    wetBiasApplied: wetBias,
    readinessShiftApplied: readinessShift,
    wetnessDeltaApplied: wetnessDelta,
    storageDeltaApplied: storageDelta
  };
}

function normalizeWeatherRowsForModel(rows) {
  return (Array.isArray(rows) ? rows : []).map((w) => {
    const rainInAdj = Number.isFinite(Number(w.rainInAdj))
      ? Number(w.rainInAdj)
      : Number.isFinite(Number(w.rainIn))
      ? Number(w.rainIn)
      : 0;

    const rainMorningIn = Number.isFinite(Number(w.rainMorningIn)) ? Number(w.rainMorningIn) : 0;
    const rainMiddayIn = Number.isFinite(Number(w.rainMiddayIn)) ? Number(w.rainMiddayIn) : 0;
    const rainEveningIn = Number.isFinite(Number(w.rainEveningIn)) ? Number(w.rainEveningIn) : 0;

    const totalTimingRain = Math.max(1e-6, rainMorningIn + rainMiddayIn + rainEveningIn);
    const rainMorningShare = rainInAdj > 0 ? clamp(rainMorningIn / totalTimingRain, 0, 1) : 0;
    const rainMiddayShare = rainInAdj > 0 ? clamp(rainMiddayIn / totalTimingRain, 0, 1) : 0;
    const rainEveningShare = rainInAdj > 0 ? clamp(rainEveningIn / totalTimingRain, 0, 1) : 0;

    const parts = calcDryParts(w);

    const et0 = w.et0In === null || w.et0In === undefined ? null : Number(w.et0In);
    const et0N = et0 === null || !Number.isFinite(et0) ? 0 : clamp(et0 / 0.3, 0, 1);

    const smN2 =
      w.sm010 === null || w.sm010 === undefined || !Number.isFinite(Number(w.sm010))
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
      smN_day: smN2,
      ...parts
    };

    rowOut.rainTimingDryFactor = sameDayRainDryFactor(rowOut, getTune());

    return rowOut;
  });
}

function baselineSeedFromWindow(rowsWindow, f) {
  const first7 = rowsWindow.slice(0, 7);
  const rain7 = first7.reduce((s, x) => s + Number((x && x.rainInAdj) || 0), 0);

  const rainNudgeFrac = clamp(rain7 / 8.0, 0, 1);
  const rainNudge = rainNudgeFrac * (0.10 * f.Smax);

  const storage0 = clamp((0.10 * f.Smax) + rainNudge, 0, f.Smax);
  return { storage0 };
}

function pickSeed(rows, f) {
  const rewindDays = clamp(DEFAULT_REWIND_DAYS, 3, 21);
  const startIdx = Math.max(0, rows.length - rewindDays);
  const recentRows = rows.slice(startIdx);
  const b0 = baselineSeedFromWindow(recentRows, f);

  return {
    seedStorage: b0.storage0,
    startIdx,
    source: "rewind"
  };
}

async function runFieldReadinessCoreServer(weatherRows, soilWetness, drainageIndex) {
  if (!Array.isArray(weatherRows) || !weatherRows.length) return null;

  const rowsNorm = normalizeWeatherRowsForModel(weatherRows);
  if (!rowsNorm.length) return null;

  const last = rowsNorm[rowsNorm.length - 1] || {};
  const f = mapFactors(soilWetness, drainageIndex, last.sm010);
  const tune = getTune();
  const rate = getRateMults();

  const seedPick = pickSeed(rowsNorm, f);

  const seedStorageRaw = clamp(seedPick.seedStorage, 0, f.Smax);
  const globalStorageMult = await loadGlobalStorageMult();
  const seedStorageAdjusted = seedStorageRaw;

  let storage = seedStorageAdjusted;
  let surfaceStorage = 0;

  const trace = [];

  for (let i = seedPick.startIdx; i < rowsNorm.length; i++) {
    const d = rowsNorm[i];
    const rain = Number(d.rainInAdj || 0);
    const before = storage;
    const surfaceBefore = surfaceStorage;

    let rainEff = effectiveRainInches(rain, before, f.Smax, f, tune);
    rainEff = clamp(rainEff * rate.rainEffMult, 0, 1000);

    const addSm = EXTRA.ADD_SM010_W * d.smN_day * 0.05;

    let rainForStorage = rainEff;

    if (rainForStorage <= 0.15) {
      rainForStorage *= 0.25;
    } else if (rainForStorage <= 0.30) {
      rainForStorage *= 0.60;
    }

    const addRain = rainForStorage * f.infilMult;
    const add = addRain + addSm;

    let lossBase =
      Number(d.dryPwr || 0) *
      LOSS_SCALE *
      f.dryMult *
      (1 + EXTRA.LOSS_ET0_W * d.et0N);

    const rainTimingDryFactorVal = clamp(
      Number(d.rainTimingDryFactor ?? sameDayRainDryFactor(d, tune)),
      tune.SAME_DAY_LATE_RAIN_DRY_FLOOR,
      1
    );
    lossBase *= rainTimingDryFactorVal;

    const stateDryMult = storageDrydownMult(before, f.Smax, tune);
    const surfaceWetDryMult = surfaceWetHoldDryMult(surfaceBefore, tune);

    let loss = lossBase * stateDryMult * surfaceWetDryMult;
    loss = Math.max(0, loss * rate.dryLossMult);

    if (f.Smax > 0 && Number.isFinite(before)) {
      const sat = clamp(before / f.Smax, 0, 1);
      if (sat < tune.DRY_TAIL_START) {
        const frac = clamp(sat / Math.max(1e-6, tune.DRY_TAIL_START), 0, 1);
        const mult = tune.DRY_TAIL_MIN_MULT + (1 - tune.DRY_TAIL_MIN_MULT) * frac;
        loss = loss * mult;
      }
    }

    let after = clamp(before + add - loss, 0, f.Smax);

    const surfaceAdd = surfaceStorageAddFromRain(rain, tune);
    const surfaceDryBase = surfaceDrydownInchesPerDay(d, d.et0N, tune);
    const surfaceDry = surfaceDryBase * rainTimingDryFactorVal;

    surfaceStorage = clamp(surfaceBefore + surfaceAdd - surfaceDry, 0, tune.SURFACE_CAP_IN);

    const handoffFrac = surfaceToStorageFrac(d, tune);
    const storageRoom = Math.max(0, f.Smax - after);
    const surfaceToStorage = Math.min(surfaceStorage * handoffFrac, storageRoom);

    after = clamp(after + surfaceToStorage, 0, f.Smax);
    surfaceStorage = clamp(surfaceStorage - surfaceToStorage, 0, tune.SURFACE_CAP_IN);

    const storageFloor = surfaceDrivenStorageFloor(surfaceStorage, f.Smax, tune);
    after = Math.max(after, storageFloor);

    storage = clamp(after, 0, f.Smax);

    const infilMultEff = rain > 0 ? clamp(addRain / Math.max(1e-6, rain), 0, 5) : 0;

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
      surfaceWetDryMult,
      loss,

      dryPwr: d.dryPwr,

      surfaceBefore,
      surfaceAdd,
      surfaceDry,
      surfaceToStorage,
      surfaceAfter: surfaceStorage,
      surfacePenalty: surfacePenaltyFromStorage(surfaceStorage, tune),

      storageFloor
    });
  }

  const storagePhysFinal = storage;
  const calRes = applyCalToStorage(storagePhysFinal, f.Smax);
  const storageEff = calRes.storageEff;

  const creditIn = signedCreditInchesFromSmax(f.Smax);
  const storageForReadiness = clamp((storageEff * globalStorageMult) - creditIn, 0, f.Smax);

  const baseWetness = f.Smax > 0 ? clamp((storageForReadiness / f.Smax) * 100, 0, 100) : 0;
  const baseReadiness = clamp(100 - baseWetness, 0, 100);
  const surfacePenalty = surfacePenaltyFromStorage(surfaceStorage, tune);

  const readinessRaw = baseReadiness - surfacePenalty;
  const readiness = clamp(readinessRaw, 0, 100);
  const wetness = clamp(100 - readiness, 0, 100);

  const last7 = trace.slice(-7);
  const avgLossDay = last7.length ? last7.reduce((s, x) => s + x.loss, 0) / last7.length : 0.08;

  return {
    rows: rowsNorm,
    trace,
    factors: f,
    storagePhysFinal,
    storageFinal: calRes.storageEff,
    wetness,
    readiness,
    wetnessR: Math.round(wetness),
    readinessR: Math.round(readiness),
    baseReadiness,
    baseReadinessR: Math.round(baseReadiness),
    surfacePenalty,
    surfacePenaltyR: Math.round(surfacePenalty),
    surfaceStorageFinal: surfaceStorage,
    readinessCreditIn: creditIn,
    storageForReadiness,
    avgLossDay,
    seedSource: seedPick.source,
    rewindDays: DEFAULT_REWIND_DAYS,
    globalStorageMultApplied: globalStorageMult,
    seedStorageRaw,
    seedStorageAdjusted
  };
}

/* =========================================================================
Weather cache + readiness writers
========================================================================= */
async function ensureWeatherCacheForField(field, opts) {
  const db = getFirestore();
  const docRef = db.collection(WEATHER_CACHE_COLLECTION).doc(field.id);
  const snap = await docRef.get();

  if (snap.exists) {
    const d = snap.data() || {};
    const cachedLoc = d.location || null;
    const fieldLoc = { lat: field.lat, lng: field.lng };

    if (locationsEqual(cachedLoc, fieldLoc, LOCATION_EPSILON)) {
      return d;
    }
  }

  await ensureFreshWeatherCacheForField(field, opts);
  const snap2 = await docRef.get();
  return snap2.exists ? snap2.data() || {} : null;
}

async function writeReadinessForFields(fields, runKey, timezone, cacheOpts) {
  const db = getFirestore();

  const DEFAULT_SOIL = 60;
  const DEFAULT_DRAIN = 45;

  const mrmsMap = await loadMrmsDocMap();

  let batch = db.batch();
  let writes = 0;
  let ok = 0;
  let fail = 0;
  let autoWeatherBuilt = 0;

  for (const f of fields) {
    try {
      let wxSnap = await db.collection(WEATHER_CACHE_COLLECTION).doc(f.id).get();

      if (wxSnap.exists) {
        const wxExisting = wxSnap.data() || {};
        const cachedLoc = wxExisting.location || null;
        const fieldLoc = { lat: f.lat, lng: f.lng };
        if (!locationsEqual(cachedLoc, fieldLoc, LOCATION_EPSILON)) {
          await ensureFreshWeatherCacheForField(f, cacheOpts);
          autoWeatherBuilt++;
          wxSnap = await db.collection(WEATHER_CACHE_COLLECTION).doc(f.id).get();
        }
      }

      if (!wxSnap.exists) {
        try {
          await ensureFreshWeatherCacheForField(f, cacheOpts);
          autoWeatherBuilt++;
          wxSnap = await db.collection(WEATHER_CACHE_COLLECTION).doc(f.id).get();
        } catch (e) {
          console.warn(
            "[Readiness] auto weather build failed:",
            f.id,
            f.name,
            e?.message || e
          );
        }
      }

      if (!wxSnap.exists) {
        fail++;
        continue;
      }

      const wx = wxSnap.data() || {};

const { buildWeatherRows } = require("./js/weather-row-builder");

let weatherRows = buildWeatherRows(
  wx,
  mrmsMap.get(String(f.id)) || null,
  timezone
);

      if (!weatherRows.length) {
        const normalized = wx.normalized || null;
        if (normalized) {
          const hourlyCore = Array.isArray(normalized.hourly) ? normalized.hourly : [];
          const hourlyExt = Array.isArray(normalized.hourly_ext) ? normalized.hourly_ext : [];
          const dailyArr = Array.isArray(normalized.daily) ? normalized.daily : [];

          const split = aggregateHourlyToDailySplit(
            hourlyCore,
            hourlyExt,
            dailyArr,
            timezone,
            DEFAULT_PAST_DAYS,
            DEFAULT_FORECAST_DAYS_BATCH
          );

          weatherRows = buildModelWeatherRowsForServer(
            { dailySeries: split.hist },
            mrmsMap.get(String(f.id)) || null
          );
        }
      }

      if (!weatherRows.length) {
        fail++;
        continue;
      }

      weatherRows = weatherRows;

      if (!weatherRows.length) {
        fail++;
        continue;
      }

      const fieldDoc = await db.collection("fields").doc(f.id).get();
      const fd = fieldDoc.exists ? fieldDoc.data() || {} : {};
      const extractedParams = extractFieldParamsLikeFrontend(fd);

      const soilWetness = Number.isFinite(Number(extractedParams.soilWetness))
        ? Number(extractedParams.soilWetness)
        : DEFAULT_SOIL;

      const drainageIndex = Number.isFinite(Number(extractedParams.drainageIndex))
        ? Number(extractedParams.drainageIndex)
        : DEFAULT_DRAIN;

      const snapshot = await runFieldReadinessCoreServer(
        weatherRows,
        soilWetness,
        drainageIndex
      );

      if (!snapshot || !Number.isFinite(Number(snapshot.readinessR))) {
        fail++;
        continue;
      }

      const latestSnap = await db
        .collection(READINESS_LATEST_COLLECTION)
        .doc(f.id)
        .get();

      const latestDoc = latestSnap.exists ? (latestSnap.data() || {}) : null;

      const lastRow = Array.isArray(snapshot.rows) && snapshot.rows.length
        ? snapshot.rows[snapshot.rows.length - 1]
        : null;

      const todayRain = Number(lastRow?.rainInAdj ?? lastRow?.rainIn ?? 0);
      const priorReadiness = Number(latestDoc?.readiness);

      if (
        Number.isFinite(priorReadiness) &&
        todayRain <= 0.03 &&
        Number(snapshot.readinessR) < (priorReadiness - 3)
      ) {
        const capped = priorReadiness - 3;

        snapshot.readiness = capped;
        snapshot.readinessR = Math.round(capped);
        snapshot.wetness = 100 - snapshot.readinessR;
        snapshot.wetnessR = Math.round(snapshot.wetness);
      }

      const outRef = db.collection(READINESS_LATEST_COLLECTION).doc(f.id);
      const stateRows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
      const lastStateRow = stateRows.length ? stateRows[stateRows.length - 1] : null;
      const asOfDateISO =
        safeISO10(
          (lastStateRow && lastStateRow.dateISO) ||
            (weatherRows.length ? weatherRows[weatherRows.length - 1].dateISO : "") ||
            todayISOInTimeZone(timezone)
        ) || todayISOInTimeZone(timezone);

      const latestDailySeries = Array.isArray(wx.dailySeries) ? wx.dailySeries : [];
      const latestDailySeriesFcst = Array.isArray(wx.dailySeriesFcst) ? wx.dailySeriesFcst : [];
      const latestDailySeriesMeta = isPlainObject(wx.dailySeriesMeta) ? wx.dailySeriesMeta : {};
      const latestTrace = Array.isArray(snapshot.trace) ? snapshot.trace : [];
      const latestRows = Array.isArray(snapshot.rows) ? snapshot.rows : [];

      batch.set(
        outRef,
        {
          fieldId: f.id,
          fieldName: f.name || wx.fieldName || null,
          farmId: fd.farmId || f.farmId || null,
          farmName: fd.farmName || f.farmName || null,
          county: fd.county || f.county || null,
          state: fd.state || f.state || null,
          location: { lat: f.lat, lng: f.lng },

          readiness: Number(snapshot.readinessR),
          wetness: Number(snapshot.wetnessR),
          baseReadiness: Number(
            snapshot.baseReadinessR ?? snapshot.baseReadiness ?? snapshot.readinessR
          ),
          surfacePenalty: Number(snapshot.surfacePenaltyR ?? snapshot.surfacePenalty ?? 0),

          storageFinal: round(snapshot.storageFinal ?? 0, 4),
          storagePhysFinal: round(snapshot.storagePhysFinal ?? snapshot.storageFinal ?? 0, 4),
          storageForReadiness: round(snapshot.storageForReadiness ?? 0, 4),
          surfaceStorageFinal: round(snapshot.surfaceStorageFinal ?? 0, 4),
          readinessCreditIn: round(snapshot.readinessCreditIn ?? 0, 4),
          avgLossDay: round(snapshot.avgLossDay ?? 0, 4),

          soilWetness,
          drainageIndex,
          seedSource: String(snapshot.seedSource || "rewind"),
          rewindDays: Number(snapshot.rewindDays ?? DEFAULT_REWIND_DAYS),
          asOfDateISO,

          globalStorageMultApplied: round(snapshot.globalStorageMultApplied ?? 1.0, 6),
          seedStorageRaw: round(snapshot.seedStorageRaw ?? 0, 6),
          seedStorageAdjusted: round(snapshot.seedStorageAdjusted ?? 0, 6),

          // FIX: keep latest doc weather rows current for details weather table
          dailySeries30d: latestDailySeries,
          dailySeriesFcst: latestDailySeriesFcst,
          dailySeriesMeta: latestDailySeriesMeta,
          forecastRows: latestDailySeriesFcst,
          weatherSource: safeStr(wx.source || ""),
          weatherFetchedAt: wx.fetchedAt || null,
          computedAt: _admin.firestore.FieldValue.serverTimestamp(),

          // FIX: keep latest doc trace/model rows current for details fallbacks
          rows: latestRows,
          trace: latestTrace,

          updatedAt: _admin.firestore.FieldValue.serverTimestamp(),
          runKey: String(runKey || ""),
          timezone: String(timezone || "America/Chicago")
        },
        { merge: true }
      );

      writes++;
      ok++;

      if (writes >= 400) {
        await batch.commit();
        batch = db.batch();
        writes = 0;
      }
    } catch (e) {
      fail++;
      console.warn("[Readiness] field failed:", f.id, f.name, e?.message || e);
    }
  }

  if (writes > 0) {
    await batch.commit();
  }

  return { ok, fail, autoWeatherBuilt };
}

/* =========================================================================
Routes
========================================================================= */

app.get("/", async (req, res) => {
  cors(req, res);

  if (isSchedulerRequest(req)) {
    try {
      const timezone = String(req.query.timezone || "America/Chicago");
      const days = clamp(req.query.days ?? DEFAULT_PAST_DAYS, 1, 90);
      const forecast_days = clamp(req.query.forecast_days ?? DEFAULT_FORECAST_DAYS_BATCH, 0, 16);
      const gdu_base_f = clamp(req.query.gdu_base_f ?? 50, 30, 70);
      const gdu_cap_f = clamp(req.query.gdu_cap_f ?? 86, 60, 110);

      const cacheOpts = { days, timezone, forecast_days, gdu_base_f, gdu_cap_f };

      const out = await runBatchCache(cacheOpts);

      const runKey = String(req.query.runKey || "").trim() || makeRunKey(timezone);
      const lock = await ensureRunLockOrSkip(runKey, timezone);

      let readiness = null;
      if (lock.shouldRun) {
        readiness = await writeReadinessForFields(out.fields, runKey, timezone, cacheOpts);
        await lock.runRef.set(
          {
            status: "done",
            finishedAt: _admin.firestore.FieldValue.serverTimestamp(),
            fieldsTotal: out.total,
            fieldsOk: readiness.ok,
            fieldsFail: readiness.fail,
            autoWeatherBuilt: readiness.autoWeatherBuilt || 0
          },
          { merge: true }
        );
      } else {
        readiness = { skipped: true, reason: "runKey already processed", runKey };
      }

      return res.status(200).json({
        ok: true,
        mode: "batch_cache_plus_readiness",
        ranAt: new Date().toISOString(),
        runKey,
        weather: {
          total: out.total,
          ok: out.ok,
          fail: out.fail,
          autoLocationResets: out.autoLocationResets,
          ms: out.ms,
          collection: out.collection,
          failures: out.failures
        },
        readiness
      });
    } catch (e) {
      console.error("[Batch] run failed:", e);
      return res.status(500).json({
        ok: false,
        error: e?.message || "Batch failed",
        code: e?.code || null,
        hint:
          e?.code === "MISSING_FIREBASE_ADMIN"
            ? "Add firebase-admin to package.json dependencies and redeploy."
            : null
      });
    }
  }

  res
    .status(200)
    .send(
      "FarmVista Field Weather OK. Use /?run=1 for full batch or /api/ensure-field?fieldId=... for a new field."
    );
});

app.get("/healthz", (req, res) => {
  cors(req, res);
  res.status(200).send("ok");
});

app.get("/api/open-meteo", async (req, res) => {
  cors(req, res);

  try {
    const lat = num(req.query.lat);
    const lng = num(req.query.lng);
    const days = clamp(req.query.days ?? 30, 1, 90);
    const timezone = String(req.query.timezone || "America/Chicago");

    const forecast_days = clamp(req.query.forecast_days ?? DEFAULT_FORECAST_DAYS_PROXY, 0, 16);
    const gdu_base_f = clamp(req.query.gdu_base_f ?? 50, 30, 70);
    const gdu_cap_f = clamp(req.query.gdu_cap_f ?? 86, 60, 110);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ ok: false, error: "Missing or invalid lat/lng" });
    }

    const payload = await fetchOpenMeteo(
      lat,
      lng,
      days,
      timezone,
      forecast_days,
      gdu_base_f,
      gdu_cap_f
    );

    res.setHeader("Cache-Control", "public, max-age=300");

    return res.json({
      ok: true,
      source: payload.source,
      request: payload.request,
      normalized: payload.normalized,
      raw: payload.raw
    });
  } catch (e) {
    console.error("open-meteo proxy error:", e);
    return res.status(500).json({ ok: false, error: e.message || "Server error" });
  }
});

app.get("/api/ensure-field", async (req, res) => {
  cors(req, res);

  try {
    const fieldId = safeStr(req.query.fieldId).trim();
    if (!fieldId) {
      return res.status(400).json({ ok: false, error: "Missing fieldId" });
    }

    const timezone = String(req.query.timezone || "America/Chicago");
    const days = clamp(req.query.days ?? DEFAULT_PAST_DAYS, 1, 90);
    const forecast_days = clamp(req.query.forecast_days ?? DEFAULT_FORECAST_DAYS_BATCH, 0, 16);
    const gdu_base_f = clamp(req.query.gdu_base_f ?? 50, 30, 70);
    const gdu_cap_f = clamp(req.query.gdu_cap_f ?? 86, 60, 110);

    const field = await loadFieldById(fieldId);
    if (!field) {
      return res.status(404).json({
        ok: false,
        error: "Field not found, inactive, or missing valid lat/lng"
      });
    }

    const cacheOpts = { days, timezone, forecast_days, gdu_base_f, gdu_cap_f };

    const resetInfo = await ensureFreshWeatherCacheForField(field, cacheOpts);

    const runKey = String(req.query.runKey || "").trim() || makeRunKey(timezone);
    const readiness = await writeReadinessForFields([field], runKey, timezone, cacheOpts);

    return res.status(200).json({
      ok: true,
      mode: "ensure_single_field_weather_and_readiness",
      ranAt: new Date().toISOString(),
      fieldId,
      weatherCacheWritten: true,
      weatherLocationReset: !!resetInfo?.reset,
      weatherLocationResetReason: resetInfo?.reason || null,
      readiness
    });
  } catch (e) {
    console.error("[EnsureField] failed:", e);
    return res.status(500).json({
      ok: false,
      error: e?.message || "Ensure field failed",
      code: e?.code || null
    });
  }
});

// ================================
// ATTACH DEBUG ROUTES
// ================================

attachDebugRoutes(app, {
  db: getFirestore(),
  loadFieldById,
  buildModelWeatherRowsForServer,
  runFieldReadinessCoreServer
});

app.listen(PORT, () => {
  console.log(`farmvista-field-weather listening on ${PORT}`);
});
