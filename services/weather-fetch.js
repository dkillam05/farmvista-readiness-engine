// ================================
// FILE: services/weather-fetch.js
// PURPOSE: Open-Meteo calls
// ================================

const fetch = require("node-fetch");

async function fetchOpenMeteo(url) {
  const r = await fetch(url);
  const j = await r.json();
  return j;
}

module.exports = { fetchOpenMeteo };
