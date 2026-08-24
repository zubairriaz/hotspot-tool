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
    case "rust":
      patterns.push(
        /\bif\b/g,
        /\belse\s+if\b/g,
        /\bwhile\b/g,
        /\bfor\b/g,
        /\bloop\b/g,
        /\bmatch\b/g,
        /=>/g,    // each match arm
        /&&/g,
        /\|\|/g,
      );
      break;
    case "csharp":
      patterns.push(
        /\bif\s*\(/g,
        /\belse\s+if\s*\(/g,
        /\bwhile\s*\(/g,
        /\bfor\s*\(/g,
        /\bforeach\s*\(/g,
        /\bdo\b/g,
        /\bcase\s+/g,
        /\bcatch\s*\(/g,
        /&&/g,
        /\|\|/g,
        /\?(?![.?])/g,
      );
      break;
    case "kotlin":
      patterns.push(
        /\bif\s*\(/g,
        /\belse\s+if\s*\(/g,
        /\bwhile\s*\(/g,
        /\bfor\s*\(/g,
        /\bwhen\b/g,   // when-expression branches
        /\bcatch\s*\(/g,
        /&&/g,
        /\|\|/g,
        /\?:/g,        // Elvis operator
        /\?(?![.:])/g, // safe-call ternary
      );
      break;
    case "swift":
      patterns.push(
        /\bif\b/g,
        /\belse\s+if\b/g,
        /\bwhile\b/g,
        /\bfor\b/g,
        /\brepeat\b/g,
        /\bcase\b/g,
        /\bcatch\b/g,
        /&&/g,
        /\|\|/g,
        /\?\?/g,       // nil-coalescing
        /\?(?![?])/g,  // optional chaining / ternary
      );
      break;
    case "php":
      patterns.push(
        /\bif\s*\(/g,
        /\belseif\s*\(/g,
        /\bwhile\s*\(/g,
        /\bfor\s*\(/g,
        /\bforeach\s*\(/g,
        /\bcase\s+/g,
        /\bcatch\s*\(/g,
        /&&/g,
        /\|\|/g,
        /\?\?/g,       // null-coalescing
        /\?(?![?])/g,  // ternary
      );
      break;
    case "ruby":
      patterns.push(
        /\bif\b/g,
        /\belif\b/g,
        /\bunless\b/g,
        /\bwhile\b/g,
        /\bfor\b/g,
        /\buntil\b/g,
        /\bcase\b/g,
        /\bwhen\b/g,
        /\brescue\b/g,
        /&&/g,
        /\|\|/g,
        /\band\b/g,
        /\bor\b/g,
      );
      break;
    case "cpp":
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
        /\?(?![?])/g,  // ternary
      );
      break;
    case "scala":
      patterns.push(
        /\bif\b/g,
        /\belse\s+if\b/g,
        /\bwhile\b/g,
        /\bfor\b/g,
        /\bmatch\b/g,
        /\bcase\b/g,
        /\bcatch\b/g,
        /&&/g,
        /\|\|/g,
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
  } else if (lang === "rust") {
    src = src.replace(/\/\*[\s\S]*?\*\//g, "");
    src = src.replace(/\/\/[^\n]*/g, "");
    src = src.replace(/r#"[\s\S]*?"#/g, '""');
  } else if (lang === "ruby") {
    src = src.replace(/=begin[\s\S]*?=end/g, "");
    src = src.replace(/#[^\n]*/g, "");
  } else if (lang === "php") {
    src = src.replace(/\/\*[\s\S]*?\*\//g, "");
    src = src.replace(/\/\/[^\n]*/g, "");
    src = src.replace(/#[^\n]*/g, ""); // PHP also allows # comments
  } else {
    // C-style block + line comments (JS/TS/Go/Java/Kotlin/Swift/C++/Scala/C#)
    src = src.replace(/\/\*[\s\S]*?\*\//g, "");
    src = src.replace(/\/\/[^\n]*/g, "");
  }
  src = src.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  src = src.replace(/'(?:[^'\\]|\\.)*'/g, "''");
  if (lang === "typescript" || lang === "javascript") {
    src = src.replace(/`(?:[^`\\]|\\.)*`/g, "``");
  }
  if (lang === "kotlin") {
    src = src.replace(/"""[\s\S]*?"""/g, '""'); // multiline strings
  }
  if (lang === "scala") {
    src = src.replace(/"""[\s\S]*?"""/g, '""'); // triple-quoted strings
  }
  if (lang === "swift") {
    src = src.replace(/"""[\s\S]*?"""/g, '""'); // multiline strings
  }
  return src;
}
