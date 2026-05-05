// ================================
// FILE: services/weather-fetch.js
// PURPOSE: OPEN METEO CALLS
// ================================

const fetch = require("node-fetch");

async function fetchOpenMeteo(url) {
  const r = await fetch(url);
  return await r.json();
}

module.exports = { fetchOpenMeteo };
