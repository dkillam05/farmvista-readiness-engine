// ============================================
// FILE: /js/weather-fetch.js
// PURPOSE:
// Fetch Open-Meteo weather (history + today hourly + forecast)
// ============================================

const fetch = require("node-fetch");

// --------------------------------------------
// HELPERS
// --------------------------------------------
function cToF(c) {
  return (c * 9) / 5 + 32;
}

function mmToIn(mm) {
  return mm / 25.4;
}

function msToMph(ms) {
  return ms * 2.23694;
}

function wToSolar(w) {
  return w; // already W/m²
}

function getTodayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateISO(d) {
  return new Date(d).toISOString().slice(0, 10);
}

// --------------------------------------------
// MAIN FETCH
// --------------------------------------------
async function fetchWeather(lat, lng) {
  const todayISO = getTodayISO();

  const pastDate = new Date();
  pastDate.setDate(pastDate.getDate() - 30);
  const startISO = formatDateISO(pastDate);

  // --------------------------------------------
  // API URL
  // --------------------------------------------
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&timezone=auto&past_days=30&forecast_days=7&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,shortwave_radiation,precipitation,et0_fao_evapotranspiration,soil_moisture_0_to_10cm&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,et0_fao_evapotranspiration,shortwave_radiation_sum`;

  const res = await fetch(url);
  const data = await res.json();

  if (!data || !data.hourly || !data.daily) {
    throw new Error("Invalid weather response");
  }

  // --------------------------------------------
  // BUILD DAILY HISTORY
  // --------------------------------------------
  const dailySeries = [];

  const d = data.daily;

  for (let i = 0; i < d.time.length; i++) {
    const dateISO = d.time[i];

    // skip today → handled by hourly
    if (dateISO === todayISO) continue;

    dailySeries.push({
      dateISO,
      rainIn: mmToIn(d.precipitation_sum[i] || 0),
      tempF: cToF(
        ((d.temperature_2m_max[i] || 0) +
          (d.temperature_2m_min[i] || 0)) /
          2
      ),
      windMph: 8, // fallback (hourly used for today)
      rh: 70, // fallback
      solarWm2: (d.shortwave_radiation_sum[i] || 0) / 86400,
      et0In: mmToIn(d.et0_fao_evapotranspiration[i] || 0),
      sm010: null
    });
  }

  // --------------------------------------------
  // BUILD HOURLY TODAY
  // --------------------------------------------
  const hourlyToday = [];

  const h = data.hourly;

  for (let i = 0; i < h.time.length; i++) {
    const t = h.time[i];
    const dateISO = t.slice(0, 10);

    if (dateISO !== todayISO) continue;

    hourlyToday.push({
      timeISO: t,
      tempF: cToF(h.temperature_2m[i] || 0),
      windMph: msToMph(h.wind_speed_10m[i] || 0),
      rh: h.relative_humidity_2m[i] || 0,
      solarWm2: wToSolar(h.shortwave_radiation[i] || 0),
      rainIn: mmToIn(h.precipitation[i] || 0),
      et0In: mmToIn(h.et0_fao_evapotranspiration[i] || 0),
      sm010: h.soil_moisture_0_to_10cm[i] || null
    });
  }

  // --------------------------------------------
  // BUILD DAILY FORECAST (7d)
  // --------------------------------------------
  const dailyForecast = [];

  for (let i = 0; i < d.time.length; i++) {
    const dateISO = d.time[i];

    if (dateISO <= todayISO) continue;

    dailyForecast.push({
      dateISO,
      rainIn: mmToIn(d.precipitation_sum[i] || 0),
      tempF: cToF(
        ((d.temperature_2m_max[i] || 0) +
          (d.temperature_2m_min[i] || 0)) /
          2
      ),
      windMph: 8,
      rh: 70,
      solarWm2: (d.shortwave_radiation_sum[i] || 0) / 86400,
      et0In: mmToIn(d.et0_fao_evapotranspiration[i] || 0)
    });
  }

  return {
    dailySeries,
    hourlyToday,
    dailyForecast,
    meta: {
      todayISO,
      histDays: dailySeries.length,
      fcstDays: dailyForecast.length
    }
  };
}

// --------------------------------------------
// EXPORT
// --------------------------------------------
module.exports = {
  fetchWeather
};
