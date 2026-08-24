import { test } from "node:test";
import assert from "node:assert/strict";
import { isExcluded, DEFAULT_EXCLUDES } from "../src/utils/glob";

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

// ── DEFAULT_EXCLUDES — built-in artifact/vendor patterns ─────────────────────

test("DEFAULT_EXCLUDES blocks dist/index.js", () => {
  assert.ok(isExcluded("dist/index.js", DEFAULT_EXCLUDES));
});

test("DEFAULT_EXCLUDES blocks nested build output", () => {
  assert.ok(isExcluded("build/static/main.chunk.js", DEFAULT_EXCLUDES));
  assert.ok(isExcluded("out/server/pages/index.js", DEFAULT_EXCLUDES));
  assert.ok(isExcluded(".next/server/pages/_app.js", DEFAULT_EXCLUDES));
});

test("DEFAULT_EXCLUDES blocks vendor and node_modules", () => {
  assert.ok(isExcluded("vendor/github.com/some/dep/file.go", DEFAULT_EXCLUDES));
  assert.ok(isExcluded("node_modules/lodash/index.js", DEFAULT_EXCLUDES));
});

test("DEFAULT_EXCLUDES blocks minified and bundled files", () => {
  assert.ok(isExcluded("public/app.min.js", DEFAULT_EXCLUDES));
  assert.ok(isExcluded("static/vendor.bundle.js", DEFAULT_EXCLUDES));
  assert.ok(isExcluded("assets/styles.min.css", DEFAULT_EXCLUDES));
});

test("DEFAULT_EXCLUDES blocks coverage output", () => {
  assert.ok(isExcluded("coverage/lcov-report/index.html", DEFAULT_EXCLUDES));
});

test("DEFAULT_EXCLUDES does NOT block normal source files", () => {
  assert.ok(!isExcluded("src/core.ts", DEFAULT_EXCLUDES));
  assert.ok(!isExcluded("lib/utils.go", DEFAULT_EXCLUDES));
  assert.ok(!isExcluded("app/models/user.py", DEFAULT_EXCLUDES));
  assert.ok(!isExcluded("distribution/strategy.ts", DEFAULT_EXCLUDES)); // "dist" prefix only as segment
});
