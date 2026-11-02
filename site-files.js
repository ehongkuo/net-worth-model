"use strict";
// Files the browser app needs: published path -> source path. The local
// server serves exactly these, and `npm run build` copies them into dist/.
const appFiles = [
  "index.html",
  "style.css",
  "app.js",
  "presentation.js",
  "util.js",
  "input-rules.js",
  "profile.js",
  "scenario.js",
  "projection.js",
  "compensation.js",
  "equity-schedule.js",
  "grant-timeline.js",
  "money-flow.js",
  "compact-flow.js",
  "tax-engine.js",
  "tax-ui.js",
  "development-defaults.js",
  "payroll-calendar.js",
  "paystub-parser.js",
];
const siteFiles = new Map([
  ...appFiles.map((file) => [file, file]),
  ["vendor/pdf.mjs", "node_modules/pdfjs-dist/build/pdf.mjs"],
  ["vendor/pdf.worker.mjs", "node_modules/pdfjs-dist/build/pdf.worker.mjs"],
]);
// The personal preset is gitignored; deployments and fresh checkouts get this.
const emptyDefaults = "// No local development preset.\n";
module.exports = { siteFiles, emptyDefaults };
