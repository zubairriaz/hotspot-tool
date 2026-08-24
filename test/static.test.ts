import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSignature } from "../src/static/extract";
import { computeComplexity } from "../src/static/complexity";
import { computeMartinMetrics } from "../src/static/martin";

// ── extractSignature ────────────────────────────────────────────────────────

test("TS: detects interfaces, abstract classes, type aliases, and concrete classes", () => {
  const src = `
    interface Foo {}
    abstract class Bar {}
    type Baz = string;
    class Qux {}
    class Quux extends Bar {}
  `;
  const sig = extractSignature(src, "typescript");
  assert.equal(sig.abstractCount, 3, "interface + abstract class + type alias");
  assert.equal(sig.concreteCount, 2, "Qux + Quux");
});

test("TS: extracts static and dynamic imports", () => {
  const src = `
    import { foo } from './foo';
    import type { Bar } from '../bar';
    import './side-effect';
    const x = import('./lazy');
    const y = require('./cjs');
    export { baz } from './baz';
  `;
  const sig = extractSignature(src, "typescript");
  assert.ok(sig.rawImports.includes("./foo"));
  assert.ok(sig.rawImports.includes("../bar"));
  assert.ok(sig.rawImports.includes("./side-effect"));
  assert.ok(sig.rawImports.includes("./lazy"));
  assert.ok(sig.rawImports.includes("./cjs"));
  assert.ok(sig.rawImports.includes("./baz"));
});

test("Python: detects ABC and Protocol subclasses as abstract", () => {
  const src = `
    class Concrete:
        pass
    class MyABC(ABC):
        pass
    class MyProtocol(Protocol):
        pass
  `;
  const sig = extractSignature(src, "python");
  assert.equal(sig.abstractCount, 2);
  assert.equal(sig.concreteCount, 1);
});

test("Go: detects interface vs struct", () => {
  const src = `
    type Reader interface { Read() }
    type Writer interface { Write() }
    type Buffer struct { data []byte }
  `;
  const sig = extractSignature(src, "go");
  assert.equal(sig.abstractCount, 2);
  assert.equal(sig.concreteCount, 1);
});

test("Java: detects interface and abstract class", () => {
  const src = `
    public interface Runnable { void run(); }
    public abstract class Base { abstract void doIt(); }
    public class Worker extends Base { void doIt() {} }
  `;
  const sig = extractSignature(src, "java");
  assert.equal(sig.abstractCount, 2);
  assert.equal(sig.concreteCount, 1);
});

// ── computeComplexity ───────────────────────────────────────────────────────

test("complexity: trivial function scores 1", () => {
  const src = `function greet(name: string) { return "hello " + name; }`;
  assert.equal(computeComplexity(src, "typescript"), 1);
});

test("complexity: counts if/else-if/while/for/catch", () => {
  const src = `
    function fn(x: number) {
      if (x > 0) {
        for (let i = 0; i < x; i++) {}
      } else if (x < 0) {
        while (x < 0) { x++; }
      }
      try {} catch (e) {}
      return x && x || x ?? 0;
    }
  `;
  // if + else if + for + while + catch + && + || + ??  = 8 branches + 1 base
  const c = computeComplexity(src, "typescript");
  assert.ok(c >= 8, `expected ≥ 8, got ${c}`);
});

test("complexity: keywords inside strings are not counted", () => {
  const src = `const msg = "if you while for catch this";`;
  assert.equal(computeComplexity(src, "typescript"), 1);
});

test("complexity: Python counts if/elif/for/except/and/or", () => {
  const src = `
def fn(x):
    if x > 0:
        for i in range(x):
            pass
    elif x < 0:
        pass
    try:
        pass
    except ValueError:
        pass
    return x and x or x
  `;
  const c = computeComplexity(src, "python");
  // if + elif + for + except + and + or = 6 + 1 base
  assert.ok(c >= 6, `expected ≥ 6, got ${c}`);
});

// ── computeMartinMetrics ────────────────────────────────────────────────────

