import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const updater = read("assets/js/pwa-update.js");
const rootWorker = read("sw.js");
const mauritaniaWorker = read("residanat-mauritania/sw.js");
const headers = read("_headers");

assert.equal(updater, read("netlify-deploy/assets/js/pwa-update.js"));
assert.equal(rootWorker, read("netlify-deploy/sw.js"));
assert.equal(mauritaniaWorker, read("netlify-deploy/residanat-mauritania/sw.js"));
assert.equal(headers, read("netlify-deploy/_headers"));

assert.doesNotMatch(updater, /window\.confirm/);
assert.match(updater, /activateUpdate\(registration\.waiting\)/);
assert.match(updater, /visibilitychange/);
assert.match(updater, /pageshow/);
assert.match(updater, /controllerchange/);

assert.match(rootWorker, /resihub-pwa-v34/);
assert.match(rootWorker, /await self\.skipWaiting\(\)/);
assert.match(rootWorker, /request\.mode === "navigate"/);
assert.match(mauritaniaWorker, /resihub-mauritania-v39/);
assert.match(mauritaniaWorker, /self\.skipWaiting\(\)/);
assert.match(mauritaniaWorker, /event\.request\.mode === 'navigate'/);
assert.match(headers, /\/residanat-mauritania\/sw\.js\s+Cache-Control: no-cache/);
assert.match(headers, /\/residanat-mauritania\/\*\.html\s+Cache-Control: no-cache/);

const rootPages = ["index.html", "login-tunis.html", "admin.html", "tunis.html"];
const mauritaniaPages = ["index.html", "login.html", "instructions.html", "mobile_pdf_viewer.html", "mauritania-tunis-lite.html"];
for (const path of rootPages) {
  assert.match(read(path), /pwa-update\.js\?v=resihub-20260829-1" data-sw="sw\.js\?v=resihub-20260829-1"/);
}
for (const path of mauritaniaPages) {
  assert.match(read(`residanat-mauritania/${path}`), /pwa-update\.js\?v=resihub-20260902-1" data-sw="\.\/sw\.js\?v=resihub-20260902-1"/);
}

console.log("automatic PWA update wiring: ok");
