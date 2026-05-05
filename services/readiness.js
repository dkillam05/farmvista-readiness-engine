// ================================
// FILE: services/readiness.js
// PURPOSE: Readiness calculation/write
// ================================

const { db, admin } = require("../config/firestore");

async function writeReadiness(field) {
  // placeholder — plug your real logic here later
  await db.collection("field_readiness_latest").doc(field.id).set({
    fieldId: field.id,
    readiness: 50,
    wetness: 50,
    storageFinal: 1,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

module.exports = { writeReadiness };
