// ================================
// FILE: services/fields.js
// PURPOSE: Load fields (fixed for location object)
// ================================

// COPY YOUR ORIGINAL FIELD LOADER HERE EXACTLY

const db = require("../config/firestore");

module.exports = async function loadFields() {
  const snap = await db.collection("fields").get();
  const out = [];

  snap.forEach(doc => {
    const d = doc.data();

    // EXACT same logic from your original file
    const lat = d?.location?.lat ?? d?.lat;
    const lng = d?.location?.lng ?? d?.lng;

    if (!lat || !lng) return;

    out.push({
      id: doc.id,
      name: d.name,
      lat,
      lng,
      raw: d
    });
  });

  return out;
};
