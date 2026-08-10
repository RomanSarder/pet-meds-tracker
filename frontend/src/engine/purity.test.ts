// Module-graph purity checks (W2-DECISIONS.md §0). The engine must stay a
// pure, injectable-clock function library: no UI/data-layer imports, no
// escape from its own directory, and no hidden wall-clock reads. This file
// reads the OTHER engine source files off disk and greps them — it never
// imports them, so it has no opinion on whether they compile or what they
// return.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const engineDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Every `.ts` file in `frontend/src/engine` that is NOT a `*.test.ts` file.
 * This test's own filename ends in `.test.ts`, so it is excluded by
 * construction — its own regex source can never trip its own assertions.
 */
function engineSourceFiles(): string[] {
  return readdirSync(engineDir)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => path.join(engineDir, name));
}

function lineAt(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

interface ImportSpecifier {
  specifier: string;
  index: number;
}

function extractImportSpecifiers(content: string): ImportSpecifier[] {
  const results: ImportSpecifier[] = [];
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g, // import ... from "x"; export ... from "x";
    /\bimport\s*\(\s*["']([^"']+)["']/g, // dynamic import("x")
    /\bimport\s+["']([^"']+)["']\s*;/g, // side-effect import "x";
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      results.push({ specifier: match[1], index: match.index! });
    }
  }
  return results;
}

const FORBIDDEN_SPECIFIERS = ["react", "react-dom", "idb", "@/data", "@/features", "@/components"];

describe("engine purity — module graph", () => {
  it("imports nothing from react, react-dom, idb, @/data, @/features, @/components, and no relative path escapes the engine directory", () => {
    const violations: string[] = [];
    for (const file of engineSourceFiles()) {
      const content = readFileSync(file, "utf8");
      for (const { specifier, index } of extractImportSpecifiers(content)) {
        const escapesDirectory = specifier.startsWith("../");
        if (FORBIDDEN_SPECIFIERS.includes(specifier) || escapesDirectory) {
          violations.push(
            `${path.basename(file)}:${lineAt(content, index)}: forbidden import "${specifier}"`,
          );
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("never imports the i18n layer — the engine returns structure, the i18n layer words it", () => {
    const violations: string[] = [];
    for (const file of engineSourceFiles()) {
      const content = readFileSync(file, "utf8");
      for (const { specifier, index } of extractImportSpecifiers(content)) {
        // "@/i18n" itself, plus any deeper or relative path whose module
        // segment is `i18n` ("@/i18n/schedule", "../i18n/translator").
        const isI18n = specifier === "@/i18n" || /(^|\/)i18n(\/|$)/.test(specifier);
        if (isI18n) {
          violations.push(
            `${path.basename(file)}:${lineAt(content, index)}: forbidden import "${specifier}"`,
          );
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("never touches Intl — no locale-aware formatting inside the engine", () => {
    const violations: string[] = [];
    // `Intl.` covers every property access; `Intl[` covers computed access.
    const intlUse = /\bIntl\s*[.[]/g;
    for (const file of engineSourceFiles()) {
      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(intlUse)) {
        violations.push(`${path.basename(file)}:${lineAt(content, match.index!)}: ${match[0]}`);
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("never constructs an argless `new Date()`", () => {
    const violations: string[] = [];
    const argless = /\bnew\s+Date\s*\(\s*\)/g;
    for (const file of engineSourceFiles()) {
      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(argless)) {
        violations.push(`${path.basename(file)}:${lineAt(content, match.index!)}: ${match[0]}`);
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("never calls Date.now()", () => {
    const violations: string[] = [];
    const dateNow = /\bDate\.now\s*\(/g;
    for (const file of engineSourceFiles()) {
      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(dateNow)) {
        violations.push(`${path.basename(file)}:${lineAt(content, match.index!)}: ${match[0]}`);
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("never imports now, getClock or systemClock from @/domain — the engine takes now: Date as a parameter", () => {
    const violations: string[] = [];
    const domainNamedImport = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']@\/domain["']/g;
    const forbiddenNames = ["now", "getClock", "systemClock"];
    for (const file of engineSourceFiles()) {
      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(domainNamedImport)) {
        const names = match[1]
          .split(",")
          .map((n) => n.trim())
          .filter(Boolean)
          .map((n) => n.replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim());
        for (const name of names) {
          if (forbiddenNames.includes(name)) {
            violations.push(
              `${path.basename(file)}:${lineAt(content, match.index!)}: imports "${name}" from "@/domain"`,
            );
          }
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  // I18N-DESIGN.md §3.4: "the engine stays pure and language-agnostic" —
  // under localization it must return STRUCTURE (ScheduleSegment,
  // CourseProgress, DetailClause, …), never a finished English/Ukrainian
  // sentence. Comments are allowed to contain example prose (several engine
  // files document their segment shapes with an English example inline), so
  // this strips comments first and only inspects string literals that
  // survive in actual code. A "prose" literal is approximated as two or more
  // space-separated alphabetic words inside a string/template literal — every
  // real code string in this directory today is a short, single-word status
  // tag ("fixedTimes", "overdue", …) or a clock-time-shaped token, none of
  // which contain a space before a letter.
  it("holds no user-facing prose string literal in actual code (comments may still document examples)", () => {
    const violations: string[] = [];
    const proseLikeLiteral = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
    const twoOrMoreWords = /[A-Za-z]+[ \t][A-Za-z]+/;
    for (const file of engineSourceFiles()) {
      const raw = readFileSync(file, "utf8");
      // Strip block comments, then line comments — in that order, so a `//`
      // inside a `/* … */` block doesn't confuse the line-comment pass.
      const noBlockComments = raw.replace(/\/\*[\s\S]*?\*\//g, (m) =>
        m.replace(/[^\n]/g, " "),
      );
      const stripped = noBlockComments.replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
      for (const match of stripped.matchAll(proseLikeLiteral)) {
        const value = match[2];
        if (twoOrMoreWords.test(value)) {
          violations.push(
            `${path.basename(file)}:${lineAt(stripped, match.index!)}: prose-like string literal "${value}"`,
          );
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
