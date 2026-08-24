import * as path from "node:path";
import type { ModuleDefinition } from "../types";
import type { Language } from "./detect";
import type { FileSignature } from "./extract";

export interface MartinMetrics {
  abstractness: number; // A = abstract / (abstract + concrete), 0-1
  instability: number;  // I = Ce / (Ce + Ca), 0-1
  distance: number;     // D = |A + I - 1|, 0-1
}

/** Group key for a file given the module-definition setting. */
function moduleKey(filePath: string, def: ModuleDefinition): string {
  if (def === "file") return filePath;
  if (def === "directory") return path.posix.dirname(filePath) || ".";
  return "__workspace__";
}

/**
 * Resolve a raw import specifier to the path of a tracked project file,
 * or null for external packages / unresolvable references.
 */
function resolveImport(
  spec: string,
  fromFile: string,
  trackedSet: Set<string>,
  lang: Language,
): string | null {
  if (lang === "typescript" || lang === "javascript") {
    if (!spec.startsWith(".")) return null;
    const dir = path.posix.dirname(fromFile);
    const base = path.posix.normalize(path.posix.join(dir, spec));
    const candidates = [
      base,
      ...([".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"].map((e) => base + e)),
      ...([".ts", ".tsx", ".js", ".jsx"].map((e) => `${base}/index${e}`)),
    ];
    for (const c of candidates) if (trackedSet.has(c)) return c;
    return null;
  }

  if (lang === "python") {
    if (!spec.startsWith(".")) return null;
    const dots = spec.match(/^\.+/)?.[0].length ?? 0;
    const rest = spec.slice(dots).replace(/\./g, "/");
    let dir = path.posix.dirname(fromFile);
    for (let i = 1; i < dots; i++) dir = path.posix.dirname(dir);
    const base = rest ? path.posix.join(dir, rest) : dir;
    const candidates = [`${base}.py`, `${base}/__init__.py`];
    for (const c of candidates) if (trackedSet.has(c)) return c;
    return null;
  }

  if (lang === "php") {
    if (!spec.startsWith(".")) return null;
    const dir = path.posix.dirname(fromFile);
    const base = path.posix.normalize(path.posix.join(dir, spec));
    for (const c of [base, `${base}.php`]) if (trackedSet.has(c)) return c;
    return null;
  }

  if (lang === "ruby") {
    if (!spec.startsWith(".")) return null;
    const dir = path.posix.dirname(fromFile);
    const base = path.posix.normalize(path.posix.join(dir, spec));
    for (const c of [`${base}.rb`, `${base}/index.rb`, base]) if (trackedSet.has(c)) return c;
    return null;
  }

  if (lang === "cpp") {
    // Only quoted includes (#include "...") are relative; angle-bracket ones are system headers
    if (spec.startsWith("/")) return null;
    const dir = path.posix.dirname(fromFile);
    const candidate = path.posix.normalize(path.posix.join(dir, spec));
    if (trackedSet.has(candidate)) return candidate;
    return null;
  }

  if (lang === "rust") {
    // use crate::module::sub → src/module/sub.rs or src/module/sub/mod.rs
    if (!spec.startsWith("crate::")) return null;
    const rel = spec.slice("crate::".length).replace(/::/g, "/");
    // Detect crate src root: prefer "src/" if any tracked .rs file lives there
    const roots = trackedSet.has(`src/lib.rs`) || trackedSet.has(`src/main.rs`) ? ["src"] : ["src", ""];
    for (const root of roots) {
      const base = root ? `${root}/${rel}` : rel;
      for (const c of [`${base}.rs`, `${base}/mod.rs`]) if (trackedSet.has(c)) return c;
    }
    return null;
  }

  // Go, Java, Kotlin, Scala use absolute package/module paths that require manifests to resolve.
  return null;
}

export function computeMartinMetrics(
  signatures: Map<string, { sig: FileSignature; lang: Language }>,
  trackedSet: Set<string>,
  moduleDefinition: ModuleDefinition,
): Map<string, MartinMetrics> {
  // Map each file to its module key
  const fileToMod = new Map<string, string>();
  for (const [file] of signatures) {
    fileToMod.set(file, moduleKey(file, moduleDefinition));
  }

  // Aggregate abstractness counts per module
  const modAbstract = new Map<string, number>();
  const modConcrete = new Map<string, number>();
  for (const [file, { sig }] of signatures) {
    const mod = fileToMod.get(file)!;
    modAbstract.set(mod, (modAbstract.get(mod) ?? 0) + sig.abstractCount);
    modConcrete.set(mod, (modConcrete.get(mod) ?? 0) + sig.concreteCount);
  }

  // Build inter-module dependency edges
  const efferent = new Map<string, Set<string>>(); // modules this module imports
  const afferent  = new Map<string, Set<string>>(); // modules that import this module
  for (const mod of modAbstract.keys()) {
    efferent.set(mod, new Set());
    afferent.set(mod, new Set());
  }

  for (const [file, { sig, lang }] of signatures) {
    const fromMod = fileToMod.get(file)!;
    for (const spec of sig.rawImports) {
      const resolved = resolveImport(spec, file, trackedSet, lang);
      if (!resolved) continue;
      const toMod = fileToMod.get(resolved);
      if (!toMod || toMod === fromMod) continue;
      efferent.get(fromMod)!.add(toMod);
      afferent.get(toMod)!.add(fromMod);
    }
  }

  // Compute A, I, D per module
  const modMetrics = new Map<string, MartinMetrics>();
  for (const mod of modAbstract.keys()) {
    const abs = modAbstract.get(mod) ?? 0;
    const con = modConcrete.get(mod) ?? 0;
    const A = abs + con > 0 ? abs / (abs + con) : 0;

    const Ce = efferent.get(mod)!.size;
    const Ca = afferent.get(mod)!.size;
    const I = Ce + Ca > 0 ? Ce / (Ce + Ca) : 0;

    modMetrics.set(mod, { abstractness: A, instability: I, distance: Math.abs(A + I - 1) });
  }

  // Project module metrics back onto individual files
  const result = new Map<string, MartinMetrics>();
  for (const [file] of signatures) {
    result.set(file, modMetrics.get(fileToMod.get(file)!)!);
  }
  return result;
}
