const express = require("express");

const handleWebhook = require("./webhook");

const app = express();

app.use(express.json());

app.post("/webhook", (req, res) => {
  handleWebhook(req);
});
app.use("/static", express.static("/app/downloads"));

app.listen(3000, () => console.log("app listening on port 3000!"));

process.on("uncaughtException", function (error) {
  console.log("uncaughtException");
  console.log(error);
});

process.on("unhandledRejection", function (reason, p) {
  console.log("unhandledRejection");
  console.log(reason, p);
});
