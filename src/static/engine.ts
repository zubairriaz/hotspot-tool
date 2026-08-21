import { readFile } from "node:fs/promises";
import * as path from "node:path";
import * as core from "@actions/core";
import type { Config } from "../types";
import { supportedFiles, type Language } from "./detect";
import { extractSignature, type FileSignature } from "./extract";
import { computeComplexity } from "./complexity";
import { computeMartinMetrics } from "./martin";

export interface StaticResult {
  complexityByFile: Map<string, number>;
  distanceByFile: Map<string, number>;
}

/**
 * Run the static analysis engine over all tracked files.
 * Returns complexity and Martin's Distance keyed by git-relative file path.
 * Fails gracefully — any unreadable file is skipped with a debug log.
 */
export async function runStaticEngine(
  trackedFiles: Set<string>,
  config: Config,
  cwd: string,
): Promise<StaticResult> {
  const langMap = supportedFiles(trackedFiles, config.languages);
  if (langMap.size === 0) {
    core.info("Static engine: no supported source files found — skipping.");
    return { complexityByFile: new Map(), distanceByFile: new Map() };
  }
  core.info(`Static engine: reading ${langMap.size} source file(s).`);

  const signatures = new Map<string, { sig: FileSignature; lang: Language }>();
  const complexityByFile = new Map<string, number>();

  await Promise.all(
    Array.from(langMap.entries()).map(async ([file, lang]) => {
      try {
        const source = await readFile(path.join(cwd, file), "utf-8");
        signatures.set(file, { sig: extractSignature(source, lang), lang });
        complexityByFile.set(file, computeComplexity(source, lang));
      } catch (err) {
        core.debug(`Static engine: skipping ${file} — ${(err as Error).message}`);
      }
    }),
  );

  if (signatures.size === 0) {
    core.warning(
      `Static engine: failed to read all ${langMap.size} source file(s) — falling back to behavioral-only mode. Check file permissions in GITHUB_WORKSPACE.`,
    );
    return { complexityByFile: new Map(), distanceByFile: new Map() };
  }

  const martinMap = computeMartinMetrics(signatures, trackedFiles, config.moduleDefinition);
  const distanceByFile = new Map<string, number>();
  for (const [file, m] of martinMap) distanceByFile.set(file, m.distance);

  core.info(
    `Static engine: complexity for ${complexityByFile.size} file(s), Martin's Distance for ${distanceByFile.size} file(s).`,
  );
  return { complexityByFile, distanceByFile };
}
