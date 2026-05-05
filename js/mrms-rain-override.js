// ================================
// FILE: mrms-rain-override.js
// PURPOSE: Override rainfall using MRMS for past days
// ================================

async function applyMrmsRainOverride(db, fieldId, rows) {
  if (!Array.isArray(rows) || !rows.length) return rows;

  try {
    const snap = await db
      .collection("field_mrms_weather")
      .doc(fieldId)
      .get();

    if (!snap.exists) {
      return rows.map(r => ({
        ...r,
        rainSource: "open-meteo"
      }));
    }

    const data = snap.data();
    const arr = data?.mrmsDailySeries30d || [];

    // build lookup map (mm → inches)
    const mrmsMap = {};
    for (const d of arr) {
      mrmsMap[d.dateISO] = (d.rainMm || 0) / 25.4;
    }

    const todayISO = new Date().toISOString().slice(0, 10);

    return rows.map(r => {
      const iso = String(r.dateISO || "").slice(0, 10);
      const isPast = iso <= todayISO;

      if (isPast && mrmsMap[iso] != null) {
        const rain = mrmsMap[iso];

        return {
          ...r,
          rainIn: rain,
          rainInAdj: rain,
          rainMorningIn: rain,
          rainMiddayIn: 0,
          rainEveningIn: 0,
          rainSource: "mrms"
        };
      }

      return {
        ...r,
        rainInAdj: r.rainIn,
        rainSource: "forecast"
      };
    });

  } catch (e) {
    console.log("MRMS override failed:", e.message);
    return rows;
  }
}

module.exports = { applyMrmsRainOverride };
