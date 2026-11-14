/**
 * 搜索/分页领域模型
 */
import { z } from 'zod';
import {
  BooleanQuerySchema,
  CityCodeSchema,
  IsoDateTimeSchema,
  PageSchema,
  PageSizeSchema,
  PagesSchema,
  QueryIdSchema,
  SortTypeSchema,
} from './common.js';
import { CompanySummarySchema } from './company.js';
import { JobSummarySchema } from './job.js';

export const PaginationSchema = z
  .object({
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    pagesFetched: z.number().int().nonnegative(),
    pagesAvailable: z.number().int().nonnegative(),
  })
  .meta({ id: 'Pagination' });

export type Pagination = z.infer<typeof PaginationSchema>;

export const SearchQuerySchema = z
  .object({
    queryId: QueryIdSchema,
    keyword: z.string(),
    cityCode: CityCodeSchema,
    cityName: z.string().optional(),
    sortType: SortTypeSchema,
    pageSize: z.number().int().min(1).max(100),
    pagesFetched: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    count: z.number().int().nonnegative(),
    anonymous: z.boolean(),
    fetchedAt: IsoDateTimeSchema,
  })
  .meta({ id: 'SearchQuery' });

export type SearchQuery = z.infer<typeof SearchQuerySchema>;

export const SearchJobsRequestSchema = z
  .object({
    keyword: z.string().min(1),
    cityCode: CityCodeSchema.optional(),
    page: PageSchema,
    pages: PagesSchema,
    order: z.number().int().min(0).max(99).default(4),
    sortType: SortTypeSchema.optional(),
    refresh: z.boolean().default(false),
  })
  .meta({ id: 'SearchJobsRequest' });

export type SearchJobsRequest = z.infer<typeof SearchJobsRequestSchema>;

export const SearchJobsResponseSchema = z
  .object({
    query: SearchQuerySchema,
    jobs: z.array(JobSummarySchema),
    companies: z.array(CompanySummarySchema),
    pagination: PaginationSchema,
  })
  .meta({ id: 'SearchJobsResponse' });

export const JobsListQuerySchema = z
  .object({
    queryId: z.string(),
    page: PageSchema,
    pageSize: PageSizeSchema.optional(),
    refresh: BooleanQuerySchema,
  })
  .meta({ id: 'JobsListQuery' });

export const JobsListResponseSchema = z
  .object({
    query: SearchQuerySchema,
    jobs: z.array(JobSummarySchema),
    pagination: PaginationSchema,
  })
  .meta({ id: 'JobsListResponse' });

export const JobDetailQuerySchema = z.object({ refresh: BooleanQuerySchema }).meta({ id: 'JobDetailQuery' });

export const CompaniesListResponseSchema = z
  .object({
    query: SearchQuerySchema,
    companies: z.array(CompanySummarySchema),
    pagination: PaginationSchema,
  })
  .meta({ id: 'CompaniesListResponse' });
