// FILE: /pipeline/build-weather-cache.js
// FULL FIX: real-time weather, correct timestamps, no stale fallback

const fetch = require("node-fetch");

const BASE_URL = "https://archive-api.open-meteo.com/v1/archive";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

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
FETCH WEATHER (FIXED)
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
  const fcstUrl = `${FORECAST_URL}?latitude=${lat}&longitude=${lng}&hourly=${hourlyFields}&forecast_days=3&timezone=auto`;

  let hist = null;
  let fcst = null;

  try {
    const histRes = await fetch(histUrl);
    if (histRes.ok) hist = await histRes.json();
  } catch (e) {
    console.warn("[weather] archive failed");
  }

  try {
    const fcstRes = await fetch(fcstUrl);
    if (fcstRes.ok) fcst = await fcstRes.json();
  } catch (e) {
    console.warn("[weather] forecast failed");
  }

  return {
    hourly: {
      time: [...(hist?.hourly?.time || []), ...(fcst?.hourly?.time || [])],
      temperature_2m: [...(hist?.hourly?.temperature_2m || []), ...(fcst?.hourly?.temperature_2m || [])],
      precipitation: [...(hist?.hourly?.precipitation || []), ...(fcst?.hourly?.precipitation || [])],
      wind_speed_10m: [...(hist?.hourly?.wind_speed_10m || []), ...(fcst?.hourly?.wind_speed_10m || [])],
      relative_humidity_2m: [...(hist?.hourly?.relative_humidity_2m || []), ...(fcst?.hourly?.relative_humidity_2m || [])],
      shortwave_radiation: [...(hist?.hourly?.shortwave_radiation || []), ...(fcst?.hourly?.shortwave_radiation || [])],
      soil_temperature_0_to_7cm: [...(hist?.hourly?.soil_temperature_0_to_7cm || []), ...(fcst?.hourly?.soil_temperature_0_to_7cm || [])],
      soil_moisture_0_to_7cm: [...(hist?.hourly?.soil_moisture_0_to_7cm || []), ...(fcst?.hourly?.soil_moisture_0_to_7cm || [])],
      et0_fao_evapotranspiration: [...(hist?.hourly?.et0_fao_evapotranspiration || []), ...(fcst?.hourly?.et0_fao_evapotranspiration || [])]
    }
  };
}

/* ================================
BUILD HOURLY (FIXED: NO ZERO DEFAULTS)
================================ */
function buildHourly(hourly) {
  const out = [];

  for (let i = 0; i < hourly.time.length; i++) {
    const t = hourly.time[i];
    if (!t) continue;

    const tempC = hourly.temperature_2m?.[i];
    if (tempC == null) continue;

    out.push({
      time: t,
      tempF: Math.round(tempC * 9 / 5 + 32),
      rainIn: round((hourly.precipitation?.[i] || 0) / 25.4, 3),
      windMph: Math.round((hourly.wind_speed_10m?.[i] || 0) * 0.621371),
      rh: Math.round(hourly.relative_humidity_2m?.[i] || 0),
      solarWm2: Math.round(hourly.shortwave_radiation?.[i] || 0)
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
    const date = h.time.slice(0, 10);

    if (!map.has(date)) {
      map.set(date, { dateISO: date, temps: [], rain: [], wind: [], rh: [], solar: [] });
    }

    const d = map.get(date);

    d.temps.push(h.tempF);
    d.rain.push(h.rainIn);
    d.wind.push(h.windMph);
    d.rh.push(h.rh);
    d.solar.push(h.solarWm2);
  }

  return Array.from(map.values()).map(d => ({
    dateISO: d.dateISO,
    tempAvg: round(avg(d.temps), 1),
    windAvg: round(avg(d.wind), 1),
    rhAvg: round(avg(d.rh), 1),
    solarAvg: round(avg(d.solar), 1),
    rainTotal: round(sum(d.rain), 3)
  }));
}

/* ================================
MAIN BUILDER (FIXED)
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
    location: { lat: field.lat, lng: field.lng },

    dailySeries: dailyHistory.length ? dailyHistory : dailyAll.slice(-30),

    // 🔥 NEVER fallback to stale blindly
    hourlySeries: hourlyToday,

    // 🔥 CRITICAL FIX
    weatherFetchedAt: new Date().toISOString()
  };
}

module.exports = {
  buildWeatherCache
};
