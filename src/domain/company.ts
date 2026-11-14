/**
 * 公司领域模型
 */
import { z } from 'zod';
import { BusinessInfoSchema } from './business.js';
import { BooleanQuerySchema, CompanyNumberSchema, IsoDateTimeSchema, PageSchema, PageSizeSchema } from './common.js';
import { JobBriefSchema } from './job.js';

export const CompanySummarySchema = z
  .object({
    companyNumber: CompanyNumberSchema,
    name: z.string(),
    industry: z.string().optional(),
    size: z.string().optional(),
    financingStage: z.string().nullable().optional(),
    cityName: z.string().optional(),
    jobCount: z.number().int().nonnegative().default(0),
    matchedJobs: z.array(JobBriefSchema).default([]),
    firstSeenAt: IsoDateTimeSchema,
    lastSeenAt: IsoDateTimeSchema,
  })
  .meta({ id: 'CompanySummary' });

export type CompanySummary = z.infer<typeof CompanySummarySchema>;

export const CompanyJobSchema = z
  .object({
    positionNumber: z.string(),
    title: z.string(),
    salaryText: z.string().default(''),
    salaryMin: z.number().nonnegative().optional(),
    salaryMax: z.number().nonnegative().optional(),
    education: z.string().optional(),
    experience: z.string().optional(),
    cityName: z.string().optional(),
    district: z.string().optional(),
    publishTime: IsoDateTimeSchema.optional(),
    recruiterName: z.string().optional(),
    jobUrl: z.string().url(),
  })
  .meta({ id: 'CompanyJob' });

export type CompanyJob = z.infer<typeof CompanyJobSchema>;

export const CompanyDetailSchema = z
  .object({
    companyNumber: CompanyNumberSchema,
    name: z.string(),
    fullName: z.string().optional(),
    logo: z.string().optional(),
    industry: z.string().optional(),
    size: z.string().optional(),
    financingStage: z.string().optional(),
    cityName: z.string().optional(),
    address: z.string().optional(),
    coordinate: z.object({ latitude: z.number().optional(), longitude: z.number().optional() }).optional(),
    website: z.string().optional(),
    intro: z.string().optional(),
    tags: z.array(z.string()).default([]),
    benefits: z.array(z.string()).default([]),
    jobCount: z.number().int().nonnegative().default(0),
    hotJobs: z.array(CompanyJobSchema).default([]),
    business: BusinessInfoSchema.default({ textDerived: true }),
    url: z.string().url(),
    fetchedAt: IsoDateTimeSchema,
  })
  .meta({ id: 'CompanyDetail' });

export type CompanyDetail = z.infer<typeof CompanyDetailSchema>;

export const CompaniesListQuerySchema = z
  .object({
    queryId: z.string(),
    page: PageSchema,
    pageSize: PageSizeSchema,
    fetchPages: z.coerce.number().int().min(0).max(5).default(0),
    refresh: BooleanQuerySchema,
  })
  .meta({ id: 'CompaniesListQuery' });

export const CompanyDetailQuerySchema = z.object({ refresh: BooleanQuerySchema }).meta({ id: 'CompanyDetailQuery' });

export const CompanyJobsQuerySchema = z
  .object({
    page: PageSchema,
    refresh: BooleanQuerySchema,
  })
  .meta({ id: 'CompanyJobsQuery' });

export const CompanyJobsResponseSchema = z
  .object({
    companyNumber: CompanyNumberSchema,
    jobCount: z.number().int().nonnegative(),
    jobs: z.array(CompanyJobSchema),
    truncated: z.boolean().default(false),
  })
  .meta({ id: 'CompanyJobsResponse' });
