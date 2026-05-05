// ================================
// FILE: services/fields.js
// PURPOSE: LOAD FIELDS
// ================================

const { db } = require("../config/firestore");

async function loadFields() {
  const snap = await db.collection("fields").get();
  const out = [];

  snap.forEach(doc => {
    const d = doc.data();
    if (!d?.lat || !d?.lng) return;

    out.push({
      id: doc.id,
      lat: d.lat,
      lng: d.lng
    });
  });

  return out;
}

module.exports = { loadFields };
