"use strict";
// Builds the static site in dist/ for Cloudflare. The personal preset is never
// copied: the deployed app always gets the empty one.
const fs = require("node:fs");
const path = require("node:path");
const { siteFiles, emptyDefaults } = require("../site-files");

const root = path.join(__dirname, "..");
function build(dist = path.join(root, "dist")) {
  fs.rmSync(dist, { recursive: true, force: true });
  for (const [published, source] of siteFiles) {
    const target = path.join(dist, published);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (published === "development-defaults.js")
      fs.writeFileSync(target, emptyDefaults);
    else fs.copyFileSync(path.join(root, source), target);
  }
  fs.copyFileSync(path.join(root, "_headers"), path.join(dist, "_headers"));
  return dist;
}
if (require.main === module) {
  build();
  console.log(`Built ${siteFiles.size} files in dist/`);
}
module.exports = { build };
