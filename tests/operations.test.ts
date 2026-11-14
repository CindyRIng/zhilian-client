import { describe, it, expect } from 'vitest';
import { OPERATIONS, mcpTools, cliCommands, getOperation } from '../src/api/operations.js';

describe('operations registry', () => {
  it('has unique ids / rest paths / mcp names', () => {
    const ids = OPERATIONS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    const mcp = mcpTools().map((t) => t.name);
    expect(new Set(mcp).size).toBe(mcp.length);
    const restKeys = OPERATIONS.map((o) => `${o.rest.method} ${o.rest.path}`);
    expect(new Set(restKeys).size).toBe(restKeys.length);
  });

  it('exposes the expected 17 operations', () => {
    expect(OPERATIONS.length).toBe(17);
    const ids = OPERATIONS.map((o) => o.id);
    for (const id of [
      'health.get',
      'status.get',
      'session.login.start',
      'session.login.get',
      'session.login.sms',
      'session.login.cancel',
      'verification.get',
      'verification.solve',
      'search.jobs',
      'jobs.list',
      'jobs.detail',
      'companies.list',
      'companies.detail',
      'companies.jobs',
      'cities.list',
      'cache.stats',
      'cache.clear',
    ]) {
      expect(ids).toContain(id);
    }
  });

  it('all operations have output schema and cli/mcp mapping', () => {
    for (const op of OPERATIONS) {
      expect(op.output).toBeTruthy();
      expect(op.input).toBeTruthy();
      expect(op.cli.command.length).toBeGreaterThan(0);
      expect(op.mcp.name.startsWith('zhilian_')).toBe(true);
      expect(getOperation(op.id).id).toBe(op.id);
    }
  });

  it('health is public, others require bearer', () => {
    expect(OPERATIONS.find((o) => o.id === 'health.get')?.auth).toBe('none');
    for (const op of OPERATIONS.filter((o) => o.id !== 'health.get')) expect(op.auth).toBe('bearer');
  });

  it('cli commands are derived from operations', () => {
    expect(cliCommands().length).toBe(OPERATIONS.length);
    expect(cliCommands().every((c) => c.command.startsWith('zhilian '))).toBe(true);
  });
});
