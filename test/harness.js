/**
 * Tiny zero-dependency test harness.
 *
 * Test files call test()/describe() to register cases; run() executes them,
 * prints a summary, and sets process.exitCode on failure. No npm install, no
 * framework - just `node test/run.js`.
 */

const tests = [];
let currentSuite = '';

function describe(name, fn) {
  const prev = currentSuite;
  currentSuite = prev ? `${prev} › ${name}` : name;
  fn();
  currentSuite = prev;
}

function test(name, fn) {
  tests.push({ name: currentSuite ? `${currentSuite} › ${name}` : name, fn });
}

class AssertionError extends Error {}

function assert(cond, msg) {
  if (!cond) throw new AssertionError(msg || 'assertion failed');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new AssertionError(`${msg || 'assertEqual'}: expected ${expected}, got ${actual}`);
  }
}

/** Float comparison with an absolute tolerance (default 1e-6). */
function assertClose(actual, expected, tol = 1e-6, msg) {
  if (!Number.isFinite(Number(actual)) || !Number.isFinite(Number(expected)) || Math.abs(actual - expected) > tol) {
    throw new AssertionError(`${msg || 'assertClose'}: expected ~${expected} (±${tol}), got ${actual}`);
  }
}

function run() {
  let passed = 0;
  const failures = [];

  for (const t of tests) {
    try {
      t.fn();
      passed++;
      console.log(`  \x1b[32m✓\x1b[0m ${t.name}`);
    } catch (err) {
      failures.push({ name: t.name, err });
      console.log(`  \x1b[31m✗\x1b[0m ${t.name}`);
    }
  }

  console.log('');
  if (failures.length) {
    console.log(`\x1b[31m${failures.length} failing\x1b[0m, \x1b[32m${passed} passing\x1b[0m\n`);
    for (const f of failures) {
      console.log(`\x1b[31m✗ ${f.name}\x1b[0m`);
      console.log(`  ${f.err.message}`);
      if (!(f.err instanceof AssertionError)) console.log(f.err.stack);
      console.log('');
    }
    process.exitCode = 1;
  } else {
    console.log(`\x1b[32m${passed} passing\x1b[0m\n`);
  }
}

module.exports = { describe, test, assert, assertEqual, assertClose, run };
