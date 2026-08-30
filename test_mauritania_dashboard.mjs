import assert from "node:assert/strict";
import fs from "node:fs";

const sourcePath = "residanat-mauritania/mauritania-tunis-lite.html";
const deployPath = "netlify-deploy/residanat-mauritania/mauritania-tunis-lite.html";
const dataPath = "residanat-mauritania/data/lectures.json";
const source = fs.readFileSync(sourcePath, "utf8");
const deploy = fs.readFileSync(deployPath, "utf8");
const sourceWorker = fs.readFileSync("residanat-mauritania/sw.js", "utf8");
const deployWorker = fs.readFileSync("netlify-deploy/residanat-mauritania/sw.js", "utf8");
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const groups = Object.entries(data).filter(([, items]) => items.length);
const lectures = groups.flatMap(([, items]) => items);

assert.equal(source, deploy, "source and deployment pages must stay identical");
assert.equal(sourceWorker, deployWorker, "source and deployment service workers must stay identical");
assert.match(sourceWorker, /resihub-mauritania-v36/, "cache version must refresh returning users");
assert.equal(groups.length, 3, "only the three populated categories should be shown");
assert.equal(lectures.length, 115, "lecture total should match the current dataset");
assert.equal(lectures.filter((item) => item.training).length, 115, "quiz total should match the current dataset");
assert.equal(lectures.filter((item) => item.training).length * 50, 5750, "QCM total should include 50 questions per series");
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
assert.match(source, /css\/mauritania-ui\.css\?v=resihub-20260830-2/);
assert.match(source, /class="mauritania-app"/);
assert.match(source, /session-progress/);
assert.doesNotMatch(source, /fonts\.googleapis\.com/);

console.log("Mauritania dashboard wiring: ok");