test("Martin: module with no coupling in either direction is omitted, not scored", () => {
  // Ce + Ca = 0 makes I = Ce/(Ce+Ca) undefined (0/0). Reporting I=0 here would
  // assert "maximally stable" on no evidence and yield a bogus D = 1.
  const signatures = new Map([
    ["src/worker.ts", {
      sig: { rawImports: [], abstractCount: 0, concreteCount: 3 },
      lang: "typescript" as const,
    }],
  ]);
  const tracked = new Set(["src/worker.ts"]);
  const result = computeMartinMetrics(signatures, tracked, "file");
  assert.equal(result.get("src/worker.ts"), undefined);
  assert.equal(result.size, 0);
});

test("Martin: stable concrete module has D = 1 (genuine zone of pain)", () => {
  // worker is imported by app but imports nothing: Ce=0, Ca=1 → I=0.
  // A=0 (all concrete) → D = |0+0-1| = 1. Coupling is real, so the score stands.
  const signatures = new Map([
    ["src/worker.ts", {
      sig: { rawImports: [], abstractCount: 0, concreteCount: 3 },
      lang: "typescript" as const,
    }],
    ["src/app.ts", {
      sig: { rawImports: ["./worker"], abstractCount: 0, concreteCount: 1 },
      lang: "typescript" as const,
    }],
  ]);
  const tracked = new Set(["src/worker.ts", "src/app.ts"]);
  const result = computeMartinMetrics(signatures, tracked, "file");
  const m = result.get("src/worker.ts")!;
  assert.ok(m !== undefined);
  assert.equal(m.abstractness.toFixed(2), "0.00");
  assert.equal(m.instability.toFixed(2), "0.00");
  assert.equal(m.distance.toFixed(2), "1.00");
});

test("Martin: fully abstract stable module has D = 0 (ideal)", () => {
  // types is imported by app and imports nothing: Ce=0, Ca=1 → I=0.
  // A=1 (all abstract) → D = |1+0-1| = 0.
  const signatures = new Map([
    ["src/types.ts", {
      sig: { rawImports: [], abstractCount: 5, concreteCount: 0 },
      lang: "typescript" as const,
    }],
    ["src/app.ts", {
      sig: { rawImports: ["./types"], abstractCount: 0, concreteCount: 1 },
      lang: "typescript" as const,
    }],
  ]);
  const tracked = new Set(["src/types.ts", "src/app.ts"]);
  const result = computeMartinMetrics(signatures, tracked, "file");
  const m = result.get("src/types.ts")!;
  assert.equal(m.abstractness.toFixed(2), "1.00");
  assert.equal(m.instability.toFixed(2), "0.00");
  assert.equal(m.distance.toFixed(2), "0.00");
});

test("Martin: concrete module that imports others has lower D (more instability balances low abstractness)", () => {
  // A=0 (all concrete), I>0 (imports from other modules) → D = |0 + I - 1| = 1-I, less than 1
  const signatures = new Map([
    ["src/app.ts", {
      sig: { rawImports: ["./utils"], abstractCount: 0, concreteCount: 2 },
      lang: "typescript" as const,
    }],
    ["src/utils.ts", {
      sig: { rawImports: [], abstractCount: 0, concreteCount: 1 },
      lang: "typescript" as const,
    }],
  ]);
  const tracked = new Set(["src/app.ts", "src/utils.ts"]);
  const result = computeMartinMetrics(signatures, tracked, "file");
  const appD = result.get("src/app.ts")!.distance;
  const utilsD = result.get("src/utils.ts")!.distance;
  // app.ts imports utils.ts → Ce=1, Ca=0 → I=1 → D=|0+1-1|=0 (perfectly instable concrete = ideal)
  assert.equal(appD.toFixed(2), "0.00");
  // utils.ts is imported by app.ts → Ca=1, Ce=0 → I=0 → D=|0+0-1|=1 (stable but concrete = pain)
  assert.equal(utilsD.toFixed(2), "1.00");
});

// ── Rust ────────────────────────────────────────────────────────────────────

test("Rust: detects traits as abstract and structs/enums as concrete", () => {
  const src = `
    trait Animal { fn speak(&self); }
    trait Drawable {}
    struct Dog { name: String }
    enum Color { Red, Green, Blue }
  `;
  const sig = extractSignature(src, "rust");
  assert.equal(sig.abstractCount, 2, "two traits");
  assert.equal(sig.concreteCount, 2, "struct + enum");
});

