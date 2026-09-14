import assert from "node:assert/strict";
import fs from "node:fs";

const sourcePath = "residanat-mauritania/mauritania-tunis-lite.html";
const deployPath = "netlify-deploy/residanat-mauritania/mauritania-tunis-lite.html";
const dataPath = "residanat-mauritania/data/lectures.json";
const normalize = (value) => value.replace(/\r\n/g, "\n");
const source = normalize(fs.readFileSync(sourcePath, "utf8"));
const deploy = normalize(fs.readFileSync(deployPath, "utf8"));
const admin = fs.readFileSync("admin.html", "utf8");
const sourceWorker = normalize(fs.readFileSync("residanat-mauritania/sw.js", "utf8"));
const deployWorker = normalize(fs.readFileSync("netlify-deploy/residanat-mauritania/sw.js", "utf8"));
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const groups = Object.entries(data).filter(([, items]) => items.length);
const lectures = groups.flatMap(([, items]) => items);
const trainingQcmCount = fs.readdirSync("residanat-mauritania/data/training")
  .filter((name) => name.endsWith(".json"))
  .reduce((total, name) => {
    const payload = JSON.parse(fs.readFileSync(`residanat-mauritania/data/training/${name}`, "utf8"));
    const questions = Array.isArray(payload) ? payload : payload.questions || [];
    return total + questions.filter((question) => (question.type || "quiz") === "quiz").length;
  }, 0);

assert.equal(source, deploy, "source and deployment pages must stay identical");
assert.doesNotMatch(admin, /IA Gemini|Replicate/, "technical provider labels must stay out of admin presentation");
assert.match(admin, /1 crédit = 1 PDF/);
assert.doesNotMatch(admin, /Vente AI Mauritanie|CSV paiements|packageForm|billingSettingsForm/);
assert.equal(sourceWorker, deployWorker, "source and deployment service workers must stay identical");
assert.match(sourceWorker, /resihub-mauritania-v52/, "cache version must refresh returning users");
assert.equal(groups.length, 3, "only the three populated categories should be shown");
assert.equal(lectures.length, 115, "lecture total should match the current dataset");
assert.equal(lectures.filter((item) => item.training).length, 115, "quiz total should match the current dataset");
assert.equal(trainingQcmCount, 5635, "QCM total should match the verified training bank");
assert.match(source, /id="home" class="view active"/);
assert.match(source, /LAST_LECTURE_KEY/);
assert.match(source, /QUESTIONS_PER_QUIZ = 50/);
assert.match(source, /return group\(state\.lectures\)\.filter/);
assert.match(source, /\["#lectures", "#quiz", "#exam", "#ai", "#more"\]/);
assert.match(source, /aria-label="Rechercher dans la matière"/);
assert.match(source, /class="tabbar" aria-label="Navigation mobile"/);
assert.match(source, /data-view="more"/);
assert.match(source, /id="homeCourseTotal"/);
assert.match(source, /Réviser avec méthode, progresser avec confiance/);
assert.match(source, /css\/mauritania-ui\.css\?v=resihub-20260903-7/);
assert.match(source, /class="mauritania-app"/);
assert.match(source, /session-progress/);
assert.match(source, /class="quiz-navigation"/);
assert.match(source, /QUIZ_SESSION_KEY/);
assert.match(source, /function restoreSavedLectureQuiz/);
assert.match(source, /function goToQuizQuestion/);
assert.doesNotMatch(source, /fonts\.googleapis\.com/);

console.log("Mauritania dashboard wiring: ok");
