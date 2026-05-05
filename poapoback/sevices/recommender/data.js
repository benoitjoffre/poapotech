const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "..", "..", "data");

const questions = JSON.parse(
  fs.readFileSync(path.join(dataDir, "questions.json"), "utf8")
);
const perfumes = JSON.parse(
  fs.readFileSync(path.join(dataDir, "perfumes.json"), "utf8")
);

module.exports = {
  questions,
  perfumes,
};
