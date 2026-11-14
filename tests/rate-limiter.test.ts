import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../src/adapters/zhilian/rate-limiter.js';

describe('RateLimiter', () => {
  it('computes interval from per-minute rate', () => {
    expect(new RateLimiter(60).intervalMs).toBe(1000);
    expect(new RateLimiter(15).intervalMs).toBe(4000);
    expect(new RateLimiter(0).intervalMs).toBe(0);
  });

  it('spaces two acquisitions by at least the interval', async () => {
    const limiter = new RateLimiter(120); // 500ms
    const start = Date.now();
    await limiter.acquire();
    await limiter.acquire();
    expect(Date.now() - start).toBeGreaterThanOrEqual(450);
  });
});
