const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { createServer } = require("../server");
test("local preview serves the scenario app and rejects private files and removed APIs", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(base);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert(html.includes("scenario.js"));
    assert(html.includes("projection.js"));
    for (const file of ["equity-schedule.js", "grant-timeline.js"]) {
      assert(html.includes(file));
      assert.equal((await fetch(base + "/" + file)).status, 200);
    }
    // Every script the page references must be served, or the app fails to boot.
    for (const [, src] of html.matchAll(/<script src="([^"]+)"/g)) {
      if (src === "development-defaults.js") continue; // personal, gitignored
      assert.equal(
        (await fetch(base + "/" + src)).status,
        200,
        `${src} is not served`,
      );
    }
    assert(html.indexOf('src="util.js"') < html.indexOf('src="tax-engine.js"'));
    assert(!html.includes("market-ui"));
    for (const path of [
      "/.env",
      "/package.json",
      "/test/run.js",
      "/api/market/status",
    ])
      assert.equal(
        (await fetch(base + path, { headers: { "x-model-request": "1" } }))
          .status,
        404,
      );
    assert.equal((await fetch(base + "/api/preview")).status, 403);
    assert.equal(
      (
        await fetch(base + "/api/preview", {
          headers: { "x-model-request": "1", Origin: "https://example.com" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await (
          await fetch(base + "/api/preview", {
            headers: { "x-model-request": "1" },
          })
        ).json()
      ).app,
      "net-worth-model",
    );
    assert.equal(
      (await fetch(base + "/scenario.js", { method: "POST" })).status,
      405,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
