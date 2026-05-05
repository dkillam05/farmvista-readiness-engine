// ============================================
// FILE: readiness-writer.js
// ============================================

const { getFirestore } = require("./firestore");

async function writeReadiness(fieldId, snapshot) {
  const db = getFirestore();

  await db.collection("field_readiness_latest").doc(fieldId).set({
    readiness: snapshot.readinessR,
    wetness: snapshot.wetnessR,
    storageFinal: snapshot.storageFinal,
    updatedAt: new Date()
  }, { merge: true });
}

module.exports = { writeReadiness };
