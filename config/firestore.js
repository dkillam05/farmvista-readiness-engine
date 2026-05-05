// ================================
// FILE: config/firestore.js
// PURPOSE: FIRESTORE INIT
// ================================

const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

module.exports = { db, admin };