test("Rust: extracts relative use paths", () => {
  const src = `
    use crate::models::User;
    use super::handler::process;
    use self::utils::helper;
    use std::collections::HashMap;
  `;
  const sig = extractSignature(src, "rust");
  assert.ok(sig.rawImports.some((i) => i.startsWith("crate::")));
  assert.ok(sig.rawImports.some((i) => i.startsWith("super::")));
  assert.ok(sig.rawImports.some((i) => i.startsWith("self::")));
  assert.ok(!sig.rawImports.includes("std::collections::HashMap"), "external crate skipped");
});

test("Rust: complexity counts if/while/for/loop/match/arms", () => {
  const src = `
fn classify(x: i32) -> &'static str {
    if x > 0 {
        for _ in 0..x {}
    } else if x < 0 {
        while x < 0 { break; }
    }
    loop { break; }
    match x {
        0 => "zero",
        1..=9 => "small",
        _ => "other",
    }
}
  `;
  const c = computeComplexity(src, "rust");
  // if + else if + for + while + loop + match + 3 arms = 9 + base 1
  assert.ok(c >= 8, `expected ≥ 8, got ${c}`);
});

// ── C# ──────────────────────────────────────────────────────────────────────

test("C#: detects interfaces and abstract classes as abstract", () => {
  const src = `
    public interface IRepository<T> { T Get(int id); }
    public abstract class BaseService { protected abstract void Init(); }
    public class UserService : BaseService { protected override void Init() {} }
    public struct Point { public int X; public int Y; }
    public record Person(string Name, int Age);
    public enum Status { Active, Inactive }
  `;
  const sig = extractSignature(src, "csharp");
  assert.equal(sig.abstractCount, 2, "interface + abstract class");
  assert.equal(sig.concreteCount, 4, "concrete class + struct + record + enum");
});

test("C#: extracts using statements", () => {
  const src = `
using System;
using System.Collections.Generic;
using MyApp.Services;
  `;
  const sig = extractSignature(src, "csharp");
  assert.ok(sig.rawImports.includes("System"));
  assert.ok(sig.rawImports.includes("System.Collections.Generic"));
  assert.ok(sig.rawImports.includes("MyApp.Services"));
});

test("C#: complexity counts if/else-if/foreach/switch-case/catch", () => {
  const src = `
void Process(List<int> items) {
    if (items == null) throw new ArgumentNullException();
    else if (items.Count == 0) return;
    foreach (var item in items) {
        switch (item) {
            case 1: break;
            case 2: break;
            default: break;
        }
    }
    try { } catch (Exception e) { }
    var result = items.Count > 0 ? items[0] : -1;
}
  `;
  const c = computeComplexity(src, "csharp");
  // if + else if + foreach + 2 cases + catch + ternary = 7 + base 1
  assert.ok(c >= 7, `expected ≥ 7, got ${c}`);
});

// ── Martin: directory mode groups files from the same folder ─────────────────

test("Martin: directory mode groups files from the same folder", () => {
  const signatures = new Map([
    ["src/api/handler.ts", {
      sig: { rawImports: ["../utils/logger"], abstractCount: 0, concreteCount: 2 },
      lang: "typescript" as const,
    }],
    ["src/api/router.ts", {
      sig: { rawImports: ["../utils/logger"], abstractCount: 1, concreteCount: 1 },
      lang: "typescript" as const,
    }],
    ["src/utils/logger.ts", {
      sig: { rawImports: [], abstractCount: 0, concreteCount: 1 },
      lang: "typescript" as const,
    }],
  ]);
  const tracked = new Set([...signatures.keys()]);
  const result = computeMartinMetrics(signatures, tracked, "directory");

  // Both api files belong to the same module — they should have identical metrics
  const handler = result.get("src/api/handler.ts")!;
  const router = result.get("src/api/router.ts")!;
  assert.equal(handler.distance.toFixed(4), router.distance.toFixed(4),
    "files in the same directory share module metrics");
});
