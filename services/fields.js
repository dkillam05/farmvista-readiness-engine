// ================================
// FILE: services/fields.js
// PURPOSE: EXACT field loading (from your real system)
// ================================

const { db } = require("../config/firestore");

async function loadFields() {
  const snap = await db.collection("fields").get();
  const out = [];

  snap.forEach(doc => {
    const d = doc.data() || {};

    // THIS matches your real system logic
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
