// ============================================
// FILE: firestore.js
// ============================================

let admin;
let db;

function getFirestore() {
  if (db) return db;

  admin = require("firebase-admin");

  if (!admin.apps.length) {
    admin.initializeApp();
  }

  db = admin.firestore();
  return db;
}

module.exports = { getFirestore };
