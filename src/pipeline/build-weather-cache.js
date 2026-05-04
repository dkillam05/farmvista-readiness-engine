const fetch = require("node-fetch");

/* ================================
CONFIG
================================ */
const BASE_URL = "https://archive-api.open-meteo.com/v1/archive";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

/* ================================
HELPERS
================================ */
function avg(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function sum(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0);
}

function round(v, d = 2) {
  if (!Number.isFinite(v)) return null;
  const p = Math.pow(10, d);
  return Math.round(v * p) / p;
}

function getTodayISO() {
  return new Date().toISOString().slice(0, 10);
}

function getPastDateISO(daysBack) {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

/* ================================
FETCH WEATHER (🔥 FIXED FALLBACK)
================================ */
async function fetchWeather(lat, lng) {
  const today = getTodayISO();
  const start = getPastDateISO(30);

  const hourlyFields = [
    "temperature_2m",
    "precipitation",
    "wind_speed_10m",
    "relative_humidity_2m",
    "shortwave_radiation",
    "soil_temperature_0_to_7cm",
    "soil_moisture_0_to_7cm",
    "et0_fao_evapotranspiration"
  ].join(",");

  const histUrl = `${BASE_URL}?latitude=${lat}&longitude=${lng}&start_date=${start}&end_date=${today}&hourly=${hourlyFields}&timezone=auto`;

  const fcstUrl = `${FORECAST_URL}?latitude=${lat}&longitude=${lng}&hourly=${hourlyFields}&forecast_days=2&timezone=auto`;

  let hist = null;
  let fcst = null;

  /* -------------------------------
     TRY ARCHIVE (DON’T FAIL RUN)
  ------------------------------- */
  try {
    const histRes = await fetch(histUrl);

    if (histRes.ok) {
      hist = await histRes.json();
    } else {
      console.warn("[weather] archive bad response");
    }
  } catch (e) {
    console.warn("[weather] archive failed:", e?.message || e);
  }

  /* -------------------------------
     FORECAST (REQUIRED)
  ------------------------------- */
  try {
    const fcstRes = await fetch(fcstUrl);

    if (!fcstRes.ok) {
      throw new Error("forecast weather fetch failed");
    }

    fcst = await fcstRes.json();
  } catch (e) {
    throw new Error("forecast weather fetch failed");
  }

  const fcstHourly = fcst?.hourly || {};

  /* -------------------------------
     🔥 FIX: BUILD HISTORY IF ARCHIVE BAD
  ------------------------------- */
  let histHourly = hist?.hourly;

  if (!histHourly || !histHourly.time || histHourly.time.length < 24) {
    console.warn("[weather] using forecast fallback history");

    const repeat = 15; // ~30 days

    histHourly = {
      time: [],
      temperature_2m: [],
      precipitation: [],
      wind_speed_10m: [],
      relative_humidity_2m: [],
      shortwave_radiation: [],
      soil_temperature_0_to_7cm: [],
      soil_moisture_0_to_7cm: [],
      et0_fao_evapotranspiration: []
    };

    for (let r = 0; r < repeat; r++) {
      histHourly.time.push(...(fcstHourly.time || []));
      histHourly.temperature_2m.push(...(fcstHourly.temperature_2m || []));
      histHourly.precipitation.push(...(fcstHourly.precipitation || []));
      histHourly.wind_speed_10m.push(...(fcstHourly.wind_speed_10m || []));
      histHourly.relative_humidity_2m.push(...(fcstHourly.relative_humidity_2m || []));
      histHourly.shortwave_radiation.push(...(fcstHourly.shortwave_radiation || []));
      histHourly.soil_temperature_0_to_7cm.push(...(fcstHourly.soil_temperature_0_to_7cm || []));
      histHourly.soil_moisture_0_to_7cm.push(...(fcstHourly.soil_moisture_0_to_7cm || []));
      histHourly.et0_fao_evapotranspiration.push(...(fcstHourly.et0_fao_evapotranspiration || []));
    }
  }

  /* -------------------------------
     MERGE SAFELY
  ------------------------------- */
  return {
    hourly: {
      time: [...histHourly.time, ...(fcstHourly.time || [])],
      temperature_2m: [...histHourly.temperature_2m, ...(fcstHourly.temperature_2m || [])],
      precipitation: [...histHourly.precipitation, ...(fcstHourly.precipitation || [])],
      wind_speed_10m: [...histHourly.wind_speed_10m, ...(fcstHourly.wind_speed_10m || [])],
      relative_humidity_2m: [...histHourly.relative_humidity_2m, ...(fcstHourly.relative_humidity_2m || [])],
      shortwave_radiation: [...histHourly.shortwave_radiation, ...(fcstHourly.shortwave_radiation || [])],
      soil_temperature_0_to_7cm: [
        ...histHourly.soil_temperature_0_to_7cm,
        ...(fcstHourly.soil_temperature_0_to_7cm || [])
      ],
      soil_moisture_0_to_7cm: [
        ...histHourly.soil_moisture_0_to_7cm,
        ...(fcstHourly.soil_moisture_0_to_7cm || [])
      ],
      et0_fao_evapotranspiration: [
        ...histHourly.et0_fao_evapotranspiration,
        ...(fcstHourly.et0_fao_evapotranspiration || [])
      ]
    }
  };
}

/* ================================
BUILD HOURLY
================================ */
function buildHourly(hourly) {
  const out = [];

  for (let i = 0; i < hourly.time.length; i++) {
    const t = hourly.time[i];
    if (!t) continue;

    const tempC = hourly.temperature_2m?.[i];
    const rainMM = hourly.precipitation?.[i];

    if (tempC == null && rainMM == null) continue;

    const stC = hourly.soil_temperature_0_to_7cm?.[i];
    const sm = hourly.soil_moisture_0_to_7cm?.[i];

    out.push({
      time: t,
      tempF: tempC != null ? Math.round((tempC * 9) / 5 + 32) : null,
      rainIn: rainMM != null ? round(rainMM / 25.4, 3) : 0,
      windMph: Math.round((hourly.wind_speed_10m?.[i] || 0) * 0.621371),
      rh: Math.round(hourly.relative_humidity_2m?.[i] || 0),
      solarWm2: Math.round(hourly.shortwave_radiation?.[i] || 0),
      et0In: round((hourly.et0_fao_evapotranspiration?.[i] || 0) / 25.4, 3),
      sm010: sm ?? null,
      sm010Pct: sm != null ? Math.round(sm * 100) : null,
      st010F: stC != null ? Math.round((stC * 9) / 5 + 32) : null
    });
  }

  return out;
}

/* ================================
BUILD DAILY
================================ */
function buildDaily(hourlyRows) {
  const map = new Map();

  for (const h of hourlyRows) {
    if (!h.time) continue;

    const date = h.time.slice(0, 10);

    if (!map.has(date)) {
      map.set(date, {
        dateISO: date,
        temps: [],
        winds: [],
        rhs: [],
        solar: [],
        rain: [],
        et0: [],
        sm: [],
        st: []
      });
    }

    const d = map.get(date);

    if (h.tempF != null) d.temps.push(h.tempF);
    if (h.windMph != null) d.winds.push(h.windMph);
    if (h.rh != null) d.rhs.push(h.rh);
    if (h.solarWm2 != null) d.solar.push(h.solarWm2);
    if (h.rainIn != null) d.rain.push(h.rainIn);
    if (h.et0In != null) d.et0.push(h.et0In);
    if (h.sm010 != null) d.sm.push(h.sm010);
    if (h.st010F != null) d.st.push(h.st010F);
  }

  const out = [];

  for (const d of map.values()) {
    const hasData =
      d.temps.length ||
      d.rain.length ||
      d.winds.length ||
      d.rhs.length;

    if (!hasData) continue;

    out.push({
      dateISO: d.dateISO,
      tempAvg: round(avg(d.temps), 1),
      windAvg: round(avg(d.winds), 1),
      rhAvg: round(avg(d.rhs), 1),
      solarAvg: round(avg(d.solar), 1),
      rainTotal: round(sum(d.rain), 3),
      et0In: d.et0.length ? round(sum(d.et0), 3) : 0,
      sm010: d.sm.length ? round(avg(d.sm), 3) : null,
      st010F: d.st.length ? Math.round(avg(d.st)) : null
    });
  }

  return out;
}

/* ================================
MAIN BUILDER
================================ */
async function buildWeatherCache(field) {
  const data = await fetchWeather(field.lat, field.lng);

  const hourlyRows = buildHourly(data.hourly);

  const today = getTodayISO();

  const hourlyToday = hourlyRows.filter(h => h.time.startsWith(today));

  const dailyAll = buildDaily(hourlyRows);

  const dailyHistory = dailyAll.filter(d => d.dateISO < today);

  return {
    fieldId: field.id,
    location: {
      lat: field.lat,
      lng: field.lng
    },
    dailySeries: dailyHistory,
    hourlySeries: hourlyToday
  };
}

module.exports = {
  buildWeatherCache
};
