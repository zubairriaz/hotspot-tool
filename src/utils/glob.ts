// Built-in exclude patterns applied by default to avoid analyzing build artifacts,
// vendored deps, and minified files. Override with `no-default-excludes: true`.
export const DEFAULT_EXCLUDES: string[] = [
  "dist/**",
  "build/**",
  "out/**",
  ".next/**",
  "vendor/**",
  "node_modules/**",
  "coverage/**",
  "**/*.min.js",
  "**/*.min.css",
  "**/*.bundle.js",
];

// Minimal glob matcher — handles the patterns teams actually use for excludes:
//   *        matches any chars except /
//   **       matches any chars including /
//   **/      matches zero or more path segments (prefix)
//   ?        matches single non-slash char
//
// No dependency on micromatch or minimatch — intentionally small.

function globToRegex(pattern: string): RegExp {
  const p = pattern.replace(/\\/g, "/");
  let r = "^";
  let i = 0;
  while (i < p.length) {
    const c = p[i]!;
    if (c === "*" && p[i + 1] === "*") {
      if (p[i + 2] === "/") {
        r += "(?:.+/)?"; // **/ — zero or more path segments with trailing slash
        i += 3;
      } else {
        r += ".*"; // ** at end — anything
        i += 2;
      }
    } else if (c === "*") {
      r += "[^/]*";
      i++;
    } else if (c === "?") {
      r += "[^/]";
      i++;
    } else if (/[.+^${}()|[\]\\]/.test(c)) {
      r += `\\${c}`;
      i++;
    } else {
      r += c;
      i++;
    }
  }
  r += "$";
  return new RegExp(r);
}

/** True if filePath (forward-slash normalised) matches any of the glob patterns. */
export function isExcluded(filePath: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  const normalized = filePath.replace(/\\/g, "/");
  return patterns.some((p) => globToRegex(p).test(normalized));
}
