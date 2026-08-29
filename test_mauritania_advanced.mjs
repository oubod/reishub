import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const tools = require("./residanat-mauritania/js/study-tools.js");
const data = JSON.parse(fs.readFileSync("./residanat-mauritania/data/lectures.json", "utf8"));

assert.deepEqual(Object.fromEntries(Object.entries(data).filter(([, items]) => items.length).map(([name, items]) => [name, items.length])), {
  "Sciences Fondamentales": 30,
  "Pathologies Médicales": 50,
  "Pathologies Chirurgicales": 35
});
const examSample = [];
for (const [category, items] of Object.entries(data).filter(([, entries]) => entries.length)) {
  for (const lecture of items.slice(0, 20)) {
    const payload = JSON.parse(fs.readFileSync(`./residanat-mauritania/${lecture.training}`, "utf8"));
    assert.ok(payload.questions.length > 0, `${lecture.id} has no QCM`);
    examSample.push(`${category}:${lecture.id}:${payload.questions[0].id}`);
  }
}
assert.equal(examSample.length, 60);
assert.equal(new Set(examSample).size, 60);

const question = { options: [{ id: "A", correct: true }, { id: "B", correct: false }, { id: "C", correct: true }, { id: "D", correct: false }] };
assert.equal(tools.exactAnswer(question, ["C", "A"]), true);
assert.equal(tools.exactAnswer(question, ["A"]), false);
assert.equal(tools.exactAnswer(question, ["A", "B", "C"]), false);

const questions = [
  { ...question, examId: "1", category: "Fondamental" },
  { ...question, examId: "2", category: "Médical" }
];
assert.deepEqual(tools.scoreExam(questions, { 1: ["A", "C"], 2: [] }), {
  score: 1,
  total: 2,
  unanswered: 1,
  categories: { Fondamental: { score: 1, total: 1 }, "Médical": { score: 0, total: 1 } }
});

const difficulties = [...Array(10).fill("facile"), ...Array(12).fill("intermediaire"), ...Array(8).fill("difficile")];
const generated = { questions: difficulties.map((difficulty, index) => ({
  question: `Question médicale unique ${index + 1}`,
  difficulty,
  options: ["A", "B", "C", "D"].map((id, optionIndex) => ({ id, text: `Proposition ${id}`, correct: optionIndex === 0 })),
  explanation: "Explication issue du document."
})) };
assert.equal(tools.validateGeneratedQuiz(generated).length, 30);
assert.throws(() => tools.validateGeneratedQuiz({ questions: generated.questions.slice(0, 29) }), /exactement 30/);

const normalizeLines = (value) => value.replace(/\r\n/g, "\n");
const sourcePage = normalizeLines(fs.readFileSync("./residanat-mauritania/mauritania-tunis-lite.html", "utf8"));
const deployPage = normalizeLines(fs.readFileSync("./netlify-deploy/residanat-mauritania/mauritania-tunis-lite.html", "utf8"));
assert.equal(sourcePage, deployPage);
assert.match(sourcePage, /data-view="exam"/);
assert.match(sourcePage, /data-view="ai"/);
assert.match(fs.readFileSync("./residanat-mauritania/js/advanced-tools.js", "utf8"), /exam:\$\{userId\}/);
assert.match(fs.readFileSync("./residanat-mauritania/sw.js", "utf8"), /resihub-mauritania-v29/);
assert.equal(
  normalizeLines(fs.readFileSync("./residanat-mauritania/js/advanced-tools.js", "utf8")),
  normalizeLines(fs.readFileSync("./netlify-deploy/residanat-mauritania/js/advanced-tools.js", "utf8"))
);

console.log("Mauritania advanced feature checks passed.");
