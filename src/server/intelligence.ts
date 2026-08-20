/** Small Web-only helpers used by the dependency-map tool. */
export function extractImports(text: string, lang: string): string[] {
  const imports: string[] = [];
  const matches = (lang === "cpp" || lang === "c")
    ? text.matchAll(/#include\s+["<]([^">]+)[">]/g)
    : text.matchAll(/(?:import|require|from)\s+["'`]([^"'`]+)["'`]/g);
  for (const match of matches) if (match[1]) imports.push(match[1]);
  return [...new Set(imports)].slice(0, 20);
}

export function langFromPath(filePath: string): string {
  if (!filePath.includes(".")) return "text";
  const ext = (filePath.split(".").pop() ?? "").toLowerCase();
  const map: Record<string, string> = { cpp: "cpp", cxx: "cpp", cc: "cpp", c: "c", h: "cpp", hpp: "cpp", hxx: "cpp", java: "java", py: "python", js: "javascript", ts: "typescript", go: "go", rs: "rust" };
  return map[ext] ?? ext;
}
