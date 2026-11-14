import { describe, it, expect } from 'vitest';
import { createBackend } from '../src/backend.js';

describe('backend', () => {
  it('dedicated remote mode returns remote backend without starting a browser', async () => {
    const backend = await createBackend({ mode: 'remote', url: 'http://127.0.0.1:8791' });
    expect(backend.mode).toBe('remote');
    expect(typeof backend.service.searchJobs).toBe('function');
    await backend.close();
  });

  it('remote service rejects unreachable server with SERVICE_UNAVAILABLE', async () => {
    const backend = await createBackend({ mode: 'remote', url: 'http://127.0.0.1:9' });
    await expect(backend.service.status()).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    await backend.close();
  });
});
