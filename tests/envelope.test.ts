import { describe, it, expect } from 'vitest';
import { successEnvelope, failureEnvelope, SCHEMA_VERSION, ResponseMetaSchema } from '../src/schemas/envelope.js';

describe('envelope', () => {
  it('success envelope has schemaVersion/mode/warnings', () => {
    const env = successEnvelope({ hello: 'world' }, { requestId: 'req_12345678', tookMs: 12, mode: 'logged_in' });
    expect(env.ok).toBe(true);
    expect(env.data).toEqual({ hello: 'world' });
    expect(env.error).toBeNull();
    expect(env.meta.schemaVersion).toBe(SCHEMA_VERSION);
    expect(env.meta.mode).toBe('logged_in');
    expect(env.meta.cached).toBe(false);
    expect(env.meta.warnings).toEqual([]);
    expect(ResponseMetaSchema.safeParse(env.meta).success).toBe(true);
  });

  it('failure envelope carries error and meta', () => {
    const env = failureEnvelope(
      { code: 'HUMAN_VERIFICATION_REQUIRED', message: 'need verify', retryable: true },
      { requestId: 'req_12345678', tookMs: 3, mode: 'anonymous' },
    );
    expect(env.ok).toBe(false);
    expect(env.data).toBeNull();
    expect(env.error.code).toBe('HUMAN_VERIFICATION_REQUIRED');
    expect(env.meta.mode).toBe('anonymous');
    expect(ResponseMetaSchema.safeParse(env.meta).success).toBe(true);
  });

  it('pagination metadata round-trips', () => {
    const env = successEnvelope([], {
      requestId: 'req_12345678',
      tookMs: 1,
      pagination: { page: 2, pageSize: 20, total: 40, hasMore: false, pagesFetched: 2, pagesAvailable: 2 },
    });
    expect(env.meta.pagination?.page).toBe(2);
    expect(env.meta.pagination?.hasMore).toBe(false);
  });
});
