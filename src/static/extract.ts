import type { Language } from "./detect";

export interface FileSignature {
  rawImports: string[];  // raw import specifiers found in the file
  abstractCount: number; // interfaces + abstract classes + type aliases
  concreteCount: number; // concrete classes
}

export function extractSignature(source: string, lang: Language): FileSignature {
  switch (lang) {
    case "typescript": return extractTS(source);
    case "javascript": return extractJS(source);
    case "python":     return extractPy(source);
    case "go":         return extractGo(source);
    case "java":       return extractJava(source);
    case "rust":       return extractRust(source);
    case "csharp":     return extractCS(source);
    case "kotlin":     return extractKotlin(source);
    case "swift":      return extractSwift(source);
    case "php":        return extractPhp(source);
    case "ruby":       return extractRuby(source);
    case "cpp":        return extractCpp(source);
    case "scala":      return extractScala(source);
  }
}

function extractTS(src: string): FileSignature {
  const rawImports: string[] = [];
  // Static imports: from 'path'
  for (const m of src.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g))
    rawImports.push(m[1]!);
  // Side-effect imports: import 'path'
  for (const m of src.matchAll(/\bimport\s+['"]([^'"]+)['"]/g))
    rawImports.push(m[1]!);
  // Dynamic: import('path') and require('path')
  for (const m of src.matchAll(/(?:\bimport\s*\(|require\s*\()['"]([^'"]+)['"]/g))
    rawImports.push(m[1]!);

  const interfaceCount    = (src.match(/\binterface\s+\w/g) ?? []).length;
  const abstractClsCount  = (src.match(/\babstract\s+class\s+\w/g) ?? []).length;
  const typeAliasCount    = (src.match(/\btype\s+\w+\s*(?:<[^>]*>)?\s*=/g) ?? []).length;
  const classCount        = (src.match(/\bclass\s+\w/g) ?? []).length;

  return {
    rawImports: [...new Set(rawImports)],
    abstractCount: interfaceCount + abstractClsCount + typeAliasCount,
    concreteCount: Math.max(0, classCount - abstractClsCount),
  };
}

function extractJS(src: string): FileSignature {
  const rawImports: string[] = [];
  for (const m of src.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g))
    rawImports.push(m[1]!);
  for (const m of src.matchAll(/\bimport\s+['"]([^'"]+)['"]/g))
    rawImports.push(m[1]!);
  for (const m of src.matchAll(/(?:\bimport\s*\(|require\s*\()['"]([^'"]+)['"]/g))
    rawImports.push(m[1]!);

  const classCount = (src.match(/\bclass\s+\w/g) ?? []).length;
  return { rawImports: [...new Set(rawImports)], abstractCount: 0, concreteCount: classCount };
}

function extractPy(src: string): FileSignature {
  const rawImports: string[] = [];
  // Relative imports: from .module import foo
  for (const m of src.matchAll(/^from\s+(\.+[\w.]*)\s+import/gm))
    rawImports.push(m[1]!);
  // Relative import: import .module
  for (const m of src.matchAll(/^import\s+(\.+[\w.]*)/gm))
    rawImports.push(m[1]!);

  // Abstract: inherits ABC/Protocol, or uses @abstractmethod
  const abstractClsCount = (src.match(/^\s*class\s+\w+\s*\([^)]*(?:ABC|Protocol|ABCMeta)[^)]*\)/gm) ?? []).length;
  const abstractMethodCount = (src.match(/@abstractmethod/g) ?? []).length;
  const classCount = (src.match(/^\s*class\s+\w/gm) ?? []).length;

  return {
    rawImports: [...new Set(rawImports)],
    abstractCount: abstractClsCount + abstractMethodCount,
    concreteCount: Math.max(0, classCount - abstractClsCount),
  };
}

