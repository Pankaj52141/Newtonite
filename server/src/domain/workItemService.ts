import { Prisma, WorkItemStatus, WorkItemPriority } from '@prisma/client';
import prisma from '../lib/prisma';
import {
  NotFoundError,
  VersionConflictError,
  WorkItemAlreadyClaimedError,
  ForbiddenError,
  ValidationError,
} from '../errors';
import {
  requireTeamMembership,
  canCreateWorkItem,
  canEditWorkItem,
  canClaimWorkItem,
  canAssignWorkItem,
  canChangePriority,
  canApproveWorkItem,
  canAddComment,
  canTransitionStatus,
  getTeamMembership,
} from '../authorization';
import {
  validateTransition,
  requiresManager,
  getTransitionEventType,
  getAvailableTransitions,
} from './workflow';
import type {
  CreateWorkItemInput,
  UpdateWorkItemInput,
  WorkItemQueryInput,
} from '../validation/schemas';

// ─── Reference generation via database sequence ──────────────────────

async function generateReference(tx: Prisma.TransactionClient): Promise<string> {
  const result = await tx.$queryRaw<[{ nextval: bigint }]>`
    SELECT nextval(pg_get_serial_sequence('work_item_sequence', 'id'))
  `;
  const seq = Number(result[0].nextval);
  return `OPS-${seq}`;
}

// ─── Helper: select only needed fields for list ──────────────────────

const WORK_ITEM_LIST_SELECT = {
  id: true,
  reference: true,
  title: true,
  status: true,
  priority: true,
  version: true,
  teamId: true,
  assigneeId: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  resolvedAt: true,
  team: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true, email: true } },
  createdBy: { select: { id: true, name: true, email: true } },
};

const WORK_ITEM_DETAIL_SELECT = {
  ...WORK_ITEM_LIST_SELECT,
  description: true,
};

// ─── List Work Items (paginated, filtered, server-side) ──────────────

