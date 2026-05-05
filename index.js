// ============================================
// FILE: index.js
// PURPOSE:
// Simple runner for readiness engine
// ============================================

const admin = require("firebase-admin");

const { runReadinessEngine } = require("./js/engine");

// --------------------------------------------
// INIT FIREBASE
// --------------------------------------------
admin.initializeApp();
const db = admin.firestore();

// --------------------------------------------
// COLLECTIONS
// --------------------------------------------
const FIELDS = "fields";
const WEATHER = "field_weather_cache";
const MRMS = "field_mrms_weather";

// --------------------------------------------
// MAIN RUN
// --------------------------------------------
async function run() {
  console.log("🚜 Starting readiness run...");

  const fieldsSnap = await db.collection(FIELDS).get();

  for (const doc of fieldsSnap.docs) {
    const field = { id: doc.id, ...doc.data() };

    if (field.status !== "active") continue;

    console.log(`\n➡️ Field: ${field.name}`);

    const wxDoc = await db.collection(WEATHER).doc(doc.id).get();
    const mrmsDoc = await db.collection(MRMS).doc(doc.id).get();

    if (!wxDoc.exists) {
      console.log("❌ No weather data");
      continue;
    }

    const result = runReadinessEngine(
      wxDoc.data(),
      mrmsDoc.exists ? mrmsDoc.data() : null,
      field
    );

    if (!result.ok) {
      console.log("❌ Failed:", result.error);
      continue;
    }

    console.log("✅ Readiness:", result.readiness);
    console.log("   Wetness:", result.wetness);
    console.log("   Surface:", result.surfaceStorageFinal);
  }

  console.log("\n✅ Run complete");
}

// --------------------------------------------
// RUN
// --------------------------------------------
run().catch((err) => {
  console.error("🔥 Fatal error:", err);
});
