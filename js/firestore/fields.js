// ============================================
// FILE: fields.js
// ============================================

const { getFirestore } = require("./firestore");

async function loadActiveFields() {
  const db = getFirestore();
  const snap = await db.collection("fields").get();

  const out = [];

  snap.forEach(doc => {
    const d = doc.data() || {};
    if (d.status && d.status !== "active") return;

    out.push({
      id: doc.id,
      name: d.name || "",
      lat: d.lat,
      lng: d.lng
    });
  });

  return out;
}

module.exports = { loadActiveFields };
