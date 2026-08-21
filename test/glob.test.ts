import { test } from "node:test";
import assert from "node:assert/strict";
import { isExcluded } from "../src/utils/glob";

// ── single star (*) — matches within one segment ────────────────────────────

test("* matches any filename in the root", () => {
  assert.ok(isExcluded("foo.ts", ["*.ts"]));
  assert.ok(isExcluded("bar.js", ["*.js"]));
});

test("* does not cross directory boundaries", () => {
  assert.ok(!isExcluded("src/foo.ts", ["*.ts"]));
});

test("* with prefix matches only files in that prefix segment", () => {
  assert.ok(isExcluded("foo.generated.ts", ["*.generated.ts"]));
  assert.ok(!isExcluded("src/foo.generated.ts", ["*.generated.ts"]));
});

// ── double star (**) — matches across segments ───────────────────────────────

test("** matches files at any depth", () => {
  assert.ok(isExcluded("dist/index.js", ["dist/**"]));
  assert.ok(isExcluded("dist/sub/index.js", ["dist/**"]));
  assert.ok(isExcluded("dist/a/b/c/d.ts", ["dist/**"]));
});

test("** does not match outside its prefix", () => {
  assert.ok(!isExcluded("src/dist/foo.ts", ["dist/**"]));
});

test("**/* matches all files at any depth", () => {
  assert.ok(isExcluded("src/foo.ts", ["**/*.ts"]));
  assert.ok(isExcluded("foo.ts", ["**/*.ts"]));
  assert.ok(isExcluded("a/b/c/foo.ts", ["**/*.ts"]));
});

test("**/*.generated.ts matches generated files at any depth", () => {
  assert.ok(isExcluded("src/api/schema.generated.ts", ["**/*.generated.ts"]));
  assert.ok(isExcluded("schema.generated.ts", ["**/*.generated.ts"]));
  assert.ok(!isExcluded("src/api/schema.ts", ["**/*.generated.ts"]));
});

test("vendor/** matches everything under vendor", () => {
  assert.ok(isExcluded("vendor/lodash/index.js", ["vendor/**"]));
  assert.ok(isExcluded("vendor/react/dist/react.js", ["vendor/**"]));
  assert.ok(!isExcluded("src/vendor-utils.ts", ["vendor/**"]));
});

// ── question mark (?) ────────────────────────────────────────────────────────

test("? matches exactly one non-slash character", () => {
  assert.ok(isExcluded("v1.ts", ["v?.ts"]));
  assert.ok(!isExcluded("v10.ts", ["v?.ts"]));
  assert.ok(!isExcluded("src/v1.ts", ["v?.ts"]));
});

// ── multiple patterns ────────────────────────────────────────────────────────

test("multiple patterns: file excluded if it matches any", () => {
  const patterns = ["dist/**", "vendor/**", "**/*.generated.ts"];
  assert.ok(isExcluded("dist/bundle.js", patterns));
  assert.ok(isExcluded("vendor/lib/index.js", patterns));
  assert.ok(isExcluded("src/types.generated.ts", patterns));
  assert.ok(!isExcluded("src/app.ts", patterns));
});

test("empty patterns list never excludes anything", () => {
  assert.ok(!isExcluded("dist/bundle.js", []));
  assert.ok(!isExcluded("vendor/lib.js", []));
});

// ── real-world patterns ──────────────────────────────────────────────────────

test("node_modules/** excludes nested packages", () => {
  assert.ok(isExcluded("node_modules/lodash/index.js", ["node_modules/**"]));
  assert.ok(isExcluded("node_modules/@types/node/index.d.ts", ["node_modules/**"]));
  assert.ok(!isExcluded("src/node-utils.ts", ["node_modules/**"]));
});

test("**/__tests__/** excludes test directories anywhere", () => {
  assert.ok(isExcluded("src/__tests__/foo.test.ts", ["**/__tests__/**"]));
  assert.ok(isExcluded("__tests__/bar.test.ts", ["**/__tests__/**"]));
});

test("dot-escaped in pattern (e.g. *.d.ts)", () => {
  assert.ok(isExcluded("index.d.ts", ["*.d.ts"]));
  assert.ok(!isExcluded("indexXdXts", ["*.d.ts"])); // dot must be literal
});
