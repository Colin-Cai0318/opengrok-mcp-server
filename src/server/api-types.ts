/** Types exchanged by the Code Mode sandbox and its Web-only host API. */

export interface SearchMatch { lineNumber: number; lineContent: string; }
export interface SearchResultItem { project: string; path: string; matches: SearchMatch[]; }
export interface SearchAPIResult {
  query: string; searchType: string; totalCount: number; timeMs: number;
  results: SearchResultItem[]; startIndex: number; endIndex: number; hasMore: boolean;
}
export interface FileContentAPIResult {
  project: string; path: string; content: string; lineCount: number; sizeBytes: number;
  startLine?: number; endLine?: number;
}
export interface SymbolEntry {
  symbol: string; type: string; signature: string | null; line: number;
  lineStart: number; lineEnd: number; namespace: string | null;
}
export interface SymbolsAPIResult { project: string; path: string; symbols: SymbolEntry[]; }
export interface DirEntry { name: string; isDirectory: boolean; path: string; size?: number; lastModified?: string; }
export interface DirAPIResult { project: string; path: string; entries: DirEntry[]; }
export interface SymbolContextAPIResult {
  found: boolean; symbol: string; kind: string;
  definition?: { project: string; path: string; line: number; context: string; lang: string };
  header?: { project: string; path: string; context: string; lang: string };
  references: { totalFound: number; samples: Array<{ path: string; project: string; lineNumber: number; content: string }> };
  fileSymbols?: Array<{ symbol: string; type: string; line: number }>;
}
export interface CompileInfoAPIResult { file: string; compiler: string; standard?: string; includes: string[]; defines: string[]; extraFlags: string[]; }
export interface HealthAPIResult { connected: boolean; latencyMs: number; baseUrl: string; }
