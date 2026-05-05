// ================================
// FILE: services/weather-normalize.js
// PURPOSE: Minimal normalization (kept simple)
// ================================

function normalizeHourly(data) {
  const h = data?.hourly || {};
  const time = h.time || [];
  const rain = h.precipitation || [];
  const temp = h.temperature_2m || [];

  const out = [];

  for (let i = 0; i < time.length; i++) {
    out.push({
      time: time[i],
      rain: rain[i] || 0,
      temp: temp[i] || 0
    });
  }

  return out;
}

module.exports = { normalizeHourly };
