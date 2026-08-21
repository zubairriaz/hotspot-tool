import type { Language } from "./detect";

/**
 * Approximate cyclomatic complexity: 1 + number of independent decision points.
 * Strips strings and comments first to avoid counting keywords inside literals.
 */
export function computeComplexity(source: string, lang: Language): number {
  const stripped = stripStringsAndComments(source, lang);
  return 1 + countBranches(stripped, lang);
}

function countBranches(src: string, lang: Language): number {
  const patterns: RegExp[] = [];

  switch (lang) {
    case "typescript":
    case "javascript":
      patterns.push(
        /\bif\s*\(/g,
        /\belse\s+if\s*\(/g,
        /\bwhile\s*\(/g,
        /\bfor\s*\(/g,
        /\bcase\s+[^:]+:/g,
        /\bcatch\s*\(/g,
        /&&/g,
        /\|\|/g,
        /\?\?/g,
        /\?(?![.?])/g, // ternary — exclude ?. and ??
      );
      break;
    case "python":
      patterns.push(
        /\bif\b/g,
        /\belif\b/g,
        /\bwhile\b/g,
        /\bfor\b/g,
        /\bexcept\b/g,
        /\band\b/g,
        /\bor\b/g,
      );
      break;
    case "go":
      patterns.push(
        /\bif\b/g,
        /\bfor\b/g,
        /\bcase\b/g,
        /&&/g,
        /\|\|/g,
      );
      break;
    case "java":
      patterns.push(
        /\bif\s*\(/g,
        /\belse\s+if\s*\(/g,
        /\bwhile\s*\(/g,
        /\bfor\s*\(/g,
        /\bdo\b/g,
        /\bcase\s+/g,
        /\bcatch\s*\(/g,
        /&&/g,
        /\|\|/g,
        /\?(?![.?])/g,
      );
      break;
  }

  return patterns.reduce((sum, re) => sum + (src.match(re)?.length ?? 0), 0);
}

function stripStringsAndComments(src: string, lang: Language): string {
  if (lang === "python") {
    src = src.replace(/"""[\s\S]*?"""/g, '""');
    src = src.replace(/'''[\s\S]*?'''/g, "''");
    src = src.replace(/#[^\n]*/g, "");
  } else {
    src = src.replace(/\/\*[\s\S]*?\*\//g, "");
    src = src.replace(/\/\/[^\n]*/g, "");
  }
  // Remove string literals (simplified — does not handle all escape sequences)
  src = src.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  src = src.replace(/'(?:[^'\\]|\\.)*'/g, "''");
  if (lang === "typescript" || lang === "javascript") {
    src = src.replace(/`(?:[^`\\]|\\.)*`/g, "``");
  }
  return src;
}
