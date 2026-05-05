// ================================
// FILE: services/fields.js
// PURPOSE: Load fields (fixed for location object)
// ================================

const { db } = require("../config/firestore");

async function loadFields() {
  const snap = await db.collection("fields").get();
  const out = [];

  snap.forEach(doc => {
    const d = doc.data();

    const lat = d?.lat ?? d?.location?.lat;
    const lng = d?.lng ?? d?.location?.lng;

    if (!lat || !lng) return;

    out.push({
      id: doc.id,
      lat,
      lng
    });
  });

  return out;
}

module.exports = { loadFields };
