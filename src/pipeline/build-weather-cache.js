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
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}

function round(v, d = 2) {
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
FETCH WEATHER (🔥 FIXED)
================================ */
async function fetchWeather(lat, lng) {
  const today = getTodayISO();
  const start = getPastDateISO(30);

  // HISTORICAL (30 days)
  const histUrl = `${BASE_URL}?latitude=${lat}&longitude=${lng}&start_date=${start}&end_date=${today}&hourly=temperature_2m,precipitation,wind_speed_10m,relative_humidity_2m,shortwave_radiation&timezone=auto`;

  // TODAY + FORECAST
  const fcstUrl = `${FORECAST_URL}?latitude=${lat}&longitude=${lng}&hourly=temperature_2m,precipitation,wind_speed_10m,relative_humidity_2m,shortwave_radiation&forecast_days=1&timezone=auto`;

  const [histRes, fcstRes] = await Promise.all([
    fetch(histUrl),
    fetch(fcstUrl)
  ]);

  const hist = await histRes.json();
  const fcst = await fcstRes.json();

  if (!histRes.ok || !fcstRes.ok) {
    throw new Error("weather fetch failed");
  }

  return {
    hourly: {
      time: [...hist.hourly.time, ...fcst.hourly.time],
      temperature_2m: [...hist.hourly.temperature_2m, ...fcst.hourly.temperature_2m],
      precipitation: [...hist.hourly.precipitation, ...fcst.hourly.precipitation],
      wind_speed_10m: [...hist.hourly.wind_speed_10m, ...fcst.hourly.wind_speed_10m],
      relative_humidity_2m: [...hist.hourly.relative_humidity_2m, ...fcst.hourly.relative_humidity_2m],
      shortwave_radiation: [...hist.hourly.shortwave_radiation, ...fcst.hourly.shortwave_radiation]
    }
  };
}

/* ================================
BUILD HOURLY
================================ */
function buildHourly(hourly) {
  const out = [];

  for (let i = 0; i < hourly.time.length; i++) {
    out.push({
      time: hourly.time[i],
      tempF: Math.round((hourly.temperature_2m[i] * 9) / 5 + 32),
      rainIn: round((hourly.precipitation[i] || 0) / 25.4, 3),
      windMph: Math.round(hourly.wind_speed_10m[i] * 0.621371),
      rh: Math.round(hourly.relative_humidity_2m[i]),
      solarWm2: Math.round(hourly.shortwave_radiation[i] || 0)
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
      map.set(date, {
        dateISO: date,
        temps: [],
        winds: [],
        rhs: [],
        solar: [],
        rain: []
      });
    }

    const d = map.get(date);

    d.temps.push(h.tempF);
    d.winds.push(h.windMph);
    d.rhs.push(h.rh);
    d.solar.push(h.solarWm2);
    d.rain.push(h.rainIn);
  }

  const out = [];

  for (const d of map.values()) {
    out.push({
      dateISO: d.dateISO,
      tempAvg: round(avg(d.temps), 1),
      windAvg: round(avg(d.winds), 1),
      rhAvg: round(avg(d.rhs), 1),
      solarAvg: round(avg(d.solar), 1),
      rainTotal: round(sum(d.rain), 3)
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
