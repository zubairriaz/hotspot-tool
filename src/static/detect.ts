import * as path from "node:path";
import type { Config } from "../types";

export type Language =
  | "typescript"
  | "javascript"
  | "python"
  | "go"
  | "java"
  | "rust"
  | "csharp"
  | "kotlin"
  | "swift"
  | "php"
  | "ruby"
  | "cpp"
  | "scala";

const EXT_MAP: Record<string, Language> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".java": "java",
  ".rs": "rust",
  ".cs": "csharp",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".swift": "swift",
  ".php": "php",
  ".phtml": "php",
  ".rb": "ruby",
  ".c": "cpp",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".h": "cpp",
  ".hpp": "cpp",
  ".hxx": "cpp",
  ".scala": "scala",
  ".sc": "scala",
};

export function detectLanguage(filePath: string): Language | null {
  const ext = path.extname(filePath).toLowerCase();
  return EXT_MAP[ext] ?? null;
}

/** Filter tracked files to those with a supported language, respecting config.languages. */
export function supportedFiles(files: Iterable<string>, languages: Config["languages"]): Map<string, Language> {
  const result = new Map<string, Language>();
  for (const f of files) {
    const lang = detectLanguage(f);
    if (!lang) continue;
    if (languages !== "auto" && !languages.includes(lang)) continue;
    result.set(f, lang);
  }
  return result;
}
