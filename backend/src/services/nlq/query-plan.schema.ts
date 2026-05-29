// T049：US2 NLQ QueryPlan zod schema
// 與 OpenAPI components.schemas.QueryPlan 對齊，含 8 個 intent 與 5 大統計（FR-022）

import { z } from 'zod';

export const QueryPlanIntentSchema = z.enum([
  'list_issues',
  'count_issues',
  'sum_story_points',
  'sum_actual_story_points',
  'avg_story_points',
  'avg_actual_story_points',
  'top_n_assignees',
  'group_count',
]);
export type QueryPlanIntent = z.infer<typeof QueryPlanIntentSchema>;

export const QueryPlanGroupBySchema = z.enum(['assignee', 'status', 'project', 'sprint', 'priority']);
export type QueryPlanGroupBy = z.infer<typeof QueryPlanGroupBySchema>;

const dateRange = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .strict();

const filters = z
  .object({
    projectKeys: z.array(z.string()).optional(),
    assigneeAccountIds: z.array(z.string()).optional(),
    statuses: z.array(z.string()).optional(),
    createdRange: dateRange.optional(),
    updatedRange: dateRange.optional(),
    sprintNames: z.array(z.string()).optional(),
    labels: z.array(z.string()).optional(),
  })
  .strict();

export const QueryPlanSchema = z
  .object({
    intent: QueryPlanIntentSchema,
    filters,
    groupBy: QueryPlanGroupBySchema.optional().nullable(),
    topN: z.number().int().min(1).max(50).optional().nullable(),
  })
  .strict()
  .superRefine((plan, ctx) => {
    if (plan.intent === 'top_n_assignees' && (plan.topN == null || plan.topN < 1)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'top_n_assignees 必須提供 topN' });
    }
    if (plan.intent === 'group_count' && (plan.groupBy == null)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'group_count 必須提供 groupBy' });
    }
  });

export type QueryPlan = z.infer<typeof QueryPlanSchema>;
