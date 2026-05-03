const express = require("express");
const app = express();

const routes = require("./src/api/routes");

app.use("/", routes);

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log("Readiness Engine running on port", PORT);
});
