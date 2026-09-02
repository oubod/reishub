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
assert.equal(tools.geminiSchema.type, "OBJECT");

const normalizeLines = (value) => value.replace(/\r\n/g, "\n");
const sourcePage = normalizeLines(fs.readFileSync("./residanat-mauritania/mauritania-tunis-lite.html", "utf8"));
const deployPage = normalizeLines(fs.readFileSync("./netlify-deploy/residanat-mauritania/mauritania-tunis-lite.html", "utf8"));
assert.equal(sourcePage, deployPage);
assert.match(sourcePage, /data-view="more"/);
assert.match(sourcePage, /<h3>Examen blanc<\/h3>/);
assert.match(sourcePage, /class="tab" type="button" data-view="more"/);
assert.equal((sourcePage.match(/Examen \(par Dr Sena\)/g) || []).length, 0);
assert.doesNotMatch(sourcePage, /id="continueCard"|Continuer ma lecture/);
assert.match(sourcePage, /id="homeCourseTotal"/);
assert.match(fs.readFileSync("./residanat-mauritania/js/advanced-tools.js", "utf8"), /exam:\$\{userId\}/);
assert.match(fs.readFileSync("./residanat-mauritania/sw.js", "utf8"), /resihub-mauritania-v41/);
assert.match(fs.readFileSync("./residanat-mauritania/js/advanced-tools.js", "utf8"), /ResiAiJobs\.open/);
assert.doesNotMatch(sourcePage, /ai-studio\.html|ai-studio-frame/);
assert.match(fs.readFileSync("./residanat-mauritania/js/ai-jobs.js", "utf8"), /PDF groupé/);
assert.equal(
  normalizeLines(fs.readFileSync("./residanat-mauritania/js/advanced-tools.js", "utf8")),
  normalizeLines(fs.readFileSync("./netlify-deploy/residanat-mauritania/js/advanced-tools.js", "utf8"))
);
const sourceApp = fs.readFileSync("./residanat-mauritania/js/app.js", "latin1");
const deployApp = fs.readFileSync("./netlify-deploy/residanat-mauritania/js/app.js", "latin1");
assert.equal(sourceApp, deployApp);
assert.match(sourceApp, /practiceQuestionTimes/);
assert.match(sourceApp, /Med khouna/);
assert.match(sourceApp, /retry-incorrect-btn/);
assert.match(sourceApp, /formatPracticeDuration/);
assert.match(sourcePage, /quizQuestionTimer/);
assert.match(sourcePage, /retryLectureQuizMistakes/);
assert.match(sourcePage, /Med khouna/);
assert.match(sourcePage, /const ICON_PATHS/);
assert.match(sourcePage, /class="session-shell"/);
assert.match(fs.readFileSync("./residanat-mauritania/js/advanced-tools.js", "utf8"), /Idée proposée par Dr Sena/);
assert.doesNotMatch(fs.readFileSync("./residanat-mauritania/js/advanced-tools.js", "utf8"), /class="ai-hero"/);

for (const page of ["login.html", "mobile_pdf_viewer.html"]) {
  const sourceFile = normalizeLines(fs.readFileSync(`./residanat-mauritania/${page}`, "utf8"));
  const deployFile = normalizeLines(fs.readFileSync(`./netlify-deploy/residanat-mauritania/${page}`, "utf8"));
  assert.equal(sourceFile, deployFile, `${page} source/deployment mismatch`);
  assert.match(sourceFile, /mauritania-ui\.css\?v=resihub-20260902-3/);
  assert.doesNotMatch(sourceFile, /Material\+Symbols|fonts\.googleapis\.com/);
}

assert.equal(
  normalizeLines(fs.readFileSync("./residanat-mauritania/css/mauritania-ui.css", "utf8")),
  normalizeLines(fs.readFileSync("./netlify-deploy/residanat-mauritania/css/mauritania-ui.css", "utf8"))
);
assert.match(fs.readFileSync("./sw.js", "utf8"), /resihub-pwa-v34/);

console.log("Mauritania advanced feature checks passed.");
