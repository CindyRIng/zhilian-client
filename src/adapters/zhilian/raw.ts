/**
 * 智联上游响应 zod schema（宽松 passthrough，字段变更有据可查）
 */
import { z } from 'zod';
import { ZhilianError } from '../../errors/catalog.js';

const Loose = z.object({}).passthrough();

export const RawPositionSchema = z
  .object({
    jobId: z.union([z.number(), z.string()]).optional(),
    positionId: z.union([z.number(), z.string()]).optional(),
    name: z.string().default(''),
    salaryReal: z.string().optional(),
    salary60: z.string().optional(),
    salaryType: z.number().optional(),
    cityId: z.union([z.string(), z.number()]).optional(),
    workCity: z.string().optional(),
    cityDistrict: z.string().optional(),
    education: z.string().optional(),
    workingExp: z.string().optional(),
    workType: z.string().optional(),
    publishTime: z.string().optional(),
    firstPublishTime: z.string().optional(),
    companyNumber: z.string().optional(),
    companyName: z.string().optional(),
    companyUrl: z.string().optional(),
    industryName: z.string().optional(),
    companySize: z.string().optional(),
    financingStage: z.unknown().optional(),
    jobSummary: z.string().optional(),
    positionURL: z.string().optional(),
    positionUrl: z.string().optional(),
    jobDetailData: Loose.optional(),
  })
  .passthrough();

export type RawPosition = z.infer<typeof RawPositionSchema>;

export const RawSearchStateSchema = z
  .object({
    queryParams: z
      .object({ kw: z.string().optional(), jl: z.string().optional(), p: z.string().optional(), order: z.union([z.number(), z.string()]).optional() })
      .passthrough()
      .optional(),
    positionList: z.array(RawPositionSchema).default([]),
    hasMore: z.boolean().optional(),
    pageIndex: z.number().optional(),
    pageSize: z.number().optional(),
    positionCount: z.number().optional(),
    user: Loose.optional(),
    resumeNumber: z.string().optional(),
    jobDetail: Loose.optional(),
  })
  .passthrough();

export type RawSearchState = z.infer<typeof RawSearchStateSchema>;

