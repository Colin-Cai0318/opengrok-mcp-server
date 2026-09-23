import { describe, it, expect } from 'vitest';

describe('SERVER_INSTRUCTIONS token budget', () => {
  it('standard template is ≤500 chars', async () => {
    const { SERVER_INSTRUCTIONS_TEMPLATE } = await import('../server/server.js');
    const filled = SERVER_INSTRUCTIONS_TEMPLATE.replace('{{MEMORY_STATUS}}', '[Memory] No prior context.');
    expect(filled.length).toBeLessThanOrEqual(500);
  });

  it('code mode template is ≤600 chars', async () => {
    const { SERVER_INSTRUCTIONS_CODE_MODE_TEMPLATE } = await import('../server/server.js');
    const filled = SERVER_INSTRUCTIONS_CODE_MODE_TEMPLATE.replace('{{MEMORY_STATUS}}', '[Memory] No prior context.');
    expect(filled.length).toBeLessThanOrEqual(600);
  });

  it('template contains {{MEMORY_STATUS}} placeholder', async () => {
    const { SERVER_INSTRUCTIONS_TEMPLATE } = await import('../server/server.js');
    expect(SERVER_INSTRUCTIONS_TEMPLATE).toContain('{{MEMORY_STATUS}}');
  });

  it('both modes reserve a startup project catalog placeholder', async () => {
    const {
      SERVER_INSTRUCTIONS_TEMPLATE,
      SERVER_INSTRUCTIONS_CODE_MODE_TEMPLATE,
    } = await import('../server/server.js');
    expect(SERVER_INSTRUCTIONS_TEMPLATE).toContain('{{PROJECT_STATUS}}');
    expect(SERVER_INSTRUCTIONS_CODE_MODE_TEMPLATE).toContain('{{PROJECT_STATUS}}');
  });

  it('formats connected project names as an exact JSON catalog', async () => {
    const { formatProjectCatalog } = await import('../server/server.js');
    const catalog = formatProjectCatalog(['android-v', 'android-w', 'android-v'], 'android-w');
    expect(catalog).toContain('Available exact project names (2)');
    expect(catalog).toContain('["android-v","android-w"]');
    expect(catalog).toContain('Configured default project: "android-w"');
  });

  it('keeps startup project status compact and omits project names', async () => {
    const { formatStartupProjectStatus } = await import('../server/server.js');
    const status = formatStartupProjectStatus(['secret-a', 'secret-b', 'secret-a'], 'secret-b');
    expect(status).toContain('2 projects discovered');
    expect(status).toContain('Default: "secret-b"');
    expect(status).not.toContain('secret-a');
    expect(status.length).toBeLessThanOrEqual(150);
  });

  it('bounds large startup catalogs and directs the agent to refresh', async () => {
    const { formatProjectCatalog } = await import('../server/server.js');
    const catalog = formatProjectCatalog(
      Array.from({ length: 52 }, (_, index) => `project-${index + 1}`),
    );
    expect(catalog).toContain('Showing 50 of 52');
    expect(catalog).toContain('opengrok_api with projectFilter');
    expect(catalog).not.toContain('project-51');
  });

  it('finds exact projects beyond the preview and asks for confirmation on misses', async () => {
    const { formatProjectCatalog } = await import('../server/server.js');
    const names = Array.from({ length: 100 }, (_, index) => `project-${index + 1}`);
    expect(formatProjectCatalog(names, undefined, 'project-99')).toContain('Exact project name confirmed: "project-99"');
    expect(formatProjectCatalog(names, undefined, 'project-')).toContain('Ask the user to confirm the intended exact name');
    expect(formatProjectCatalog(names, undefined, 'missing')).toContain('Do not substitute another project; ask the user');
  });

  it('puts unavailable server names into the first-conversation status', async () => {
    const { resolveStartupProjectStatus } = await import('../server/server.js');
    const client = {
      testConnection: async () => true,
      listProjects: async () => [{ name: 'alpha' }],
      getConnectionStatus: () => ({ available: ['one'], unavailable: ['two'] }),
    };
    const status = await resolveStartupProjectStatus(client as never);
    expect(status).toContain('1 projects discovered');
    expect(status).toContain('server(s) unavailable: "two"');
    expect(status).toContain('Tell the user in your first reply');
    expect(status).toContain('restart MCP after recovery');
  });

  it('no 3-step SESSION STARTUP sequence in template', async () => {
    const { SERVER_INSTRUCTIONS_TEMPLATE } = await import('../server/server.js');
    expect(SERVER_INSTRUCTIONS_TEMPLATE).not.toContain('Step 1');
    expect(SERVER_INSTRUCTIONS_TEMPLATE).not.toContain('Step 2');
    expect(SERVER_INSTRUCTIONS_TEMPLATE).not.toContain('Step 3');
  });
});

describe('TOOL_REGISTRATION_ORDER', () => {
  it('contains the exact current tool surface', async () => {
    const { TOOL_REGISTRATION_ORDER } = await import('../server/server.js');
    expect(TOOL_REGISTRATION_ORDER).toHaveLength(17);
  });

  it('all names start with opengrok_', async () => {
    const { TOOL_REGISTRATION_ORDER } = await import('../server/server.js');
    for (const name of TOOL_REGISTRATION_ORDER) {
      expect(name).toMatch(/^opengrok_/);
    }
  });
});
