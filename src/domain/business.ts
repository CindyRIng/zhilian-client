/**
 * 公司工商信息领域模型（职位详情与公司详情共用，避免循环依赖）
 */
import { z } from 'zod';

export const BusinessInfoSchema = z
  .object({
    registeredName: z.string().optional(),
    uscc: z.string().optional().describe('统一社会信用代码（epCertNo）'),
    legalPerson: z.string().optional(),
    registeredCapital: z.string().optional(),
    companyType: z.string().optional(),
    businessStatus: z.string().optional(),
    createDate: z.string().optional(),
    registeredOrg: z.string().optional(),
    location: z.string().optional(),
    registeredAddress: z.string().optional(),
    businessScope: z.string().optional(),
    businessPeriod: z.string().optional(),
    creditLevel: z.string().optional(),
    industry: z.string().optional(),
    textDerived: z.literal(true).default(true),
  })
  .meta({ id: 'BusinessInfo' });

export type BusinessInfo = z.infer<typeof BusinessInfoSchema>;

export const EMPTY_BUSINESS: BusinessInfo = { textDerived: true };