export const RawLoadMoreResponseSchema = z
  .object({
    code: z.union([z.number(), z.string()]),
    message: z.string().optional(),
    data: z
      .object({
        list: z.array(RawPositionSchema).default([]),
        isEndPage: z.union([z.number(), z.boolean()]).optional(),
        count: z.number().optional(),
        dataIdentity: z.string().optional(),
        sortTypes: z.array(z.object({ code: z.string(), name: z.string() })).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type RawLoadMoreResponse = z.infer<typeof RawLoadMoreResponseSchema>;

export const RawDetailedCompanySchema = z
  .object({
    companyNumber: z.string(),
    companyName: z.string().default(''),
    companyShotName: z.string().optional(),
    companySize: z.string().optional(),
    companyLogo: z.string().optional(),
    industryNameLevel: z.string().optional(),
    industryLevel: z.string().optional(),
    companyDescription: z.string().optional(),
    financingStageName: z.unknown().optional(),
    onlinePositionNumbers: z.number().optional(),
    companyUrl: z.string().optional(),
    url: z.string().optional(),
    status: z.string().optional(),
    companyId: z.number().optional(),
  })
  .passthrough();

export const RawDetailedPositionSchema = z
  .object({
    positionNumber: z.string(),
    positionId: z.number().optional(),
    positionName: z.string().default(''),
    positionUrl: z.string().optional(),
    url: z.string().optional(),
    salary: z.string().optional(),
    salaryType: z.number().optional(),
    education: z.string().optional(),
    positionWorkingExp: z.string().optional(),
    workType: z.string().optional(),
    description: z.string().optional(),
    jobDesc: z.string().optional(),
    labels: z.array(z.string()).optional(),
    welfareTags: z.array(z.string()).optional(),
    workAddress: z.string().optional(),
    latitude: z.union([z.string(), z.number()]).optional(),
    longitude: z.union([z.string(), z.number()]).optional(),
    positionCityId: z.union([z.string(), z.number()]).optional(),
    positionWorkCity: z.string().optional(),
    positionCityDistrict: z.string().optional(),
    positionPublishTime: z.string().optional(),
    publishTime: z.string().optional(),
    companyNumber: z.string().optional(),
    companyName: z.string().optional(),
    staff: Loose.optional(),
    customAttributeInfo: Loose.optional(),
    recruitNumber: z.number().optional(),
    jobStatus: z.union([z.number(), z.string()]).optional(),
    positionStatus: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();

export type RawDetailedPosition = z.infer<typeof RawDetailedPositionSchema>;

export const RawPositionDetailResponseSchema = z
  .object({
    code: z.union([z.number(), z.string()]),
    message: z.string().optional(),
    data: z
      .object({
        detailedCompany: RawDetailedCompanySchema,
        detailedPosition: RawDetailedPositionSchema,
        taskId: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type RawPositionDetailResponse = z.infer<typeof RawPositionDetailResponseSchema>;

export const RawJobDetailStateSchema = z
  .object({
    jobNumber: z.string().optional(),
    jobDetail: z
      .object({
        detailedCompany: RawDetailedCompanySchema.optional(),
        detailedPosition: RawDetailedPositionSchema.optional(),
      })
      .passthrough()
      .optional(),
    companyExtDetail: z
      .object({
        businessInformation: z
          .object({
            businessInformationData: z
              .object({
                registeredName: z.string().optional(),
                epCertNo: z.string().optional(),
                legalPerson: z.string().optional(),
                registeredCapital: z.string().optional(),
                epType: z.string().optional(),
                epStatus: z.string().optional(),
                createDate: z.string().optional(),
                registeredOrg: z.string().optional(),
                location: z.string().optional(),
                registeredAddress: z.string().optional(),
                businessScope: z.string().optional(),
                businessPeriod: z.string().optional(),
                creditLevel: z.string().optional(),
                industry: z.string().optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
    user: Loose.optional(),
  })
  .passthrough();

export type RawJobDetailState = z.infer<typeof RawJobDetailStateSchema>;

export const RawCompanyBaseSchema = z
  .object({
    companyName: z.string().default(''),
    companyShotName: z.string().optional(),
    companyNumber: z.string(),
    companyLogo: z.string().optional(),
    companySize: z.string().optional(),
    industryName: z.string().optional(),
    industryNameLevel: z.string().optional(),
    financingStageName: z.unknown().optional(),
    cityName: z.string().optional(),
    cityCode: z.union([z.string(), z.number()]).optional(),
    address: z.string().optional(),
    companyDescription: z.string().optional(),
    companyDescWithHtml: z.string().optional(),
    companyWebsiteUrl: z.string().optional(),
    coordinate: z.object({ latitude: z.union([z.string(), z.number()]).optional(), longitude: z.union([z.string(), z.number()]).optional() }).passthrough().optional(),
  })
  .passthrough();

export type RawCompanyBase = z.infer<typeof RawCompanyBaseSchema>;
export type RawDetailedCompany = z.infer<typeof RawDetailedCompanySchema>;

export const RawCompanyDetailStateSchema = z
  .object({
    companyName: z.string().optional(),
    companyCode: z.string().optional(),
    companyDetail: z
      .object({
        companyBase: RawCompanyBaseSchema.optional(),
        businessInformationData: z
          .object({
            businessInformationData: z
              .object({
                registeredName: z.string().optional(),
                epCertNo: z.string().optional(),
                legalPerson: z.string().optional(),
                registeredCapital: z.string().optional(),
                epType: z.string().optional(),
                epStatus: z.string().optional(),
                createDate: z.string().optional(),
                registeredOrg: z.string().optional(),
                location: z.string().optional(),
                registeredAddress: z.string().optional(),
                businessScope: z.string().optional(),
                businessPeriod: z.string().optional(),
                creditLevel: z.string().optional(),
                industry: z.string().optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough()
          .optional(),
        onlinePositionNumbers: z.number().optional(),
        companyImages: z.unknown().optional(),
        companyProducts: z.unknown().optional(),
        companyHonors: z.unknown().optional(),
      })
      .passthrough()
      .optional(),
    onlinePositions: z.array(RawPositionSchema).optional(),
    onlinePositionsCount: z.number().optional(),
    onlinePositionsPage: z.number().optional(),
  })
  .passthrough();

export type RawCompanyDetailState = z.infer<typeof RawCompanyDetailStateSchema>;

export const RawCompanyJobsStateSchema = z
  .object({
    companyName: z.string().optional(),
    companyCode: z.string().optional(),
    onlinePositions: z.array(RawPositionSchema).default([]),
    onlinePositionsCount: z.number().optional(),
    onlinePositionsPage: z.number().optional(),
    serverJobDetail: Loose.optional(),
  })
  .passthrough();

export type RawCompanyJobsState = z.infer<typeof RawCompanyJobsStateSchema>;

export const RawCheckTokenSchema = z.object({ code: z.union([z.number(), z.string()]), data: z.union([z.boolean(), z.unknown()]).optional() }).passthrough();

export const RawUserDetailSchema = z
  .object({
    code: z.union([z.number(), z.string()]),
    message: z.string().optional(),
    data: z
      .object({
        Id: z.union([z.number(), z.string()]).optional(),
        id: z.union([z.number(), z.string()]).optional(),
        userId: z.union([z.number(), z.string()]).optional(),
        Name: z.string().optional(),
        name: z.string().optional(),
        PhotoUrl: z.string().optional(),
        Resume: z.object({ ResumeNumber: z.string().optional() }).passthrough().optional(),
        currentIdentity: z.union([z.string(), z.number()]).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type RawUserDetail = z.infer<typeof RawUserDetailSchema>;

export const RawRefreshTokenSchema = z
  .object({
    code: z.union([z.number(), z.string()]),
    message: z.string().optional(),
    data: z
      .object({
        appID: z.string().optional(),
        at: z.string().optional(),
        atExpire: z.number().optional(),
        rt: z.string().optional(),
        rtExpire: z.number().optional(),
        userInfo: Loose.optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type RawRefreshToken = z.infer<typeof RawRefreshTokenSchema>;

export const RawAppScanInitSchema = z
  .object({
    code: z.union([z.number(), z.string()]),
    message: z.string().optional(),
    data: z.object({ path: z.string(), validateId: z.string() }).passthrough().optional(),
  })
  .passthrough();

export const RawAppScanPollSchema = z
  .object({
    code: z.union([z.number(), z.string()]),
    message: z.string().optional(),
    data: z.unknown().optional(),
  })
  .passthrough();

export const RawVerifyInitSchema = z
  .object({
    code: z.union([z.number(), z.string()]),
    message: z.string().optional(),
    data: z
      .object({
        riskLevel: z.number().optional(),
        validateId: z.string().optional(),
        needVerify: z.boolean().optional(),
        sessionId: z.string().optional(),
        geetestData: z.object({ success: z.boolean().optional(), challenge: z.string().optional(), gt: z.string().optional() }).passthrough().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const RawSmsInitSchema = z
  .object({
    code: z.union([z.number(), z.string()]),
    message: z.string().optional(),
    data: z.object({ validateId: z.string().optional(), isNewUser: z.boolean().optional() }).passthrough().optional(),
  })
  .passthrough();

export const RawEncryptKeySchema = z
  .object({ code: z.union([z.number(), z.string()]), data: z.object({ encryptKey: z.string() }).passthrough().optional() })
  .passthrough();

export const RawBaseDataSchema = z
  .object({
    code: z.union([z.number(), z.string()]),
    data: z
      .object({
        allCity: z
          .array(
            z
              .object({
                code: z.union([z.string(), z.number()]),
                parentCode: z.union([z.string(), z.number()]).nullable().optional(),
                name: z.string().optional(),
                en_name: z.string().optional(),
                sublist: z.array(z.unknown()).optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export function okCode(code: unknown): boolean {
  return code === 0 || code === 200 || code === '0' || code === '200' || code === 100000;
}

export function assertOk(json: unknown, what: string): void {
  const parsed = z.object({ code: z.union([z.number(), z.string()]) }).passthrough().safeParse(json);
  if (!parsed.success || !okCode(parsed.data.code)) {
    throw new ZhilianError('UPSTREAM_CHANGED', `${what} 返回异常：${JSON.stringify(json).slice(0, 300)}`);
  }
}


