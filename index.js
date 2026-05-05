// ================================
// FILE: index.js
// PURPOSE: ENTRY + ROUTES ONLY
// ================================

const express = require("express");
const { runBatch } = require("./services/run");

const app = express();
app.disable("x-powered-by");

const PORT = process.env.PORT || 8080;

app.get("/", async (req, res) => {
  if (req.query.run === "1") {
    const out = await runBatch(req);
    return res.json(out);
  }
  res.send("OK");
});

app.get("/healthz", (req, res) => {
  res.send("ok");
});

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
