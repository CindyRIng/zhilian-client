import { describe, it, expect } from 'vitest';
import { loadConfig, ensureDataDirs, expandHome } from '../src/config/schema.js';

describe('config', () => {
  it('has sane defaults for zhilian', () => {
    const cfg = loadConfig({ env: {} });
    expect(cfg.port).toBe(8791);
    expect(cfg.host).toBe('127.0.0.1');
    expect(cfg.baseUrl).toBe('https://www.zhaopin.com');
    expect(cfg.loginUrl).toBe('https://passport.zhaopin.com/login');
    expect(cfg.apiBase).toBe('https://fe-api.zhaopin.com');
    expect(cfg.headless).toBe(true);
    expect(cfg.loginMode).toBe('app-qr');
    expect(cfg.cities).toEqual(['565']);
    expect(cfg.sortType).toBe('JOB_PUBLISH_TIME');
    expect(cfg.anonymous).toBe(true);
    expect(cfg.session.maxPages).toBe(5);
    expect(cfg.session.ratePerMin).toBe(15);
  });

  it('reads env overrides', () => {
    const cfg = loadConfig({
      env: {
        ZHILIAN_PORT: '8899',
        ZHILIAN_CITIES: '565,530',
        ZHILIAN_SORT_TYPE: 'DEFAULT',
        ZHILIAN_HEADLESS: 'false',
        ZHILIAN_EDGE_AUTO: 'true',
        ZHILIAN_API_TOKEN: 'token-123',
      },
    });
    expect(cfg.port).toBe(8899);
    expect(cfg.cities).toEqual(['565', '530']);
    expect(cfg.sortType).toBe('DEFAULT');
    expect(cfg.headless).toBe(false);
    expect(cfg.edgeAuto).toBe(true);
    expect(cfg.apiToken).toBe('token-123');
  });

  it('rejects non-loopback host', () => {
    expect(() => loadConfig({ env: { ZHILIAN_HOST: '0.0.0.0' } })).toThrow(/127\.0\.0\.1/);
  });

  it('expands ~ and ensures dirs without throwing', () => {
    const home = process.env.HOME || '';
    expect(expandHome('~/x')).toBe(`${home}/x`);
    const cfg = loadConfig({ env: { ZHILIAN_PROFILE_DIR: '/tmp/zhilian-test-profile', ZHILIAN_CACHE_DB: '/tmp/zhilian-test-cache/cache.db', ZHILIAN_LOG_FILE: '/tmp/zhilian-test-logs/a.log', ZHILIAN_LOCK_FILE: '/tmp/zhilian-test-run/a.lock', ZHILIAN_SESSION_FILE: '/tmp/zhilian-test-state/session.json' } });
    expect(() => ensureDataDirs(cfg)).not.toThrow();
  });
});
