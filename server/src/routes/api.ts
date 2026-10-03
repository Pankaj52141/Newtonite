import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import * as workItemService from '../domain/workItemService';
import { checkIdempotency, storeIdempotencyRecord } from '../domain/idempotencyService';
import {
  createWorkItemSchema,
  updateWorkItemSchema,
  transitionWorkItemSchema,
  assignWorkItemSchema,
  claimWorkItemSchema,
  approveWorkItemSchema,
  createCommentSchema,
  workItemQuerySchema,
  paginationQuerySchema,
} from '../validation/schemas';
import { WorkItemPriority } from '@prisma/client';

const router = Router();

/**
 * Async route wrapper to catch errors and pass to error handler.
 */
function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

// ─── User / Auth Routes ──────────────────────────────────────────────

/** GET /api/me — Current user info */
router.get('/me', asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId! },
    select: {
      id: true,
      name: true,
      email: true,
      teamMemberships: {
        select: {
          role: true,
          team: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!user) {
    return res.status(404).json({
      error: { code: 'USER_NOT_FOUND', message: 'User not found', requestId: req.requestId },
    });
  }

  res.json(user);
}));

/** GET /api/users — List all users (for user switcher and assignment) */
router.get('/users', asyncHandler(async (_req, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      teamMemberships: {
        select: {
          role: true,
          team: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  res.json(users);
}));

// ─── Team Routes ─────────────────────────────────────────────────────

/** GET /api/teams — List all teams */
router.get('/teams', asyncHandler(async (_req, res) => {
  const teams = await prisma.team.findMany({
    select: {
      id: true,
      name: true,
      description: true,
      memberships: {
        select: {
          role: true,
          user: { select: { id: true, name: true, email: true } },
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  res.json(teams);
}));

// ─── Work Item Routes ────────────────────────────────────────────────

/** GET /api/work-items — Paginated, filtered list */
router.get('/work-items', asyncHandler(async (req, res) => {
  const query = workItemQuerySchema.parse(req.query);
  const result = await workItemService.listWorkItems(query, req.userId!);
  res.json(result);
}));

/** GET /api/work-items/counts — Dashboard counts */
router.get('/work-items/counts', asyncHandler(async (req, res) => {
  const counts = await workItemService.getDashboardCounts(req.userId!);
  res.json(counts);
}));

/** POST /api/work-items — Create work item (with idempotency support) */
router.post('/work-items', asyncHandler(async (req, res) => {
  const input = createWorkItemSchema.parse(req.body);
  const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

  // Check idempotency if key provided
  if (idempotencyKey) {
    const existing = await checkIdempotency(idempotencyKey, req.userId!, 'POST /work-items', req.body);
    if (existing) {
      return res.status(existing.responseStatus).json(existing.responseBody);
    }
  }

  const workItem = await workItemService.createWorkItem(input, req.userId!);

  // Store idempotency record
  if (idempotencyKey) {
    await storeIdempotencyRecord(
      idempotencyKey,
      req.userId!,
      'POST /work-items',
      req.body,
      201,
      workItem,
    );
  }

  res.status(201).json(workItem);
}));

/** GET /api/work-items/:id — Work item detail */
router.get('/work-items/:id', asyncHandler(async (req, res) => {
  const workItem = await workItemService.getWorkItemById(req.params.id as string, req.userId!);
  res.json(workItem);
}));

/** PATCH /api/work-items/:id — Update work item (title, description) */
router.patch('/work-items/:id', asyncHandler(async (req, res) => {
  const input = updateWorkItemSchema.parse(req.body);
  const workItem = await workItemService.updateWorkItem(req.params.id as string, input, req.userId!);
  res.json(workItem);
}));

/** POST /api/work-items/:id/claim — Atomic claim */
router.post('/work-items/:id/claim', asyncHandler(async (req, res) => {
  const input = claimWorkItemSchema.parse(req.body);
  const workItem = await workItemService.claimWorkItem(req.params.id as string, req.userId!, input.expectedVersion);
  res.json(workItem);
}));

/** POST /api/work-items/:id/unclaim — Release assignment */
router.post('/work-items/:id/unclaim', asyncHandler(async (req, res) => {
  const { expectedVersion } = req.body;
  if (!expectedVersion) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'expectedVersion is required', requestId: req.requestId },
    });
  }
  const workItem = await workItemService.unclaimWorkItem(req.params.id as string, req.userId!, expectedVersion);
  res.json(workItem);
}));

/** POST /api/work-items/:id/assign — Manager assigns work */
router.post('/work-items/:id/assign', asyncHandler(async (req, res) => {
  const input = assignWorkItemSchema.parse(req.body);
  const workItem = await workItemService.assignWorkItem(
    req.params.id as string,
    input.assigneeId,
    input.expectedVersion,
    req.userId!,
  );
  res.json(workItem);
}));

/** POST /api/work-items/:id/transition — Status transition */
router.post('/work-items/:id/transition', asyncHandler(async (req, res) => {
  const input = transitionWorkItemSchema.parse(req.body);
  const workItem = await workItemService.transitionWorkItem(
    req.params.id as string,
    input.status,
    input.expectedVersion,
    req.userId!,
  );
  res.json(workItem);
}));

/** POST /api/work-items/:id/approve — Manager approves (with idempotency) */
router.post('/work-items/:id/approve', asyncHandler(async (req, res) => {
  const input = approveWorkItemSchema.parse(req.body);
  const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

  if (idempotencyKey) {
    const existing = await checkIdempotency(idempotencyKey, req.userId!, `POST /work-items/${req.params.id as string}/approve`, req.body);
    if (existing) {
      return res.status(existing.responseStatus).json(existing.responseBody);
    }
  }

  const workItem = await workItemService.transitionWorkItem(
    req.params.id as string,
    'RESOLVED',
    input.expectedVersion,
    req.userId!,
  );

  if (idempotencyKey) {
    await storeIdempotencyRecord(
      idempotencyKey,
      req.userId!,
      `POST /work-items/${req.params.id as string}/approve`,
      req.body,
      200,
      workItem,
    );
  }

  res.json(workItem);
}));

/** POST /api/work-items/:id/priority — Change priority (manager only) */
router.post('/work-items/:id/priority', asyncHandler(async (req, res) => {
  const { priority, expectedVersion } = req.body;
  if (!priority || !expectedVersion) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'priority and expectedVersion are required', requestId: req.requestId },
    });
  }
  const workItem = await workItemService.changePriority(
    req.params.id as string,
    priority as WorkItemPriority,
    expectedVersion,
    req.userId!,
  );
  res.json(workItem);
}));

// ─── Comment Routes ──────────────────────────────────────────────────

/** GET /api/work-items/:id/comments — Paginated comments */
router.get('/work-items/:id/comments', asyncHandler(async (req, res) => {
  const { page, pageSize } = paginationQuerySchema.parse(req.query);
  const result = await workItemService.getComments(req.params.id as string, req.userId!, page, pageSize);
  res.json(result);
}));

/** POST /api/work-items/:id/comments — Add comment */
router.post('/work-items/:id/comments', asyncHandler(async (req, res) => {
  const input = createCommentSchema.parse(req.body);
  const comment = await workItemService.addComment(req.params.id as string, input.body, req.userId!);
  res.status(201).json(comment);
}));

// ─── Activity Routes ─────────────────────────────────────────────────

/** GET /api/work-items/:id/activity — Paginated activity timeline */
router.get('/work-items/:id/activity', asyncHandler(async (req, res) => {
  const { page, pageSize } = paginationQuerySchema.parse(req.query);
  const result = await workItemService.getActivityEvents(req.params.id as string, req.userId!, page, pageSize);
  res.json(result);
}));

export default router;
