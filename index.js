// ============================================
// FILE: index.js
// PURPOSE:
// Cloud Run runner + readiness engine + Firestore write
// WITH SEED LOGIC (rolling + baseline + location change)
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
const FIELD_CONDITIONS = "field_conditions_current";

// --------------------------------------------
// HELPERS
// --------------------------------------------
function isSameLocation(a, b, epsilon = 0.00001) {
  if (!a || !b) return false;

  return (
    Math.abs(Number(a.lat) - Number(b.lat)) < epsilon &&
    Math.abs(Number(a.lng) - Number(b.lng)) < epsilon
  );
}

// --------------------------------------------
// MAIN RUN
// --------------------------------------------
async function run() {
  console.log("🚜 Starting readiness run...");

  const fieldsSnap = await db.collection(FIELDS).get();

  const results = [];
  const batch = db.batch();

  for (const doc of fieldsSnap.docs) {
    const field = { id: doc.id, ...doc.data() };

    if (field.status !== "active") continue;

    console.log(`\n➡️ Field: ${field.name}`);

    const wxDoc = await db.collection(WEATHER).doc(doc.id).get();
    const mrmsDoc = await db.collection(MRMS).doc(doc.id).get();

    if (!wxDoc.exists) {
      console.log("❌ No weather data — skipping write");
      continue;
    }

    // --------------------------------------------
    // LOAD EXISTING STATE
    // --------------------------------------------
    const existingDocSnap = await db
      .collection(FIELD_CONDITIONS)
      .doc(doc.id)
      .get();

    const existing = existingDocSnap.exists
      ? existingDocSnap.data()
      : null;

    // --------------------------------------------
    // DETERMINE SEED MODE
    // --------------------------------------------
    let seedMode = "baseline_30d";
    let seedStorage = null;
    let seedSurface = null;

    if (!existing) {
      seedMode = "baseline_30d";
    } else if (!isSameLocation(existing.location, field.location)) {
      seedMode = "location_changed_baseline_30d";
    } else if (
      Number.isFinite(existing?.soil?.storage) &&
      Number.isFinite(existing?.surface?.water)
    ) {
      seedMode = "rolling";
      seedStorage = Number(existing.soil.storage);
      seedSurface = Number(existing.surface.water);
    }

    console.log("🌱 Seed Mode:", seedMode);

    // --------------------------------------------
    // RUN ENGINE (WITH SEED)
    // --------------------------------------------
    const result = runReadinessEngine(
      wxDoc.data(),
      mrmsDoc.exists ? mrmsDoc.data() : null,
      field,
      {
        seedMode,
        seedStorage,
        seedSurface
      }
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

    // --------------------------------------------
    // WRITE TO FIRESTORE
    // --------------------------------------------
    const outRef = db.collection(FIELD_CONDITIONS).doc(doc.id);

    batch.set(
      outRef,
      {
        fieldId: doc.id,
        fieldName: field.name || null,

        farmId: field.farmId || null,
        farmName: field.farmName || null,

        location: field.location || null,
        county: field.county || null,
        state: field.state || null,

        readiness: Number(result.readiness),
        wetness: Number(result.wetness),

        baseReadiness: Number(result.baseReadiness ?? result.readiness),
        surfacePenalty: Number(result.surfacePenalty ?? 0),

        soil: {
          storage: Number(result.storageFinal),
          Smax: Number(result.factors?.Smax || 0)
        },

        surface: {
          water: Number(result.surfaceStorageFinal),
          penalty: Number(result.surfacePenalty ?? 0)
        },

        asOfDateISO: new Date().toISOString().slice(0, 10),
        computedAt: admin.firestore.FieldValue.serverTimestamp(),

        modelVersion: "2026-seed-system",
        source: "farmvista-engine",

        seedMode,

        status: "ok"
      },
      { merge: true }
    );
  }

  await batch.commit();
  console.log("💾 Firestore write complete");
  console.log("\n✅ Run complete");

  return results;
}

// --------------------------------------------
// ROUTES
// --------------------------------------------
app.get("/", (req, res) => {
  res.send("FarmVista Readiness Engine Running");
});

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
// START SERVER
// --------------------------------------------
const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
