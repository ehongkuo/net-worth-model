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
  // Self-hosted fonts: the content security policy allows only this origin.
  [
    "fonts/plex-sans.woff2",
    "node_modules/@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-normal.woff2",
  ],
  [
    "fonts/plex-mono-400.woff2",
    "node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2",
  ],
  [
    "fonts/plex-mono-500.woff2",
    "node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2",
  ],
]);
// The personal preset is gitignored; deployments and fresh checkouts get this.
const emptyDefaults = "// No local development preset.\n";
module.exports = { siteFiles, emptyDefaults };
