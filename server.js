"use strict";
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const files = new Set([
  "index.html",
  "style.css",
  "app.js",
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
  "node_modules/pdfjs-dist/build/pdf.mjs",
  "node_modules/pdfjs-dist/build/pdf.worker.mjs",
]);
function createServer({ root = __dirname } = {}) {
  return http.createServer(async (req, res) => {
    const send = (code, value) => {
      res.writeHead(code, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(JSON.stringify(value));
    };
    try {
      const host = req.headers.host || "";
      if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host))
        return send(403, { error: "Local access only." });
      const url = new URL(req.url, `http://${host}`);
      if (url.pathname.startsWith("/api/")) {
        if (
          req.headers["x-model-request"] !== "1" ||
          (req.headers.origin && req.headers.origin !== `http://${host}`)
        )
          return send(403, { error: "Same-origin requests only." });
        if (url.pathname === "/api/preview" && req.method === "GET")
          return send(200, {
            app: "net-worth-model",
            root: path.resolve(root),
          });
        return send(404, { error: "Not found." });
      }
      if (req.method !== "GET" && req.method !== "HEAD")
        return send(405, { error: "Method not allowed." });
      const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      if (!files.has(file)) return send(404, { error: "Not found." });
      const data = await fs.readFile(path.join(root, file)).catch((error) => {
        if (file === "development-defaults.js" && error.code === "ENOENT")
          return Buffer.from("// No local development preset.\n");
        throw error;
      });
      const mime = /\.m?js$/.test(file)
        ? "text/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : "text/html";
      res.writeHead(200, {
        "Content-Type": `${mime}; charset=utf-8`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch (error) {
      send(error.status || 502, { error: error.message || "Request failed." });
    }
  });
}
if (require.main === module) {
  const port = Number(process.env.PORT || process.argv[2] || 5190),
    url = `http://127.0.0.1:${port}`;
  const server = createServer();
  server.on("error", async (error) => {
    if (error.code === "EADDRINUSE") {
      try {
        const response = await fetch(`${url}/api/preview`, {
          headers: { "x-model-request": "1" },
          signal: AbortSignal.timeout(2000),
        });
        const preview = await response.json();
        if (
          preview.app === "net-worth-model" &&
          preview.root === path.resolve(__dirname)
        ) {
          console.log(`Net worth model already running: ${url}`);
          return;
        }
      } catch {}
      console.error(
        `Port ${port} belongs to another server. Stop that server before starting this checkout.`,
      );
    } else console.error(error.message);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () =>
    console.log(`Net worth model: ${url}`),
  );
}
module.exports = { createServer };
