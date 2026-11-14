import { describe, it, expect } from 'vitest';
import {
  LoginSessionSchema,
  LoginSmsRequestSchema,
  LoginStartRequestSchema,
  VerificationSolveRequestSchema,
  VerificationStatusSchema,
} from '../src/domain/login.js';

describe('login domain', () => {
  it('validates login start request', () => {
    expect(LoginStartRequestSchema.safeParse({}).success).toBe(true);
    expect(LoginStartRequestSchema.safeParse({ mode: 'app-qr' }).success).toBe(true);
    expect(LoginStartRequestSchema.safeParse({ mode: 'sms', phone: '13800138000' }).success).toBe(true);
    expect(LoginStartRequestSchema.safeParse({ phone: '123' }).success).toBe(false);
    expect(LoginStartRequestSchema.safeParse({ mode: 'qr' }).success).toBe(false);
  });

  it('validates sms code', () => {
    expect(LoginSmsRequestSchema.safeParse({ code: '677185' }).success).toBe(true);
    expect(LoginSmsRequestSchema.safeParse({ code: '12' }).success).toBe(false);
    expect(LoginSmsRequestSchema.safeParse({ code: 'abcdef' }).success).toBe(false);
  });

  it('validates verification solve payloads', () => {
    expect(VerificationSolveRequestSchema.safeParse({ kind: 'edgeone', auto: true }).success).toBe(true);
    expect(VerificationSolveRequestSchema.safeParse({ kind: 'edgeone', points: [{ x: 0.1, y: 0.2 }] }).success).toBe(true);
    expect(VerificationSolveRequestSchema.safeParse({ kind: 'edgeone' }).success).toBe(false);
    expect(VerificationSolveRequestSchema.safeParse({ kind: 'geetest', points: [{ x: 0.1, y: 0.2 }] }).success).toBe(true);
    expect(VerificationSolveRequestSchema.safeParse({ kind: 'geetest', offsetRatio: 0.6 }).success).toBe(true);
    expect(VerificationSolveRequestSchema.safeParse({ kind: 'geetest' }).success).toBe(false);
    expect(VerificationSolveRequestSchema.safeParse({ kind: 'nc', points: [{ x: 0.5, y: 0.5 }] }).success).toBe(true);
  });

  it('parses a login session', () => {
    const session = {
      loginId: 'login_abc12345',
      mode: 'app-qr',
      state: 'awaiting_scan',
      qr: { pngBase64: 'data:image/jpeg;base64,xxxx', image: { width: 300, height: 300 }, expiresAt: new Date().toISOString() },
      expiresAt: new Date().toISOString(),
    };
    expect(LoginSessionSchema.safeParse(session).success).toBe(true);
    expect(VerificationStatusSchema.safeParse({ pending: false, kind: null }).success).toBe(true);
  });
});
