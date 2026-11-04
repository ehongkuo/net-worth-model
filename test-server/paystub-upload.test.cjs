const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

function pdf(text) {
  const stream = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let data = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(data));
    data += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(data);
  data += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((o) => String(o).padStart(10, "0") + " 00000 n \n")
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Uint8Array.from(Buffer.from(data));
}

async function upload(bytes, parserError) {
  const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  lib.GlobalWorkerOptions.workerSrc = pathToFileURL(
    path.resolve(
      __dirname,
      "../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    ),
  ).href;
  let destroyed = 0,
    reviewed = 0,
    extracted;
  const status = { textContent: "" };
  const api = {
    GlobalWorkerOptions: {},
    getDocument(options) {
      const task = lib.getDocument(options),
        destroy = task.destroy.bind(task);
      task.destroy = async () => {
        destroyed++;
        await destroy();
      };
      return task;
    },
  };
  const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
  const handler = source
    .slice(
      source.indexOf("async function readPaystubs("),
      source.indexOf("function reviewUploads()"),
    )
    .replace('await import("./vendor/pdf.mjs")', "pdfjsTest");
  const context = vm.createContext({
    pdfjsTest: api,
    Uint8Array,
    crypto: require("node:crypto").webcrypto,
    $: () => status,
    drafts: [],
    scenario: { uploads: { records: [] } },
    PaystubParser: {
      parse(pages) {
        extracted = pages;
        if (parserError) throw new Error(parserError);
        return { current: { salary: 1000 } };
      },
    },
    reviewUploads() {
      reviewed++;
    },
    showReview() {},
  });
  vm.runInContext(handler, context);
  for (const data of bytes)
    await context.readPaystubs({
      target: {
        files: [
          {
            size: data.length,
            arrayBuffer: async () => Uint8Array.from(data).buffer,
          },
        ],
      },
    });
  return {
    destroyed,
    reviewed,
    extracted,
    status: status.textContent,
    drafts: context.drafts,
  };
}
test("real PDF upload reaches review and releases resources, including a second upload", async () => {
  const r = await upload([
    pdf("Regular Salary 1000.00"),
    pdf("Regular Salary 2000.00"),
  ]);
  assert.equal(r.reviewed, 2);
  assert.equal(r.destroyed, 2);
  assert.match(r.extracted[0].text, /2000.00/);
  assert.equal(r.drafts.length, 1);
});
test("PDF cleanup preserves extraction errors and releases failed loading tasks", async () => {
  const r = await upload([pdf("Salary")], "Cannot reconcile this paycheck");
  assert.equal(r.status, "Cannot reconcile this paycheck");
  assert.equal(r.destroyed, 1);
  const invalid = await upload([Uint8Array.from([1, 2, 3])]);
  assert.equal(invalid.reviewed, 0);
  assert.equal(invalid.destroyed, 1);
});
