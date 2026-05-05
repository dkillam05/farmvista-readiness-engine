// ================================
// FILE: services/fields.js
// PURPOSE: Load fields (FIXED DB IMPORT)
// ================================

const db = require("../config/firestore");   // ✅ FIXED (no destructuring)

async function loadFields() {
  const snap = await db.collection("fields").get();
  const out = [];

  snap.forEach(doc => {
    const d = doc.data() || {};

    const lat =
      d?.location?.lat ??
      d?.lat ??
      d?.gps?.lat ??
      d?.center?.lat;

    const lng =
      d?.location?.lng ??
      d?.lng ??
      d?.gps?.lng ??
      d?.center?.lng;

    if (!lat || !lng) return;

    out.push({
      id: doc.id,
      name: d.name || "",
      lat,
      lng,
      raw: d
    });
  });

  return out;
}

module.exports = { loadFields };