function extractGo(src: string): FileSignature {
  const rawImports: string[] = [];
  // Import block: import ( "pkg" )
  const block = src.match(/\bimport\s*\(([\s\S]*?)\)/);
  if (block) {
    for (const m of block[1]!.matchAll(/"([^"]+)"/g))
      rawImports.push(m[1]!);
  }
  // Single import: import "pkg"
  for (const m of src.matchAll(/^import\s+"([^"]+)"/gm))
    rawImports.push(m[1]!);

  const interfaceCount = (src.match(/\btype\s+\w+\s+interface\s*\{/g) ?? []).length;
  const structCount    = (src.match(/\btype\s+\w+\s+struct\s*\{/g) ?? []).length;

  return {
    rawImports: [...new Set(rawImports)],
    abstractCount: interfaceCount,
    concreteCount: structCount,
  };
}

function extractJava(src: string): FileSignature {
  const rawImports: string[] = [];
  for (const m of src.matchAll(/^import\s+([\w.]+);/gm))
    rawImports.push(m[1]!);

  const interfaceCount   = (src.match(/\binterface\s+\w/g) ?? []).length;
  const abstractClsCount = (src.match(/\babstract\s+class\s+\w/g) ?? []).length;
  const classCount       = (src.match(/\bclass\s+\w/g) ?? []).length;

  return {
    rawImports: [...new Set(rawImports)],
    abstractCount: interfaceCount + abstractClsCount,
    concreteCount: Math.max(0, classCount - abstractClsCount),
  };
}

function extractRust(src: string): FileSignature {
  const rawImports: string[] = [];
  // Relative use paths: use crate::, use super::, use self::
  for (const m of src.matchAll(/\buse\s+((?:crate|super|self)::[\w:]+)/g))
    rawImports.push(m[1]!);

  const traitCount  = (src.match(/\btrait\s+\w/g) ?? []).length;
  const structCount = (src.match(/\bstruct\s+\w/g) ?? []).length;
  const enumCount   = (src.match(/\benum\s+\w/g) ?? []).length;

  return {
    rawImports: [...new Set(rawImports)],
    abstractCount: traitCount,
    concreteCount: structCount + enumCount,
  };
}

function extractCS(src: string): FileSignature {
  const rawImports: string[] = [];
  for (const m of src.matchAll(/^using\s+([\w.]+);/gm))
    rawImports.push(m[1]!);

  const interfaceCount   = (src.match(/\binterface\s+\w/g) ?? []).length;
  const abstractClsCount = (src.match(/\babstract\s+class\s+\w/g) ?? []).length;
  const classCount       = (src.match(/\bclass\s+\w/g) ?? []).length;
  const structCount      = (src.match(/\bstruct\s+\w/g) ?? []).length;
  const recordCount      = (src.match(/\brecord\s+\w/g) ?? []).length;
  const enumCount        = (src.match(/\benum\s+\w/g) ?? []).length;

  return {
    rawImports: [...new Set(rawImports)],
    abstractCount: interfaceCount + abstractClsCount,
    concreteCount: Math.max(0, classCount - abstractClsCount) + structCount + recordCount + enumCount,
  };
}

function extractKotlin(src: string): FileSignature {
  const rawImports: string[] = [];
  for (const m of src.matchAll(/^import\s+([\w.]+)/gm))
    rawImports.push(m[1]!);

  const interfaceCount   = (src.match(/\binterface\s+\w/g) ?? []).length;
  const abstractClsCount = (src.match(/\babstract\s+class\s+\w/g) ?? []).length;
  const classCount       = (src.match(/\bclass\s+\w/g) ?? []).length;
  const objectCount      = (src.match(/\bobject\s+\w/g) ?? []).length;
  const dataClassCount   = (src.match(/\bdata\s+class\s+\w/g) ?? []).length;

  return {
    rawImports: [...new Set(rawImports)],
    abstractCount: interfaceCount + abstractClsCount,
    concreteCount: Math.max(0, classCount - abstractClsCount) + objectCount + dataClassCount,
  };
}

function extractSwift(src: string): FileSignature {
  const rawImports: string[] = [];
  for (const m of src.matchAll(/^import\s+([\w.]+)/gm))
    rawImports.push(m[1]!);

  const protocolCount    = (src.match(/\bprotocol\s+\w/g) ?? []).length;
  const classCount       = (src.match(/\bclass\s+\w/g) ?? []).length;
  const structCount      = (src.match(/\bstruct\s+\w/g) ?? []).length;
  const enumCount        = (src.match(/\benum\s+\w/g) ?? []).length;
  const actorCount       = (src.match(/\bactor\s+\w/g) ?? []).length;

  return {
    rawImports: [...new Set(rawImports)],
    abstractCount: protocolCount,
    concreteCount: classCount + structCount + enumCount + actorCount,
  };
}

function extractPhp(src: string): FileSignature {
  const rawImports: string[] = [];
  for (const m of src.matchAll(/\brequire(?:_once)?\s*\(?['"]([^'"]+)['"]/g))
    rawImports.push(m[1]!);
  for (const m of src.matchAll(/\binclude(?:_once)?\s*\(?['"]([^'"]+)['"]/g))
    rawImports.push(m[1]!);
  for (const m of src.matchAll(/\buse\s+([\w\\]+)/g))
    rawImports.push(m[1]!);

  const interfaceCount   = (src.match(/\binterface\s+\w/g) ?? []).length;
  const abstractClsCount = (src.match(/\babstract\s+class\s+\w/g) ?? []).length;
  const classCount       = (src.match(/\bclass\s+\w/g) ?? []).length;
  const traitCount       = (src.match(/\btrait\s+\w/g) ?? []).length;

  return {
    rawImports: [...new Set(rawImports)],
    abstractCount: interfaceCount + abstractClsCount,
    concreteCount: Math.max(0, classCount - abstractClsCount) + traitCount,
  };
}

function extractRuby(src: string): FileSignature {
  const rawImports: string[] = [];
  for (const m of src.matchAll(/\brequire(?:_relative)?\s+['"]([^'"]+)['"]/g))
    rawImports.push(m[1]!);

  const moduleCount  = (src.match(/\bmodule\s+\w/g) ?? []).length;
  const classCount   = (src.match(/\bclass\s+\w/g) ?? []).length;

  return {
    rawImports: [...new Set(rawImports)],
    abstractCount: moduleCount,
    concreteCount: classCount,
  };
}

function extractCpp(src: string): FileSignature {
  const rawImports: string[] = [];
  for (const m of src.matchAll(/^#include\s+["<]([^">]+)[">]/gm))
    rawImports.push(m[1]!);

  const classCount    = (src.match(/\bclass\s+\w/g) ?? []).length;
  const structCount   = (src.match(/\bstruct\s+\w/g) ?? []).length;
  const enumCount     = (src.match(/\benum\s+(?:class\s+)?\w/g) ?? []).length;
  // Pure virtual signals abstraction
  const pureVirtCount = (src.match(/=\s*0\s*;/g) ?? []).length;

  return {
    rawImports: [...new Set(rawImports)],
    abstractCount: pureVirtCount > 0 ? classCount : 0,
    concreteCount: classCount + structCount + enumCount,
  };
}

function extractScala(src: string): FileSignature {
  const rawImports: string[] = [];
  for (const m of src.matchAll(/^import\s+([\w.]+(?:\.\{[^}]+\})?)/gm))
    rawImports.push(m[1]!);

  const traitCount     = (src.match(/\btrait\s+\w/g) ?? []).length;
  const abstractCount  = (src.match(/\babstract\s+class\s+\w/g) ?? []).length;
  const classCount     = (src.match(/\bclass\s+\w/g) ?? []).length;
  const objectCount    = (src.match(/\bobject\s+\w/g) ?? []).length;
  const caseClassCount = (src.match(/\bcase\s+class\s+\w/g) ?? []).length;

  return {
    rawImports: [...new Set(rawImports)],
    abstractCount: traitCount + abstractCount,
    concreteCount: Math.max(0, classCount - abstractCount) + objectCount + caseClassCount,
  };
}
