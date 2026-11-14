/**
 * 登录领域模型（智联APP扫码 / 短信 / 微信扫码 / 密码；人机验证中继）
 */
import { z } from 'zod';
import { IsoDateTimeSchema, LoginIdSchema } from './common.js';

export const LoginModeSchema = z.enum(['app-qr', 'wechat-qr', 'sms', 'password']).meta({ id: 'LoginMode' });
export type LoginMode = z.infer<typeof LoginModeSchema>;

export const LoginStateSchema = z
  .enum([
    'starting',
    'awaiting_scan',
    'awaiting_confirm',
    'awaiting_captcha',
    'awaiting_sms_code',
    'logged_in',
    'failed',
    'expired',
    'cancelled',
  ])
  .meta({ id: 'LoginState' });
export type LoginState = z.infer<typeof LoginStateSchema>;

export const ImageSizeSchema = z.object({ width: z.number().int().positive(), height: z.number().int().positive() });

export const QrChallengeSchema = z
  .object({
    pngBase64: z.string().describe('二维码图片 Base64（上游为 JPEG，仍放在 data URL 中）'),
    image: ImageSizeSchema,
    expiresAt: IsoDateTimeSchema,
  })
  .meta({ id: 'QrChallenge' });

export const SmsChallengeSchema = z
  .object({
    codeSentAt: IsoDateTimeSchema.optional(),
    resendAfterSec: z.number().int().nonnegative().optional(),
  })
  .meta({ id: 'SmsChallenge' });

export const BoxSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

export const VerificationKindSchema = z.enum(['edgeone', 'geetest', 'nc']).meta({ id: 'VerificationKind' });

export const VerificationChallengeSchema = z
  .object({
    kind: VerificationKindSchema,
    prompt: z.string().optional(),
    url: z.string().optional().describe('EdgeOne 挑战所在页面 URL'),
    image: ImageSizeSchema.optional(),
    screenshotBase64: z.string().optional(),
    mainBase64: z.string().optional().describe('极验主图 Base64'),
    tipBase64: z.string().optional().describe('极验提示图 Base64'),
    iframe: z.object({ selector: z.string(), box: BoxSchema.optional() }).optional(),
    checkbox: z.object({ selector: z.string(), box: BoxSchema.optional() }).optional(),
    expiresAt: IsoDateTimeSchema,
  })
  .meta({ id: 'VerificationChallenge' });

export type VerificationChallenge = z.infer<typeof VerificationChallengeSchema>;

export const LoginSessionSchema = z
  .object({
    loginId: LoginIdSchema,
    mode: LoginModeSchema,
    state: LoginStateSchema,
    phoneMasked: z.string().optional(),
    qr: QrChallengeSchema.nullable().optional(),
    sms: SmsChallengeSchema.nullable().optional(),
    verification: VerificationChallengeSchema.nullable().optional(),
    expiresAt: IsoDateTimeSchema,
    message: z.string().optional(),
  })
  .meta({ id: 'LoginSession' });

export type LoginSession = z.infer<typeof LoginSessionSchema>;

export const LoginStartRequestSchema = z
  .object({
    mode: LoginModeSchema.optional(),
    phone: z.string().regex(/^1[3-9]\d{9}$/).optional(),
    relay: z.boolean().optional().describe('仅获取登录会话信息（二维码等），不等待完成'),
  })
  .meta({ id: 'LoginStartRequest' });

export type LoginStartRequest = z.infer<typeof LoginStartRequestSchema>;

export const LoginSmsRequestSchema = z.object({ code: z.string().regex(/^\d{4,8}$/) }).meta({ id: 'LoginSmsRequest' });

export const EdgeSolveSchema = z
  .object({
    kind: z.literal('edgeone'),
    auto: z.boolean().optional(),
    points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).optional(),
  })
  .refine((v) => v.auto === true || (v.points !== undefined && v.points.length > 0), {
    message: 'edgeone 需要 auto=true 或 points',
  });

export const GeetestSolveSchema = z
  .object({
    kind: z.literal('geetest'),
    points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).optional(),
    offsetRatio: z.number().min(0).max(1).optional(),
    offsetPx: z.number().min(0).optional(),
  })
  .refine((v) => v.points !== undefined || v.offsetRatio !== undefined || v.offsetPx !== undefined, {
    message: 'geetest 需要 points 或 offsetRatio/offsetPx',
  });

export const NcSolveSchema = z
  .object({
    kind: z.literal('nc'),
    points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).optional(),
  })
  .meta({ id: 'NcSolve' });

export const VerificationSolveRequestSchema = z
  .discriminatedUnion('kind', [EdgeSolveSchema, GeetestSolveSchema, NcSolveSchema])
  .meta({ id: 'VerificationSolveRequest' });

export type VerificationSolveRequest = z.infer<typeof VerificationSolveRequestSchema>;

export const VerificationStatusSchema = z
  .object({
    pending: z.boolean(),
    kind: VerificationKindSchema.nullable().optional(),
    challenge: VerificationChallengeSchema.nullable().optional(),
    message: z.string().optional(),
  })
  .meta({ id: 'VerificationStatus' });

export const VerificationSolveResponseSchema = z
  .object({
    solved: z.boolean(),
    verification: VerificationStatusSchema,
    message: z.string().optional(),
  })
  .meta({ id: 'VerificationSolveResponse' });

export const LoginCancelResponseSchema = z
  .object({ loginId: LoginIdSchema, state: z.literal('cancelled') })
  .meta({ id: 'LoginCancelResponse' });

export type LoginSessionPublic = LoginSession;
export type QrChallenge = z.infer<typeof QrChallengeSchema>;
export type VerificationChallengePublic = VerificationChallenge;


export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;
export type VerificationSolveResponse = z.infer<typeof VerificationSolveResponseSchema>;
