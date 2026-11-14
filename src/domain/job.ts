/**
 * 职位领域模型
 */
import { z } from 'zod';
import { BusinessInfoSchema } from './business.js';
import { CityCodeSchema, CompanyNumberSchema, IsoDateTimeSchema, PositionNumberSchema } from './common.js';

export const RecruiterSchema = z
  .object({
    name: z.string().optional(),
    title: z.string().optional(),
    online: z.boolean().optional(),
    avatar: z.string().optional(),
    activity: z.array(z.string()).optional(),
  })
  .meta({ id: 'Recruiter' });

export const JobCompanySchema = z
  .object({
    companyNumber: CompanyNumberSchema.optional(),
    name: z.string().optional(),
    industry: z.string().optional(),
    size: z.string().optional(),
    financingStage: z.string().optional(),
    logo: z.string().optional(),
  })
  .meta({ id: 'JobCompany' });

export const JobSummarySchema = z
  .object({
    positionNumber: PositionNumberSchema,
    jobId: z.number().optional(),
    title: z.string(),
    salaryText: z.string().default(''),
    salaryMin: z.number().nonnegative().optional(),
    salaryMax: z.number().nonnegative().optional(),
    salaryType: z.number().optional(),
    education: z.string().default(''),
    experience: z.string().default(''),
    workType: z.string().optional(),
    cityCode: CityCodeSchema.optional(),
    cityName: z.string().optional(),
    district: z.string().optional(),
    publishTime: IsoDateTimeSchema.optional(),
    companyNumber: CompanyNumberSchema,
    companyName: z.string(),
    companyIndustry: z.string().optional(),
    companySize: z.string().optional(),
    financingStage: z.string().nullable().optional(),
    jobSummary: z.string().optional(),
    recruiterName: z.string().optional(),
    jobUrl: z.string().url(),
    firstSeenAt: IsoDateTimeSchema,
    lastSeenAt: IsoDateTimeSchema,
  })
  .meta({ id: 'JobSummary' });

export type JobSummary = z.infer<typeof JobSummarySchema>;

export const JobBriefSchema = z
  .object({
    positionNumber: PositionNumberSchema,
    title: z.string(),
    salaryText: z.string().default(''),
    cityName: z.string().optional(),
    publishTime: IsoDateTimeSchema.optional(),
  })
  .meta({ id: 'JobBrief' });

export const JobDetailSchema = z
  .object({
    positionNumber: PositionNumberSchema,
    jobId: z.number().optional(),
    title: z.string(),
    salaryText: z.string().default(''),
    salaryMin: z.number().nonnegative().optional(),
    salaryMax: z.number().nonnegative().optional(),
    salaryType: z.number().optional(),
    education: z.string().default(''),
    experience: z.string().default(''),
    workType: z.string().optional(),
    cityCode: CityCodeSchema.optional(),
    cityName: z.string().optional(),
    district: z.string().optional(),
    address: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    description: z.string().default(''),
    labels: z.array(z.string()).default([]),
    welfareTags: z.array(z.string()).default([]),
    publishTime: IsoDateTimeSchema.optional(),
    recruiter: RecruiterSchema.default({}),
    company: JobCompanySchema.default({}),
    business: BusinessInfoSchema.optional(),
    jobUrl: z.string().url(),
    fetchedAt: IsoDateTimeSchema,
  })
  .meta({ id: 'JobDetail' });

export type JobDetail = z.infer<typeof JobDetailSchema>;
