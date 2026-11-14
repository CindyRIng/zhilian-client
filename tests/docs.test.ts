import { describe, it, expect } from 'vitest';
import { docsJsonResponse, renderDocsHtml } from '../src/transports/rest/docs.js';
import { OPERATIONS } from '../src/api/operations.js';
import { toJsonSchema } from '../src/generators/json-schema.js';
import { ErrorCodeSchema } from '../src/errors/catalog.js';

describe('rest docs', () => {
  it('renders self-contained html with every operation', () => {
    const html = renderDocsHtml();
    expect(html).toContain('zhilian-client');
    expect(html).toContain('智联招聘');
    for (const op of OPERATIONS) expect(html).toContain(op.id);
  });

  it('exposes machine-readable docs json', () => {
    const docs = docsJsonResponse() as { operations?: unknown[]; envelope?: unknown };
    expect(Array.isArray(docs.operations) ? docs.operations.length : 0).toBe(OPERATIONS.length);
  });

  it('converts zod schemas to json schema', () => {
    const schema = toJsonSchema(ErrorCodeSchema, 'input') as { enum?: string[] };
    expect(schema.enum).toContain('HUMAN_VERIFICATION_REQUIRED');
    expect(schema.enum).toContain('ANONYMOUS_LIMITED');
  });
});
