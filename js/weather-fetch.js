// ============================================
// FILE: /js/weather-fetch.js
// PURPOSE:
// Fetch Open-Meteo weather (history + today hourly + forecast)
// WITH DAILY SOIL AGGREGATION (sm010 + st010)
//
// FIXED:
// ✅ Added VPD
// ✅ Added cloud cover
// ✅ Removed double soil-temp conversion
// ✅ Builds TODAY daily row from completed hourly data
// ✅ Appends TODAY into dailySeries so readiness can dry down intraday
// ============================================

const fetch = require("node-fetch");

// --------------------------------------------
// HELPERS
// --------------------------------------------
function mmToIn(mm) {
  return mm / 25.4;
}

function avg(arr) {
  if (!arr.length) return null;

  const sum = arr.reduce((a, b) => a + b, 0);

  return sum / arr.length;
}

function sum(arr) {
  if (!arr.length) return 0;

  return arr.reduce((a, b) => a + b, 0);
}

function safeNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// --------------------------------------------
// OPEN-METEO LOCAL DATE/TIME
// Uses API utc_offset_seconds so "today"
// matches the field location, not Cloud Run UTC.
// --------------------------------------------
function getLocalNowParts(utcOffsetSeconds = 0) {
  const now = new Date();
  const localMs =
    now.getTime() +
    Number(utcOffsetSeconds || 0) * 1000;

  const local = new Date(localMs);

  const yyyy = local.getUTCFullYear();
  const mm = String(local.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(local.getUTCDate()).padStart(2, "0");
  const hh = String(local.getUTCHours()).padStart(2, "0");

  return {
    dateISO: `${yyyy}-${mm}-${dd}`,
    hourISO: `${yyyy}-${mm}-${dd}T${hh}:00`
  };
}

// --------------------------------------------
// OPEN-METEO SOLAR CONVERSION
// MJ/m²/day → average W/m²
// --------------------------------------------
function mjToAvgWatts(mj) {
  return Number(mj || 0) * 11.574;
}

// --------------------------------------------
// MAIN FETCH
// --------------------------------------------
async function fetchWeather(lat, lng) {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}` +
    `&longitude=${lng}` +
    `&timezone=auto` +
    `&past_days=30` +
    `&forecast_days=8` +
    `&temperature_unit=fahrenheit` +
    `&wind_speed_unit=mph` +
    `&precipitation_unit=inch` +
    `&hourly=` +
    [
      "temperature_2m",
      "relative_humidity_2m",
      "wind_speed_10m",
      "shortwave_radiation",
      "precipitation",
      "et0_fao_evapotranspiration",
      "soil_moisture_0_to_10cm",
      "soil_temperature_0_to_10cm",

      // --------------------------------------------
      // NEW
      // --------------------------------------------
      "vapour_pressure_deficit",
      "cloud_cover"

    ].join(",") +
    `&daily=` +
    [
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_sum",
      "et0_fao_evapotranspiration",
      "shortwave_radiation_sum"
    ].join(",");

  const res = await fetch(url);

  const data = await res.json();

  if (!data || !data.hourly || !data.daily) {
    throw new Error("Invalid weather response");
  }

  const h = data.hourly;
  const d = data.daily;

  const localNow = getLocalNowParts(
    data.utc_offset_seconds || 0
  );

  const todayISO = localNow.dateISO;
  const currentHourISO = localNow.hourISO;

  // --------------------------------------------
  // GROUP HOURLY BY DAY
  // IMPORTANT:
  // For TODAY, only include completed/current hours.
  // Do NOT average future forecast hours into today's row.
  // --------------------------------------------
  const dailyBuckets = {};

  for (let i = 0; i < h.time.length; i++) {
    const t = h.time[i];
    const dateISO = t.slice(0, 10);

    const isToday = dateISO === todayISO;

    if (isToday && t > currentHourISO) {
      continue;
    }

    if (!dailyBuckets[dateISO]) {
      dailyBuckets[dateISO] = {
        temp: [],
        sm: [],
        st: [],
        wind: [],
        rh: [],
        solar: [],
        rain: [],
        et0: [],

        // --------------------------------------------
        // NEW
        // --------------------------------------------
        vpd: [],
        cloud: [],

        hoursCount: 0
      };
    }

    const bucket = dailyBuckets[dateISO];

    bucket.hoursCount++;

    // --------------------------------------------
    // TEMP
    // --------------------------------------------
    if (
      Number.isFinite(
        h.temperature_2m[i]
      )
    ) {
      bucket.temp.push(
        h.temperature_2m[i]
      );
    }

    // --------------------------------------------
    // RAIN
    // --------------------------------------------
    if (
      Number.isFinite(
        h.precipitation[i]
      )
    ) {
      bucket.rain.push(
        h.precipitation[i]
      );
    }

    // --------------------------------------------
    // ET0
    // --------------------------------------------
    if (
      Number.isFinite(
        h.et0_fao_evapotranspiration[i]
      )
    ) {
      bucket.et0.push(
        h.et0_fao_evapotranspiration[i]
      );
    }

    // --------------------------------------------
    // SOIL MOISTURE
    // --------------------------------------------
    if (
      Number.isFinite(
        h.soil_moisture_0_to_10cm[i]
      )
    ) {
      bucket.sm.push(
        h.soil_moisture_0_to_10cm[i]
      );
    }

    // --------------------------------------------
    // SOIL TEMP
    // FIXED:
    // Open-Meteo already returning Fahrenheit
    // --------------------------------------------
    if (
      Number.isFinite(
        h.soil_temperature_0_to_10cm[i]
      )
    ) {
      bucket.st.push(
        h.soil_temperature_0_to_10cm[i]
      );
    }

    // --------------------------------------------
    // WIND (already MPH)
    // --------------------------------------------
    if (
      Number.isFinite(
        h.wind_speed_10m[i]
      )
    ) {
      bucket.wind.push(
        h.wind_speed_10m[i]
      );
    }

    // --------------------------------------------
    // RH
    // --------------------------------------------
    if (
      Number.isFinite(
        h.relative_humidity_2m[i]
      )
    ) {
      bucket.rh.push(
        h.relative_humidity_2m[i]
      );
    }

    // --------------------------------------------
    // SOLAR
    // --------------------------------------------
    if (
      Number.isFinite(
        h.shortwave_radiation[i]
      )
    ) {
      bucket.solar.push(
        h.shortwave_radiation[i]
      );
    }

    // --------------------------------------------
    // VPD
    // --------------------------------------------
    if (
      Number.isFinite(
        h.vapour_pressure_deficit[i]
      )
    ) {
      bucket.vpd.push(
        h.vapour_pressure_deficit[i]
      );
    }

    // --------------------------------------------
    // CLOUD COVER
    // --------------------------------------------
    if (
      Number.isFinite(
        h.cloud_cover[i]
      )
    ) {
      bucket.cloud.push(
        h.cloud_cover[i]
      );
    }
  }

  // --------------------------------------------
  // BUILD DAILY HISTORY
  // Includes today as a live intraday row.
  // --------------------------------------------
  const dailySeries = [];

  for (let i = 0; i < d.time.length; i++) {
    const dateISO = d.time[i];

    if (dateISO > todayISO) continue;

    const bucket =
      dailyBuckets[dateISO] || {};

    const isToday = dateISO === todayISO;

    dailySeries.push({
      dateISO,

      // --------------------------------------------
      // WEATHER
      // --------------------------------------------
      rainIn:
        isToday
          ? sum(bucket.rain || [])
          : Number(d.precipitation_sum[i]) || 0,

      tempF:
        isToday
          ? avg(bucket.temp || []) ??
            (
              (Number(d.temperature_2m_max[i]) || 0) +
              (Number(d.temperature_2m_min[i]) || 0)
            ) / 2
          : (
              (Number(d.temperature_2m_max[i]) || 0) +
              (Number(d.temperature_2m_min[i]) || 0)
            ) / 2,

      windMph:
        avg(bucket.wind || []) ?? 8,

      rh:
        avg(bucket.rh || []) ?? 70,

      // --------------------------------------------
      // FIXED SOLAR
      // Today uses completed/current hourly average.
      // Historical uses hourly avg when available,
      // otherwise daily solar sum conversion.
      // --------------------------------------------
      solarWm2:
        avg(bucket.solar || []) ??
        mjToAvgWatts(
          d.shortwave_radiation_sum[i]
        ),

      et0In:
        isToday
          ? sum(bucket.et0 || [])
          : Number(
              d.et0_fao_evapotranspiration[i]
            ) || 0,

      // --------------------------------------------
      // SOIL
      // --------------------------------------------
      sm010:
        avg(bucket.sm || []),

      st010:
        avg(bucket.st || []),

      // --------------------------------------------
      // NEW
      // --------------------------------------------
      vpdKpa:
        avg(bucket.vpd || []),

      cloudPct:
        avg(bucket.cloud || []),

      // --------------------------------------------
      // DEBUG / TRANSPARENCY
      // --------------------------------------------
      isTodayLive:
        isToday,

      hoursCount:
        Number(bucket.hoursCount || 0)
    });
  }

  // --------------------------------------------
  // BUILD HOURLY TODAY
  // Save full today hourly set, but flag future hours.
  // --------------------------------------------
  const hourlyToday = [];

  for (let i = 0; i < h.time.length; i++) {
    const t = h.time[i];
    const dateISO = t.slice(0, 10);

    if (dateISO !== todayISO) continue;

    const isFutureHour = t > currentHourISO;

    hourlyToday.push({
      timeISO: t,

      isFutureHour,

      tempF:
        Number(h.temperature_2m[i]) || 0,

      // already MPH
      windMph:
        Number(h.wind_speed_10m[i]) || 0,

      rh:
        Number(
          h.relative_humidity_2m[i]
        ) || 0,

      solarWm2:
        Number(
          h.shortwave_radiation[i]
        ) || 0,

      rainIn:
        Number(
          h.precipitation[i]
        ) || 0,

      et0In:
        Number(
          h.et0_fao_evapotranspiration[i]
        ) || 0,

      sm010:
        Number.isFinite(
          h.soil_moisture_0_to_10cm[i]
        )
          ? h.soil_moisture_0_to_10cm[i]
          : null,

      // --------------------------------------------
      // FIXED:
      // remove cToF double conversion
      // --------------------------------------------
      st010:
        Number.isFinite(
          h.soil_temperature_0_to_10cm[i]
        )
          ? h.soil_temperature_0_to_10cm[i]
          : null,

      // --------------------------------------------
      // NEW
      // --------------------------------------------
      vpdKpa:
        Number.isFinite(
          h.vapour_pressure_deficit[i]
        )
          ? h.vapour_pressure_deficit[i]
          : null,

      cloudPct:
        Number.isFinite(
          h.cloud_cover[i]
        )
          ? h.cloud_cover[i]
          : null
    });
  }

  // --------------------------------------------
  // BUILD DAILY FORECAST
  // --------------------------------------------
  const dailyForecast = [];

  for (let i = 0; i < d.time.length; i++) {
    const dateISO = d.time[i];

    if (dateISO <= todayISO) continue;

    const bucket =
      dailyBuckets[dateISO] || {};

    dailyForecast.push({
      dateISO,

      rainIn:
        Number(d.precipitation_sum[i]) || 0,

      tempF:
        (
          (Number(d.temperature_2m_max[i]) || 0) +
          (Number(d.temperature_2m_min[i]) || 0)
        ) / 2,

      windMph:
        avg(bucket.wind || []) ?? 8,

      rh:
        avg(bucket.rh || []) ?? 70,

      solarWm2:
        mjToAvgWatts(
          d.shortwave_radiation_sum[i]
        ),

      et0In:
        Number(
          d.et0_fao_evapotranspiration[i]
        ) || 0,

      // --------------------------------------------
      // NEW
      // --------------------------------------------
      vpdKpa:
        avg(bucket.vpd || []),

      cloudPct:
        avg(bucket.cloud || [])
    });
  }

  // --------------------------------------------
  // RETURN
  // --------------------------------------------
  return {
    dailySeries,
    hourlyToday,
    dailyForecast,

    meta: {
      todayISO,
      currentHourISO,

      histDays:
        dailySeries.length,

      fcstDays:
        dailyForecast.length,

      todayIncludedInDailySeries:
        true
    }
  };
}

// --------------------------------------------
// EXPORT
// --------------------------------------------
module.exports = {
  fetchWeather
};
