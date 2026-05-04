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
FETCH WEATHER (HARD FAIL SAFE)
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

  const fcstUrl = `${FORECAST_URL}?latitude=${lat}&longitude=${lng}&hourly=${hourlyFields}&forecast_days=1&timezone=auto`;

  const [histRes, fcstRes] = await Promise.all([
    fetch(histUrl),
    fetch(fcstUrl)
  ]);

  if (!histRes.ok) {
    throw new Error("archive weather fetch failed");
  }

  if (!fcstRes.ok) {
    throw new Error("forecast weather fetch failed");
  }

  const hist = await histRes.json();
  const fcst = await fcstRes.json();

  if (!hist?.hourly || !fcst?.hourly) {
    throw new Error("weather data missing hourly");
  }

  return {
    hourly: {
      time: [...hist.hourly.time, ...fcst.hourly.time],
      temperature_2m: [...hist.hourly.temperature_2m, ...fcst.hourly.temperature_2m],
      precipitation: [...hist.hourly.precipitation, ...fcst.hourly.precipitation],
      wind_speed_10m: [...hist.hourly.wind_speed_10m, ...fcst.hourly.wind_speed_10m],
      relative_humidity_2m: [...hist.hourly.relative_humidity_2m, ...fcst.hourly.relative_humidity_2m],
      shortwave_radiation: [...hist.hourly.shortwave_radiation, ...fcst.hourly.shortwave_radiation],
      soil_temperature_0_to_7cm: [
        ...hist.hourly.soil_temperature_0_to_7cm,
        ...fcst.hourly.soil_temperature_0_to_7cm
      ],
      soil_moisture_0_to_7cm: [
        ...hist.hourly.soil_moisture_0_to_7cm,
        ...fcst.hourly.soil_moisture_0_to_7cm
      ],
      et0_fao_evapotranspiration: [
        ...hist.hourly.et0_fao_evapotranspiration,
        ...fcst.hourly.et0_fao_evapotranspiration
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

    // 🔥 CRITICAL: skip completely invalid rows
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
BUILD DAILY (🔥 FIXED ZERO FILTER)
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

    // 🔥 CRITICAL: skip garbage days
    const hasData =
      d.temps.length ||
      d.rain.length ||
      d.wind.length ||
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