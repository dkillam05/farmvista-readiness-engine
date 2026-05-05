// ============================================
// FILE: fetch-openmeteo.js
// PURPOSE: Handles all Open-Meteo API calls
// ============================================

const fetch = require("node-fetch");

const OPEN_METEO_API_KEY = (process.env.OPEN_METEO_API_KEY || "").trim();

function forecastBaseUrl() {
  return OPEN_METEO_API_KEY
    ? "https://customer-api.open-meteo.com/v1/forecast"
    : "https://api.open-meteo.com/v1/forecast";
}

function historicalBaseUrl() {
  return "https://archive-api.open-meteo.com/v1/archive";
}

async function fetchOpenMeteoJson(url) {
  const r = await fetch(url);
  const json = await r.json().catch(() => ({}));

  if (!r.ok) {
    throw new Error(`Open-Meteo failed: ${r.status}`);
  }

  return json;
}

function buildHistoricalUrl(lat, lng, timezone, start, end) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lng,
    timezone,
    start_date: start,
    end_date: end,
    hourly: "precipitation,temperature_2m,wind_speed_10m",
    daily: "temperature_2m_max,temperature_2m_min"
  });

  return `${historicalBaseUrl()}?${params}`;
}

function buildForecastUrl(lat, lng, timezone, days) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lng,
    timezone,
    forecast_days: days,
    hourly: "precipitation,temperature_2m,wind_speed_10m",
    daily: "temperature_2m_max,temperature_2m_min"
  });

  return `${forecastBaseUrl()}?${params}`;
}

async function fetchOpenMeteo(lat, lng, timezone, days = 30, forecastDays = 7) {
  const today = new Date();
  const end = today.toISOString().slice(0, 10);

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const start = startDate.toISOString().slice(0, 10);

  const [hist, fcst] = await Promise.all([
    fetchOpenMeteoJson(buildHistoricalUrl(lat, lng, timezone, start, end)),
    fetchOpenMeteoJson(buildForecastUrl(lat, lng, timezone, forecastDays))
  ]);

  return {
    historical: hist,
    forecast: fcst
  };
}

module.exports = {
  fetchOpenMeteo
};
