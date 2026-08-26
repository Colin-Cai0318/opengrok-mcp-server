import { describe, it, expect } from 'vitest';

// We'll import the server module to get tool definitions
// Since tools are registered dynamically, we test via the exported TOOL_DEFS map

describe('tool description length constraints', () => {
  // Import all tool description strings from server.ts
  it('all tool descriptions must exist and be ≤120 characters', async () => {
    const { TOOL_DEFS } = await import('../server/server.js');
    for (const [name, def] of Object.entries(TOOL_DEFS)) {
      const desc = def.description ?? '';
      expect(
        desc.length,
        `${name}: description is ${desc.length} chars (max 120): "${desc}"`
      ).toBeLessThanOrEqual(120);
      expect(desc.length, `${name}: description is empty`).toBeGreaterThan(0);
    }
  });

  it('all parameter descriptions must be ≤80 characters', async () => {
    const { TOOL_DEFS } = await import('../server/server.js');
    for (const [toolName, def] of Object.entries(TOOL_DEFS)) {
      const params = def.parameters ?? {};
      for (const [paramName, paramDef] of Object.entries(params as Record<string, { description?: string }>)) {
        const desc = paramDef.description ?? '';
        expect(
          desc.length,
          `${toolName}.${paramName}: param description ${desc.length} chars (max 80): "${desc}"`
        ).toBeLessThanOrEqual(80);
        expect(desc.length, `${toolName}.${paramName}: parameter description is empty`).toBeGreaterThan(0);
      }
    }
  });

  it('project-scoped tools tell the agent to use exact project names', async () => {
    const { TOOL_DEFS } = await import('../server/server.js');
    const scopedTools = [
      'opengrok_search_code',
      'opengrok_find_file',
      'opengrok_get_file_content',
      'opengrok_browse_directory',
      'opengrok_search_and_read',
      'opengrok_get_file_symbols',
      'opengrok_dependency_map',
    ];
    for (const name of scopedTools) {
      expect(TOOL_DEFS[name].description.toLowerCase(), name).toContain('project');
    }
    expect(TOOL_DEFS.opengrok_list_projects.description).toContain('exact project names');
  });

  it('detailed docs do not advertise empty or legacy project/search inputs', async () => {
    const { TOOL_DOCS } = await import('../server/server.js');
    expect(TOOL_DOCS.opengrok_search_code).toContain('full|defs|refs|path');
    expect(TOOL_DOCS.opengrok_search_code).not.toContain('symbol|full|path|hist|type');
    expect(TOOL_DOCS.opengrok_get_symbol_context).not.toContain('project name (optional)');
    expect(TOOL_DOCS.opengrok_search_and_read).not.toContain('project scope (optional)');
  });

  it('no tool description contains verbose information phrases', async () => {
    const { TOOL_DEFS } = await import('../server/server.js');
    const forbidden = ['When to use', 'When not to use', 'Args:', 'Example:', 'Examples:', 'Returns:'];
    for (const [name, def] of Object.entries(TOOL_DEFS)) {
      const desc = def.description ?? '';
      for (const phrase of forbidden) {
        expect(desc, `${name} contains "${phrase}"`).not.toContain(phrase);
      }
    }
  });
});
