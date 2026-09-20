import { describe, expect, it } from "vitest";
import { extractImports, langFromPath } from "../server/intelligence.js";

describe("extractImports", () => {
  it("extracts C++ #include directives", () => {
    const text = '#include "EventLoop.h"\n#include <vector>\nvoid foo() {}';
    expect(extractImports(text, "cpp")).toEqual(["EventLoop.h", "vector"]);
  });

  it("extracts TypeScript import paths", () => {
    const text = "import { foo } from './utils/helper';\nimport type Bar from 'bar';";
    const imports = extractImports(text, "typescript");
    expect(imports).toContain("./utils/helper");
    expect(imports).toContain("bar");
  });

  it("deduplicates imports", () => {
    const text = "import 'react';\nimport React from 'react';";
    const imports = extractImports(text, "typescript");
    expect(imports.filter((item) => item === "react")).toHaveLength(1);
  });

  it("returns an empty array for files without imports", () => {
    expect(extractImports("const x = 1;\n", "typescript")).toEqual([]);
  });
});

describe("langFromPath", () => {
  it("maps known extensions", () => {
    expect(langFromPath("foo/bar.cpp")).toBe("cpp");
    expect(langFromPath("src/index.ts")).toBe("typescript");
    expect(langFromPath("main.py")).toBe("python");
    expect(langFromPath("cmd/main.go")).toBe("go");
  });

  it("falls back to the extension for unknown types", () => {
    expect(langFromPath("foo.xyz")).toBe("xyz");
  });
});
