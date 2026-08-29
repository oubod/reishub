import assert from "node:assert/strict";
import fs from "node:fs";

for (const root of ["residanat-mauritania", "netlify-deploy/residanat-mauritania"]) {
  const app = fs.readFileSync(`${root}/mauritania-tunis-lite.html`, "utf8");
  const viewer = fs.readFileSync(`${root}/mobile_pdf_viewer.html`, "utf8");
  assert.match(app, /mobile_pdf_viewer\.html\?file=/);
  assert.match(app, /matchMedia\("\(max-width: 767px\)"\)/);
  assert.match(viewer, /URLSearchParams\(location\.search\)\.get\('file'\)/);
  assert.match(viewer, /pdfjsLib\.getDocument\(\{ data: pdfData \}\)/);
}

console.log("mobile PDF viewer wiring: ok");
