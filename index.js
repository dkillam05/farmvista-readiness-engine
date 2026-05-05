// ============================================
// FILE: index.js
// PURPOSE:
// Cloud Run runner + readiness engine
// ============================================

const express = require("express");
const admin = require("firebase-admin");

const { runReadinessEngine } = require("./js/engine");

// --------------------------------------------
// INIT FIREBASE
// --------------------------------------------
admin.initializeApp();
const db = admin.firestore();

const app = express();

// --------------------------------------------
// COLLECTIONS
// --------------------------------------------
const FIELDS = "fields";
const WEATHER = "field_weather_cache";
const MRMS = "field_mrms_weather";

// --------------------------------------------
// MAIN RUN (UNCHANGED LOGIC)
// --------------------------------------------
async function run() {
  console.log("🚜 Starting readiness run...");

  const fieldsSnap = await db.collection(FIELDS).get();

  const results = [];

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

    results.push({
      fieldId: doc.id,
      name: field.name,
      readiness: result.readiness,
      wetness: result.wetness,
      surface: result.surfaceStorageFinal
    });
  }

  console.log("\n✅ Run complete");

  return results;
}

// --------------------------------------------
// ROUTES
// --------------------------------------------

// Health check
app.get("/", (req, res) => {
  res.send("FarmVista Readiness Engine Running");
});

// Manual run trigger
app.get("/run", async (req, res) => {
  try {
    const results = await run();

    res.json({
      ok: true,
      count: results.length,
      results
    });
  } catch (err) {
    console.error("🔥 Run error:", err);
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

// --------------------------------------------
// START SERVER (REQUIRED FOR CLOUD RUN)
// --------------------------------------------
const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
