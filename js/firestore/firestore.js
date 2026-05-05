// ============================================
// FILE: firestore.js
// PURPOSE: Initialize and export Firestore
// ============================================

let admin = null;
let db = null;

function getFirestore() {
  if (db) return db;

  admin = require("firebase-admin");

  if (!admin.apps.length) {
    admin.initializeApp();
  }

  db = admin.firestore();
  return db;
}

module.exports = {
  getFirestore
};
