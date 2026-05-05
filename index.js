// ENTRY ONLY

const express = require("express");
const { runBatch } = require("./services/run");

const app = express();
const PORT = process.env.PORT || 8080;

app.get("/", async (req, res) => {
  if (req.query.run === "1") {
    return res.json(await runBatch(req));
  }
  res.send("FarmVista Field Weather OK");
});

app.listen(PORT);
