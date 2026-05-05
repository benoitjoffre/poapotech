const express = require("express");
const quizRoutes = require("./routes/quiz");

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

app.use("/api/quiz", quizRoutes);

const port = process.env.PORT || 5050;
app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});
