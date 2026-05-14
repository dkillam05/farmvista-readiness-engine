// ============================================
// FILE: index.js
// PURPOSE:
// Cloud Run runner + weather builder + readiness engine
// + DAILY DEBUG TRACE WRITER
// + LIVE QUICKVIEW PREVIEW ENDPOINT
// + CORS SUPPORT FOR FARMVISTA FRONTEND
// ============================================

const express = require("express");
const admin = require("firebase-admin");

const { runReadinessEngine } = require("./js/engine");
const { buildWeatherCache } = require("./js/weather-builder");
const { writeDailyDebug } = require("./js/daily-debug-writer");

// --------------------------------------------
// INIT FIREBASE
// --------------------------------------------
admin.initializeApp();

const db = admin.firestore();

const app = express();

// --------------------------------------------
// CORS
// --------------------------------------------
app.use((req, res, next) => {
  const origin = req.headers.origin || "";

  const allowedOrigins = [
    "https://danekillam.github.io",
    "https://dowsonfarms-illinois.web.app",
    "https://dowsonfarms-illinois.firebaseapp.com"
  ];

  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type,Authorization,Accept,Origin"
  );
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  return next();
});

app.use(express.json());

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
  if (!a || !b) {
    return false;
  }

  return (
    Math.abs(Number(a.lat) - Number(b.lat)) < epsilon &&
    Math.abs(Number(a.lng) - Number(b.lng)) < epsilon
  );
}

function clamp(n, lo, hi) {
  n = Number(n);

  if (!Number.isFinite(n)) {
    return lo;
  }

  return Math.max(lo, Math.min(hi, n));
}

// ============================================
// MAIN READINESS RUN
// ============================================
async function run() {
  console.log("🚜 Starting readiness run...");

  const fieldsSnap = await db.collection(FIELDS).get();

  const results = [];
  const batch = db.batch();

  for (const doc of fieldsSnap.docs) {
    const field = {
      id: doc.id,
      ...doc.data()
    };

    if (field.status !== "active") {
      continue;
    }

    console.log(`\n➡️ Field: ${field.name}`);

    const wxDoc = await db.collection(WEATHER).doc(doc.id).get();
    const mrmsDoc = await db.collection(MRMS).doc(doc.id).get();

    if (!wxDoc.exists) {
      console.log("❌ No weather data — skipping write");
      continue;
    }

    if (!mrmsDoc.exists) {
      console.log("❌ Missing MRMS rainfall — skipping");
      continue;
    }

    const existingDocSnap = await db
      .collection(FIELD_CONDITIONS)
      .doc(doc.id)
      .get();

    const existing = existingDocSnap.exists
      ? existingDocSnap.data()
      : null;

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

    const result = runReadinessEngine(
      wxDoc.data(),
      mrmsDoc.data(),
      field,
      {
        seedMode,
        seedStorage,
        seedSurface
      }
    );

    if (!result || !result.ok) {
      console.log(
        "❌ Failed:",
        result?.error || "Unknown engine failure"
      );
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
          Smax: Number(result?.factors?.Smax || 0)
        },

        surface: {
          water: Number(result.surfaceStorageFinal),
          penalty: Number(result.surfacePenalty ?? 0)
        },

        storageFinal: Number(result.storageFinal ?? 0),
        surfaceStorageFinal: Number(result.surfaceStorageFinal ?? 0),
        storageForReadiness: Number(result.storageForReadiness ?? 0),
        readinessCreditIn: Number(result.readinessCreditIn ?? 0),

        asOfDateISO: new Date().toISOString().slice(0, 10),
        computedAt: admin.firestore.FieldValue.serverTimestamp(),

        modelVersion: "2026-seed-system",
        source: "farmvista-engine",
        seedMode,
        status: "ok"
      },
      { merge: true }
    );

    try {
      await writeDailyDebug({
        db,
        field,
        result,
        wxDoc: wxDoc.data(),
        mrmsDoc: mrmsDoc.data()
      });

      console.log("🧠 Daily debug traces written");
    } catch (err) {
      console.log("❌ Daily debug writer failed:", err.message);
    }
  }

  await batch.commit();

  console.log("💾 Firestore write complete");
  console.log("\n✅ Run complete");

  return results;
}

// ============================================
// ROUTES
// ============================================
app.get("/", (req, res) => {
  res.send("FarmVista Readiness Engine Running");
});

// ============================================
// LIVE PREVIEW ROUTE
// ============================================
app.get("/preview-readiness", async (req, res) => {
  try {
    const fieldId = String(req.query.fieldId || "").trim();

    if (!fieldId) {
      return res.status(400).json({
        ok: false,
        error: "Missing fieldId"
      });
    }

    const fieldSnap = await db.collection(FIELDS).doc(fieldId).get();

    if (!fieldSnap.exists) {
      return res.status(404).json({
        ok: false,
        error: "Field not found"
      });
    }

    const field = {
      id: fieldSnap.id,
      ...fieldSnap.data()
    };

    if (req.query.soilWetness != null) {
      field.soilWetness = clamp(req.query.soilWetness, 0, 100);
    }

    if (req.query.drainageIndex != null) {
      field.drainageIndex = clamp(req.query.drainageIndex, 0, 100);
    }

    const wxDoc = await db.collection(WEATHER).doc(fieldId).get();

    if (!wxDoc.exists) {
      return res.status(404).json({
        ok: false,
        error: "Weather cache missing"
      });
    }

    const mrmsDoc = await db.collection(MRMS).doc(fieldId).get();

    if (!mrmsDoc.exists) {
      return res.status(404).json({
        ok: false,
        error: "MRMS cache missing"
      });
    }

    const existingDocSnap = await db
      .collection(FIELD_CONDITIONS)
      .doc(fieldId)
      .get();

    const existing = existingDocSnap.exists
      ? existingDocSnap.data()
      : null;

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

    const result = runReadinessEngine(
      wxDoc.data(),
      mrmsDoc.data(),
      field,
      {
        seedMode,
        seedStorage,
        seedSurface
      }
    );

    if (!result || !result.ok) {
      return res.status(500).json({
        ok: false,
        error: result?.error || "Engine failed"
      });
    }

    return res.json({
      ok: true,
      preview: true,

      fieldId,

      readiness: result.readiness ?? result.readinessR,
      readinessR: result.readinessR ?? result.readiness,

      wetness: result.wetness ?? result.wetnessR,
      wetnessR: result.wetnessR ?? result.wetness,

      baseReadiness: result.baseReadiness,
      surfacePenalty: result.surfacePenalty,

      storageFinal: result.storageFinal,
      surfaceStorageFinal: result.surfaceStorageFinal,
      storageForReadiness: result.storageForReadiness,
      storagePhysFinal: result.storagePhysFinal,
      readinessCreditIn: result.readinessCreditIn,

      factors: result.factors,
      trace: result.trace || [],
      rows: result.rows || [],

      debug: {
        source: "preview-readiness",
        seedMode,
        soilWetness: field.soilWetness,
        drainageIndex: field.drainageIndex,
        returnedReadiness: result.readiness,
        returnedReadinessR: result.readinessR,
        returnedWetness: result.wetness,
        returnedWetnessR: result.wetnessR
      }
    });
  } catch (err) {
    console.error("🔥 Preview route error:", err);

    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

// ============================================
// FULL SYSTEM RUN
// ============================================
app.get("/run", async (req, res) => {
  try {
    console.log("🌦️ STEP 1: Building weather cache...");

    await buildWeatherCache(db);

    console.log("🚜 STEP 2: Running readiness engine...");

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

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});