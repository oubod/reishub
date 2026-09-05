import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const sourceAuth = read("residanat-mauritania/js/portal-auth.js");
const deployAuth = read("netlify-deploy/residanat-mauritania/js/portal-auth.js");
const migration = read("supabase/migrations/20260905010000_limit_mauritania_devices.sql");

assert.equal(sourceAuth, deployAuth, "Mauritania auth source/deployment mismatch");
assert.match(sourceAuth, /mauritania_register_session/);
assert.match(sourceAuth, /Ce compte est déjà ouvert sur 2 appareils/);
assert.match(sourceAuth, /signOut\(\{ scope: 'local' \}\)/);
assert.match(sourceAuth, /mauritania_release_session/);
assert.match(migration, /create table if not exists public\.mauritania_active_sessions/);
assert.match(migration, /unique \(user_id, device_id\)/);
assert.match(migration, /active_count >= 2/);
assert.match(migration, /enable row level security/);
assert.match(migration, /mauritania_release_session/);

for (const path of [
  "residanat-mauritania/mauritania-tunis-lite.html",
  "netlify-deploy/residanat-mauritania/mauritania-tunis-lite.html"
]) {
  const page = read(path);
  assert.match(page, /portal-auth\.js\?v=9/);
  assert.match(page, /releaseMauritaniaDeviceSession/);
  assert.match(page, /scope: "local"/);
}

for (const path of ["residanat-mauritania/sw.js", "netlify-deploy/residanat-mauritania/sw.js"]) {
  const serviceWorker = read(path);
  assert.match(serviceWorker, /resihub-mauritania-v49/);
  assert.match(serviceWorker, /portal-auth\.js\?v=9/);
}

console.log("Mauritania two-device session checks passed.");