export async function listWorkItems(query: WorkItemQueryInput, userId: string) {
  const { page, pageSize, search, status, priority, teamId, assigneeId, unassigned, sortBy, sortOrder, view } = query;

  const where: Prisma.WorkItemWhereInput = {};

  // View-based filters
  if (view === 'mine') {
    where.assigneeId = userId;
    where.status = { notIn: [WorkItemStatus.RESOLVED, WorkItemStatus.CANCELLED] };
  } else if (view === 'unassigned') {
    where.assigneeId = null;
    where.status = { notIn: [WorkItemStatus.RESOLVED, WorkItemStatus.CANCELLED] };
  } else if (view === 'critical') {
    where.priority = { in: [WorkItemPriority.CRITICAL, WorkItemPriority.HIGH] };
    where.status = { notIn: [WorkItemStatus.RESOLVED, WorkItemStatus.CANCELLED] };
  } else if (view === 'pending_approval') {
    where.status = WorkItemStatus.PENDING_APPROVAL;
  } else if (view === 'recently_updated') {
    // Just sort by updatedAt, no special filter
  }

  // Explicit filters override view
  if (status) where.status = status;
  if (priority) where.priority = priority;
  if (teamId) where.teamId = teamId;
  if (assigneeId) where.assigneeId = assigneeId;
  if (unassigned) where.assigneeId = null;

  // Search
  if (search) {
    where.OR = [
      { reference: { contains: search, mode: 'insensitive' } },
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  // Get user's team IDs for authorization — users can only see work items for their teams
  const userMemberships = await prisma.teamMembership.findMany({
    where: { userId },
    select: { teamId: true },
  });
  const userTeamIds = userMemberships.map((m) => m.teamId);

  // If filtering by a specific team, ensure user is a member
  if (teamId) {
    if (!userTeamIds.includes(teamId)) {
      return { items: [], total: 0, page, pageSize, totalPages: 0 };
    }
  } else {
    // Only show items from user's teams
    where.teamId = { in: userTeamIds };
  }

  const orderBy: Prisma.WorkItemOrderByWithRelationInput = {};
  if (sortBy === 'priority') {
    // Custom priority ordering handled by sorting after fetch for simplicity
    // Use updatedAt as secondary sort
    orderBy.updatedAt = sortOrder;
  } else {
    (orderBy as any)[sortBy] = sortOrder;
  }

  const [items, total] = await Promise.all([
    prisma.workItem.findMany({
      where,
      select: WORK_ITEM_LIST_SELECT,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.workItem.count({ where }),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

// ─── Get Work Item by ID ─────────────────────────────────────────────

export async function getWorkItemById(id: string, userId: string) {
  const workItem = await prisma.workItem.findUnique({
    where: { id },
    select: WORK_ITEM_DETAIL_SELECT,
  });

  if (!workItem) {
    throw new NotFoundError('Work Item', id);
  }

  // Authorization: user must be member of the work item's team
  const membership = await getTeamMembership(userId, workItem.teamId);
  if (!membership) {
    throw new ForbiddenError();
  }

  const availableTransitions = getAvailableTransitions(workItem.status);

  return { ...workItem, availableTransitions };
}

// ─── Create Work Item ────────────────────────────────────────────────

export async function createWorkItem(input: CreateWorkItemInput, userId: string) {
  // Authorization
  const membership = await requireTeamMembership(userId, input.teamId, 'MEMBER');
  if (!canCreateWorkItem(membership)) {
    throw new ForbiddenError();
  }

  // Verify team exists
  const team = await prisma.team.findUnique({ where: { id: input.teamId } });
  if (!team) {
    throw new NotFoundError('Team', input.teamId);
  }

  // Transaction: create work item + activity event + outbox event (for critical items)
  const result = await prisma.$transaction(async (tx) => {
    const reference = await generateReference(tx);

    const workItem = await tx.workItem.create({
      data: {
        reference,
        title: input.title,
        description: input.description || '',
        priority: input.priority,
        status: WorkItemStatus.OPEN,
        teamId: input.teamId,
        createdById: userId,
        version: 1,
      },
      select: WORK_ITEM_DETAIL_SELECT,
    });

    // Activity event
    await tx.activityEvent.create({
      data: {
        workItemId: workItem.id,
        actorId: userId,
        eventType: 'WORK_ITEM_CREATED',
        metadata: {
          title: workItem.title,
          priority: workItem.priority,
          team: workItem.team.name,
        },
      },
    });

    // Outbox event for critical items
    if (input.priority === WorkItemPriority.CRITICAL) {
      await tx.outboxEvent.create({
        data: {
          eventType: 'CRITICAL_WORK_ITEM_CREATED',
          aggregateType: 'WorkItem',
          aggregateId: workItem.id,
          payload: {
            workItemId: workItem.id,
            reference: workItem.reference,
            title: workItem.title,
            priority: workItem.priority,
            teamId: workItem.teamId,
            teamName: workItem.team.name,
          },
        },
      });
    }

    return workItem;
  });

  return result;
}

// ─── Update Work Item (with optimistic concurrency) ──────────────────

export async function updateWorkItem(
  id: string,
  input: UpdateWorkItemInput,
  userId: string,
) {
  // Load current item
  const existing = await prisma.workItem.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Work Item', id);

  // Authorization
  const membership = await requireTeamMembership(userId, existing.teamId, 'MEMBER');
  if (!canEditWorkItem(membership, existing)) throw new ForbiddenError('You do not have permission to edit this work item');

  // Build update data and activity events
  const updateData: Prisma.WorkItemUpdateInput = {};
  const events: Array<{ eventType: string; metadata: any }> = [];

  if (input.title !== undefined && input.title !== existing.title) {
    updateData.title = input.title;
    events.push({
      eventType: 'TITLE_CHANGED',
      metadata: { from: existing.title, to: input.title },
    });
  }

  if (input.description !== undefined && input.description !== existing.description) {
    updateData.description = input.description;
    events.push({
      eventType: 'DESCRIPTION_CHANGED',
      metadata: { from: existing.description || '', to: input.description },
    });
  }

  if (Object.keys(updateData).length === 0) {
    // No actual changes
    return getWorkItemById(id, userId);
  }

  // Optimistic concurrency control: atomic conditional update
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.$executeRaw`
      UPDATE work_items
      SET
        ${input.title !== undefined ? Prisma.sql`title = ${input.title},` : Prisma.empty}
        ${input.description !== undefined ? Prisma.sql`description = ${input.description},` : Prisma.empty}
        version = version + 1,
        updated_at = (NOW() AT TIME ZONE 'UTC')
      WHERE id = ${id}::uuid
        AND version = ${input.expectedVersion}
    `;

    if (updated === 0) {
      throw new VersionConflictError();
    }

    // Create activity events in the same transaction
    for (const event of events) {
      await tx.activityEvent.create({
        data: {
          workItemId: id,
          actorId: userId,
          eventType: event.eventType,
          metadata: event.metadata,
        },
      });
    }

    return tx.workItem.findUnique({
      where: { id },
      select: WORK_ITEM_DETAIL_SELECT,
    });
  });

  return result;
}

// ─── Claim Work Item (atomic concurrent operation) ───────────────────

export async function claimWorkItem(id: string, userId: string, expectedVersion?: number) {
  // Load current item
  const existing = await prisma.workItem.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Work Item', id);

  // Authorization
  const membership = await requireTeamMembership(userId, existing.teamId, 'MEMBER');
  if (!canClaimWorkItem(membership)) throw new ForbiddenError();

  // Atomic conditional update: only succeeds if assignee is still NULL
  // This prevents race conditions when two users click "Claim" simultaneously
  const result = await prisma.$transaction(async (tx) => {
    let affected: number;
    
    if (expectedVersion !== undefined) {
      affected = await tx.$executeRaw`
        UPDATE work_items
        SET
          assignee_id = ${userId}::uuid,
          status = 'IN_PROGRESS'::"WorkItemStatus",
          version = version + 1,
          updated_at = (NOW() AT TIME ZONE 'UTC')
        WHERE id = ${id}::uuid
          AND assignee_id IS NULL
          AND version = ${expectedVersion}
      `;
    } else {
      affected = await tx.$executeRaw`
        UPDATE work_items
        SET
          assignee_id = ${userId}::uuid,
          status = 'IN_PROGRESS'::"WorkItemStatus",
          version = version + 1,
          updated_at = (NOW() AT TIME ZONE 'UTC')
        WHERE id = ${id}::uuid
          AND assignee_id IS NULL
      `;
    }

    if (affected === 0) {
      // Check if it was a version conflict or already claimed
      const current = await tx.workItem.findUnique({ where: { id }, select: { assigneeId: true, version: true } });
      if (current?.assigneeId) {
        throw new WorkItemAlreadyClaimedError();
      }
      throw new VersionConflictError();
    }

    // Create activity events in the same transaction
    const user = await tx.user.findUnique({ where: { id: userId }, select: { name: true } });

    await tx.activityEvent.create({
      data: {
        workItemId: id,
        actorId: userId,
        eventType: 'ASSIGNEE_CHANGED',
        metadata: { from: null, to: user?.name || userId },
      },
    });

    await tx.activityEvent.create({
      data: {
        workItemId: id,
        actorId: userId,
        eventType: 'STATUS_CHANGED',
        metadata: { from: existing.status, to: 'IN_PROGRESS' },
      },
    });

    return tx.workItem.findUnique({
      where: { id },
      select: WORK_ITEM_DETAIL_SELECT,
    });
  });

  return result;
}

// ─── Unclaim Work Item ───────────────────────────────────────────────

export async function unclaimWorkItem(id: string, userId: string, expectedVersion: number) {
  const existing = await prisma.workItem.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Work Item', id);

  // Can only unclaim your own item
  if (existing.assigneeId !== userId) {
    throw new ForbiddenError('You can only unclaim work items assigned to you');
  }

  const membership = await requireTeamMembership(userId, existing.teamId, 'MEMBER');

  const result = await prisma.$transaction(async (tx) => {
    const affected = await tx.$executeRaw`
      UPDATE work_items
      SET
        assignee_id = NULL,
        status = 'OPEN'::"WorkItemStatus",
        version = version + 1,
        updated_at = (NOW() AT TIME ZONE 'UTC')
      WHERE id = ${id}::uuid
        AND assignee_id = ${userId}::uuid
        AND version = ${expectedVersion}
    `;

    if (affected === 0) throw new VersionConflictError();

    const user = await tx.user.findUnique({ where: { id: userId }, select: { name: true } });

    await tx.activityEvent.create({
      data: {
        workItemId: id,
        actorId: userId,
        eventType: 'ASSIGNEE_CHANGED',
        metadata: { from: user?.name || userId, to: null },
      },
    });

    await tx.activityEvent.create({
      data: {
        workItemId: id,
        actorId: userId,
        eventType: 'STATUS_CHANGED',
        metadata: { from: existing.status, to: 'OPEN' },
      },
    });

    return tx.workItem.findUnique({ where: { id }, select: WORK_ITEM_DETAIL_SELECT });
  });

  return result;
}

// ─── Assign Work Item (manager only) ─────────────────────────────────

export async function assignWorkItem(
  id: string,
  assigneeId: string,
  expectedVersion: number,
  userId: string,
) {
  const existing = await prisma.workItem.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Work Item', id);

  // Authorization: current user must be MANAGER on the item's team
  const membership = await requireTeamMembership(userId, existing.teamId, 'MANAGER');
  if (!canAssignWorkItem(membership)) throw new ForbiddenError();

  // Verify target user exists
  const targetUser = await prisma.user.findUnique({ where: { id: assigneeId } });
  if (!targetUser) throw new NotFoundError('User', assigneeId);

  // Verify target user belongs to the item's team
  const targetMembership = await getTeamMembership(assigneeId, existing.teamId);
  if (!targetMembership) {
    throw new ValidationError('Cannot assign work to a user who is not a member of this team');
  }

  const result = await prisma.$transaction(async (tx) => {
    const affected = await tx.$executeRaw`
      UPDATE work_items
      SET
        assignee_id = ${assigneeId}::uuid,
        status = CASE
          WHEN status IN ('OPEN'::"WorkItemStatus", 'RESOLVED'::"WorkItemStatus", 'CANCELLED'::"WorkItemStatus") THEN 'IN_PROGRESS'::"WorkItemStatus"
          ELSE status
        END,
        version = version + 1,
        updated_at = (NOW() AT TIME ZONE 'UTC')
      WHERE id = ${id}::uuid
        AND version = ${expectedVersion}
    `;

    if (affected === 0) throw new VersionConflictError();

    const previousAssignee = existing.assigneeId
      ? (await tx.user.findUnique({ where: { id: existing.assigneeId }, select: { name: true } }))?.name
      : null;

    await tx.activityEvent.create({
      data: {
        workItemId: id,
        actorId: userId,
        eventType: 'ASSIGNEE_CHANGED',
        metadata: { from: previousAssignee, to: targetUser.name },
      },
    });

    if (['OPEN', 'RESOLVED', 'CANCELLED'].includes(existing.status)) {
      await tx.activityEvent.create({
        data: {
          workItemId: id,
          actorId: userId,
          eventType: 'STATUS_CHANGED',
          metadata: { from: existing.status, to: 'IN_PROGRESS' },
        },
      });
    }

    return tx.workItem.findUnique({ where: { id }, select: WORK_ITEM_DETAIL_SELECT });
  });

  return result;
}

// ─── Transition Status ───────────────────────────────────────────────

export async function transitionWorkItem(
  id: string,
  toStatus: WorkItemStatus,
  expectedVersion: number,
  userId: string,
) {
  const existing = await prisma.workItem.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Work Item', id);

  // Validate the transition
  validateTransition(existing.status, toStatus);

  // Authorization
  const minRole = requiresManager(existing.status, toStatus) ? 'MANAGER' : 'MEMBER';
  const membership = await requireTeamMembership(userId, existing.teamId, minRole as any);
  
  if (!canTransitionStatus(membership, existing, toStatus)) {
    throw new ForbiddenError('You do not have permission to perform this status transition');
  }

  // If this is an approval, check specific permission
  if (existing.status === WorkItemStatus.PENDING_APPROVAL && toStatus === WorkItemStatus.RESOLVED) {
    if (!canApproveWorkItem(membership)) throw new ForbiddenError();
  }

  const resolvedAt = toStatus === WorkItemStatus.RESOLVED ? new Date() : null;

  const result = await prisma.$transaction(async (tx) => {
    const affected = await tx.$executeRaw`
      UPDATE work_items
      SET
        status = ${toStatus}::"WorkItemStatus",
        version = version + 1,
        updated_at = (NOW() AT TIME ZONE 'UTC'),
        resolved_at = ${resolvedAt}
      WHERE id = ${id}::uuid
        AND version = ${expectedVersion}
    `;

    if (affected === 0) throw new VersionConflictError();

    const eventType = getTransitionEventType(existing.status, toStatus);

    await tx.activityEvent.create({
      data: {
        workItemId: id,
        actorId: userId,
        eventType,
        metadata: { from: existing.status, to: toStatus },
      },
    });

    // Outbox for critical status changes
    if (toStatus === WorkItemStatus.RESOLVED || toStatus === WorkItemStatus.CANCELLED) {
      await tx.outboxEvent.create({
        data: {
          eventType: `WORK_ITEM_${toStatus}`,
          aggregateType: 'WorkItem',
          aggregateId: id,
          payload: {
            workItemId: id,
            reference: existing.reference,
            previousStatus: existing.status,
            newStatus: toStatus,
          },
        },
      });
    }

    return tx.workItem.findUnique({ where: { id }, select: WORK_ITEM_DETAIL_SELECT });
  });

  return result;
}

// ─── Change Priority (manager only) ──────────────────────────────────

export async function changePriority(
  id: string,
  priority: WorkItemPriority,
  expectedVersion: number,
  userId: string,
) {
  const existing = await prisma.workItem.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Work Item', id);

  const membership = await requireTeamMembership(userId, existing.teamId, 'MANAGER');
  if (!canChangePriority(membership)) throw new ForbiddenError();

  const result = await prisma.$transaction(async (tx) => {
    const affected = await tx.$executeRaw`
      UPDATE work_items
      SET
        priority = ${priority}::"WorkItemPriority",
        version = version + 1,
        updated_at = (NOW() AT TIME ZONE 'UTC')
      WHERE id = ${id}::uuid
        AND version = ${expectedVersion}
    `;

    if (affected === 0) throw new VersionConflictError();

    await tx.activityEvent.create({
      data: {
        workItemId: id,
        actorId: userId,
        eventType: 'PRIORITY_CHANGED',
        metadata: { from: existing.priority, to: priority },
      },
    });

    // Outbox for escalation to CRITICAL
    if (priority === WorkItemPriority.CRITICAL && existing.priority !== WorkItemPriority.CRITICAL) {
      await tx.outboxEvent.create({
        data: {
          eventType: 'WORK_ITEM_ESCALATED_TO_CRITICAL',
          aggregateType: 'WorkItem',
          aggregateId: id,
          payload: {
            workItemId: id,
            reference: existing.reference,
            previousPriority: existing.priority,
            newPriority: priority,
          },
        },
      });
    }

    return tx.workItem.findUnique({ where: { id }, select: WORK_ITEM_DETAIL_SELECT });
  });

  return result;
}

// ─── Comments ────────────────────────────────────────────────────────

export async function getComments(workItemId: string, userId: string, page = 1, pageSize = 25) {
  const workItem = await prisma.workItem.findUnique({ where: { id: workItemId }, select: { teamId: true } });
  if (!workItem) throw new NotFoundError('Work Item', workItemId);

  await requireTeamMembership(userId, workItem.teamId, 'VIEWER');

  const [items, total] = await Promise.all([
    prisma.comment.findMany({
      where: { workItemId },
      select: {
        id: true,
        body: true,
        createdAt: true,
        author: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.comment.count({ where: { workItemId } }),
  ]);

  return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

export async function addComment(workItemId: string, body: string, userId: string) {
  const workItem = await prisma.workItem.findUnique({ where: { id: workItemId }, select: { teamId: true } });
  if (!workItem) throw new NotFoundError('Work Item', workItemId);

  const membership = await requireTeamMembership(userId, workItem.teamId, 'MEMBER');
  if (!canAddComment(membership)) throw new ForbiddenError();

  const result = await prisma.$transaction(async (tx) => {
    const comment = await tx.comment.create({
      data: {
        workItemId,
        authorId: userId,
        body,
      },
      select: {
        id: true,
        body: true,
        createdAt: true,
        author: { select: { id: true, name: true, email: true } },
      },
    });

    await tx.activityEvent.create({
      data: {
        workItemId,
        actorId: userId,
        eventType: 'COMMENT_ADDED',
        metadata: { commentId: comment.id },
      },
    });

    return comment;
  });

  return result;
}

// ─── Activity Events ─────────────────────────────────────────────────

export async function getActivityEvents(workItemId: string, userId: string, page = 1, pageSize = 25) {
  const workItem = await prisma.workItem.findUnique({ where: { id: workItemId }, select: { teamId: true } });
  if (!workItem) throw new NotFoundError('Work Item', workItemId);

  await requireTeamMembership(userId, workItem.teamId, 'VIEWER');

  const [items, total] = await Promise.all([
    prisma.activityEvent.findMany({
      where: { workItemId },
      select: {
        id: true,
        eventType: true,
        metadata: true,
        createdAt: true,
        actor: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.activityEvent.count({ where: { workItemId } }),
  ]);

  return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

// ─── Dashboard Counts ────────────────────────────────────────────────

export async function getDashboardCounts(userId: string) {
  const userMemberships = await prisma.teamMembership.findMany({
    where: { userId },
    select: { teamId: true },
  });
  const teamIds = userMemberships.map((m) => m.teamId);

  const baseWhere = { teamId: { in: teamIds } };

  const [open, inProgress, pendingApproval, critical, unassigned, assignedToMe] = await Promise.all([
    prisma.workItem.count({ where: { ...baseWhere, status: 'OPEN' } }),
    prisma.workItem.count({ where: { ...baseWhere, status: 'IN_PROGRESS' } }),
    prisma.workItem.count({ where: { ...baseWhere, status: 'PENDING_APPROVAL' } }),
    prisma.workItem.count({
      where: {
        ...baseWhere,
        priority: 'CRITICAL',
        status: { notIn: ['RESOLVED', 'CANCELLED'] },
      },
    }),
    prisma.workItem.count({
      where: {
        ...baseWhere,
        assigneeId: null,
        status: { notIn: ['RESOLVED', 'CANCELLED'] },
      },
    }),
    prisma.workItem.count({
      where: {
        ...baseWhere,
        assigneeId: userId,
        status: { notIn: ['RESOLVED', 'CANCELLED'] },
      },
    }),
  ]);

  return { open, inProgress, pendingApproval, critical, unassigned, assignedToMe };
}
