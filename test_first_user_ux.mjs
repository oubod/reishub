import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [landing, tunis, mauritania, tunisAuth, mauritaniaAuth] = await Promise.all([
  read("index.html"),
  read("tunis.html"),
  read("residanat-mauritania/mauritania-tunis-lite.html"),
  read("auth-tunis.js"),
  read("residanat-mauritania/js/portal-auth.js")
]);

assert.match(landing, /data-guest="tunis"/);
assert.match(landing, /data-guest="mauritania"/);
assert.match(tunis, /contenus verrouillés/);
assert.match(mauritania, /contenus verrouillés/);
assert.doesNotMatch(tunis, /docs\.google\.com\/gview/);
assert.match(tunisAuth, /params\.get\("mode"\) === "signup"/);
assert.match(mauritaniaAuth, /params\.get\('mode'\) === 'signup'/);

for (const path of ["index.html", "tunis.html", "login-tunis.html", "auth-tunis.js"]) {
  assert.equal(await read(path), await read(`netlify-deploy/${path}`), `${path} deploy copy differs`);
}

console.log("First-user UX checks passed");
