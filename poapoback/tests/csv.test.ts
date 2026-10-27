import assert from "node:assert/strict";
import { test } from "node:test";
import { Readable } from "node:stream";
import csvParser from "csv-parser";
import { detectCsvSeparator } from "../src/services/csv";

test("CSV : séparateur détecté (virgule, point-virgule, tabulation, BOM, guillemets)", async () => {
  assert.equal(detectCsvSeparator(Buffer.from("question,answer\nq,a")), ",");
  assert.equal(detectCsvSeparator(Buffer.from("question;answer;helpText\nq;a;")), ";");
  assert.equal(detectCsvSeparator(Buffer.from("﻿question\tanswer\nq\ta")), "\t");
  assert.equal(detectCsvSeparator(Buffer.from('"a;b",c,d\n1,2,3')), ",");
  assert.equal(detectCsvSeparator(Buffer.from("seul")), ",");
  const buffer = Buffer.from("question;answer;acidite\nQuel goût ?;Fruité;0,8\n");
  const rows: Record<string, string>[] = [];
  await new Promise((resolve) => Readable.from([buffer]).pipe(csvParser({ separator: detectCsvSeparator(buffer) })).on("data", (r) => rows.push(r)).on("end", resolve));
  assert.deepEqual(rows, [{ question: "Quel goût ?", answer: "Fruité", acidite: "0,8" }]);
});
