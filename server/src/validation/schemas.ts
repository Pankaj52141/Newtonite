import { z } from 'zod';
import { WorkItemStatus, WorkItemPriority } from '@prisma/client';

// ─── Work Item Schemas ───────────────────────────────────────────────

export const createWorkItemSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(250, 'Title must be at most 250 characters'),
  description: z.string().max(10000, 'Description too long').optional().default(''),
  priority: z.nativeEnum(WorkItemPriority),
  teamId: z.string().uuid('Invalid team ID'),
});

export const updateWorkItemSchema = z.object({
  title: z.string().min(3).max(250).optional(),
  description: z.string().max(10000).optional(),
  expectedVersion: z.number().int().positive('Expected version must be a positive integer'),
});

export const transitionWorkItemSchema = z.object({
  status: z.nativeEnum(WorkItemStatus),
  expectedVersion: z.number().int().positive(),
});

export const assignWorkItemSchema = z.object({
  assigneeId: z.string().uuid('Invalid assignee ID'),
  expectedVersion: z.number().int().positive(),
});

export const claimWorkItemSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
});

export const approveWorkItemSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

// ─── Comment Schemas ──────────────────────────────────────────────────

export const createCommentSchema = z.object({
  body: z.string().min(1, 'Comment cannot be empty').max(5000, 'Comment too long'),
});

// ─── Query Schemas ────────────────────────────────────────────────────

export const workItemQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().optional(),
  status: z.nativeEnum(WorkItemStatus).optional(),
  priority: z.nativeEnum(WorkItemPriority).optional(),
  teamId: z.string().uuid().optional(),
  assigneeId: z.string().uuid().optional(),
  unassigned: z.coerce.boolean().optional(),
  sortBy: z.enum(['updatedAt', 'createdAt', 'priority', 'status']).default('updatedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  view: z.enum(['all', 'mine', 'unassigned', 'critical', 'pending_approval', 'recently_updated']).optional(),
});

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type CreateWorkItemInput = z.infer<typeof createWorkItemSchema>;
export type UpdateWorkItemInput = z.infer<typeof updateWorkItemSchema>;
export type TransitionWorkItemInput = z.infer<typeof transitionWorkItemSchema>;
export type AssignWorkItemInput = z.infer<typeof assignWorkItemSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type WorkItemQueryInput = z.infer<typeof workItemQuerySchema>;
