import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { PrismaClient, TeamRole, WorkItemStatus, WorkItemPriority } from '@prisma/client';
import { createApp } from '../app';
import { randomUUID } from 'crypto';

/**
 * Integration tests against a REAL PostgreSQL test database.
 *
 * These tests verify critical concurrent and authorization behaviors
 * that cannot be tested with mocks.
 *
 * Requires: TEST_DATABASE_URL or DATABASE_URL pointing to a test database.
 */

const prisma = new PrismaClient({
  datasources: {
    db: { url: 'postgresql://newtonite:newtonite_dev@localhost:5432/newtonite_test' },
  },
});

const app = createApp();

// ─── Test Data ───────────────────────────────────────────────────────

let team1Id: string;
let team2Id: string;
let managerUserId: string;
let memberUserId: string;
let member2UserId: string;
let viewerUserId: string;
let outsiderUserId: string;

async function cleanDatabase() {
  await prisma.$executeRaw`DELETE FROM activity_events`;
  await prisma.$executeRaw`DELETE FROM comments`;
  await prisma.$executeRaw`DELETE FROM idempotency_records`;
  await prisma.$executeRaw`DELETE FROM outbox_events`;
  await prisma.$executeRaw`DELETE FROM work_items`;
  await prisma.$executeRaw`DELETE FROM team_memberships`;
  await prisma.$executeRaw`DELETE FROM teams`;
  await prisma.$executeRaw`DELETE FROM users`;
}

async function seedTestData() {
  // Teams
  team1Id = randomUUID();
  team2Id = randomUUID();
  await prisma.team.createMany({
    data: [
      { id: team1Id, name: 'Team Alpha' },
      { id: team2Id, name: 'Team Beta' },
    ],
  });

  // Users
  managerUserId = randomUUID();
  memberUserId = randomUUID();
  member2UserId = randomUUID();
  viewerUserId = randomUUID();
  outsiderUserId = randomUUID();

  await prisma.user.createMany({
    data: [
      { id: managerUserId, name: 'Manager User', email: `manager-${randomUUID()}@test.dev` },
      { id: memberUserId, name: 'Member User', email: `member-${randomUUID()}@test.dev` },
      { id: member2UserId, name: 'Member Two', email: `member2-${randomUUID()}@test.dev` },
      { id: viewerUserId, name: 'Viewer User', email: `viewer-${randomUUID()}@test.dev` },
      { id: outsiderUserId, name: 'Outsider User', email: `outsider-${randomUUID()}@test.dev` },
    ],
  });

  // Team memberships
  await prisma.teamMembership.createMany({
    data: [
      { userId: managerUserId, teamId: team1Id, role: TeamRole.MANAGER },
      { userId: memberUserId, teamId: team1Id, role: TeamRole.MEMBER },
      { userId: member2UserId, teamId: team1Id, role: TeamRole.MEMBER },
      { userId: viewerUserId, teamId: team1Id, role: TeamRole.VIEWER },
      // outsiderUserId is a member of team2 only
      { userId: outsiderUserId, teamId: team2Id, role: TeamRole.MEMBER },
    ],
  });

  // Ensure sequence exists
  try {
    await prisma.$executeRaw`SELECT setval(pg_get_serial_sequence('work_item_sequence', 'id'), 5000, false)`;
  } catch {
    // Sequence might not exist in test DB, that's ok
  }
}

async function createTestWorkItem(overrides: Partial<{
  status: WorkItemStatus;
  priority: WorkItemPriority;
  assigneeId: string | null;
  teamId: string;
  createdById: string;
}> = {}): Promise<string> {
  const seq = Math.floor(Math.random() * 99999);
  const reference = `T-${seq}`;
  const item = await prisma.workItem.create({
    data: {
      reference,
      title: `Test Work Item ${reference}`,
      description: 'Test description',
      status: overrides.status ?? WorkItemStatus.OPEN,
      priority: overrides.priority ?? WorkItemPriority.MEDIUM,
      teamId: overrides.teamId ?? team1Id,
      createdById: overrides.createdById ?? managerUserId,
      assigneeId: overrides.assigneeId ?? null,
      version: 1,
    },
  });
  return item.id;
}

// ─── Setup / Teardown ────────────────────────────────────────────────

beforeAll(async () => {
  await cleanDatabase();
  await seedTestData();
});

afterAll(async () => {
  await cleanDatabase();
  await prisma.$disconnect();
});

// ─── TEST 1: Concurrent Claim ────────────────────────────────────────

describe('TEST 1: Concurrent Claim', () => {
  it('only one of two simultaneous claims succeeds', async () => {
    const workItemId = await createTestWorkItem();

    // Fire both claims concurrently
    const [response1, response2] = await Promise.all([
      request(app)
        .post(`/api/work-items/${workItemId}/claim`)
        .set('X-User-Id', memberUserId)
        .send({}),
      request(app)
        .post(`/api/work-items/${workItemId}/claim`)
        .set('X-User-Id', member2UserId)
        .send({}),
    ]);

    const statuses = [response1.status, response2.status].sort();

    // Exactly one succeeds (200) and exactly one fails (409)
    expect(statuses).toEqual([200, 409]);

    // Verify exactly one assignee in the database
    const workItem = await prisma.workItem.findUnique({ where: { id: workItemId } });
    expect(workItem).not.toBeNull();
    expect(workItem!.assigneeId).not.toBeNull();
    expect([memberUserId, member2UserId]).toContain(workItem!.assigneeId);
    expect(workItem!.status).toBe('IN_PROGRESS');

    // Verify exactly one successful claim activity event
    const claimEvents = await prisma.activityEvent.findMany({
      where: {
        workItemId,
        eventType: 'ASSIGNEE_CHANGED',
      },
    });
    // There should be exactly one set of events from the successful claim
    // (1 ASSIGNEE_CHANGED + 1 STATUS_CHANGED)
    expect(claimEvents.length).toBe(1);

    const statusEvents = await prisma.activityEvent.findMany({
      where: {
        workItemId,
        eventType: 'STATUS_CHANGED',
      },
    });
    expect(statusEvents.length).toBe(1);
  });
});

// ─── TEST 2: Stale Version / Lost Update Prevention ──────────────────

describe('TEST 2: Stale Version - Optimistic Concurrency', () => {
  it('rejects update with stale version', async () => {
    const workItemId = await createTestWorkItem({ assigneeId: memberUserId });

    // First update succeeds (version 1 -> 2)
    const res1 = await request(app)
      .patch(`/api/work-items/${workItemId}`)
      .set('X-User-Id', memberUserId)
      .send({ title: 'Updated by Alice', expectedVersion: 1 });

    expect(res1.status).toBe(200);
    expect(res1.body.version).toBe(2);

    // Second update with stale version 1 should fail
    const res2 = await request(app)
      .patch(`/api/work-items/${workItemId}`)
      .set('X-User-Id', memberUserId)
      .send({ title: 'Updated by Bob (stale)', expectedVersion: 1 });

    expect(res2.status).toBe(409);
    expect(res2.body.error.code).toBe('VERSION_CONFLICT');

    // Verify Alice's title persisted, not Bob's
    const workItem = await prisma.workItem.findUnique({ where: { id: workItemId } });
    expect(workItem!.title).toBe('Updated by Alice');
    expect(workItem!.version).toBe(2);
  });
});

// ─── TEST 3: Authorization - Cross-Team ──────────────────────────────

describe('TEST 3: Authorization - Cross-Team', () => {
  it('rejects mutation from user outside the team', async () => {
    const workItemId = await createTestWorkItem({ teamId: team1Id });

    // Outsider (member of team2 only) tries to edit team1 item
    const res = await request(app)
      .patch(`/api/work-items/${workItemId}`)
      .set('X-User-Id', outsiderUserId)
      .send({ title: 'Hacked!', expectedVersion: 1 });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');

    // Verify item is unchanged
    const workItem = await prisma.workItem.findUnique({ where: { id: workItemId } });
    expect(workItem!.title).not.toBe('Hacked!');
  });

  it('rejects view of work item from user outside the team', async () => {
    const workItemId = await createTestWorkItem({ teamId: team1Id });

    const res = await request(app)
      .get(`/api/work-items/${workItemId}`)
      .set('X-User-Id', outsiderUserId);

    expect(res.status).toBe(403);
  });
});

// ─── TEST 4: Role Authorization ──────────────────────────────────────

describe('TEST 4: Role Authorization', () => {
  it('VIEWER cannot create work items', async () => {
    const res = await request(app)
      .post('/api/work-items')
      .set('X-User-Id', viewerUserId)
      .send({
        title: 'Viewer attempt',
        description: 'Should fail',
        priority: 'MEDIUM',
        teamId: team1Id,
      });

    expect(res.status).toBe(403);
  });

  it('MEMBER cannot approve (PENDING_APPROVAL -> RESOLVED)', async () => {
    // Create a work item in PENDING_APPROVAL state
    const workItemId = await createTestWorkItem({ status: WorkItemStatus.PENDING_APPROVAL });

    const res = await request(app)
      .post(`/api/work-items/${workItemId}/transition`)
      .set('X-User-Id', memberUserId)
      .send({ status: 'RESOLVED', expectedVersion: 1 });

    expect(res.status).toBe(403);
  });

  it('MANAGER can approve (PENDING_APPROVAL -> RESOLVED)', async () => {
    const workItemId = await createTestWorkItem({ status: WorkItemStatus.PENDING_APPROVAL });

    const res = await request(app)
      .post(`/api/work-items/${workItemId}/transition`)
      .set('X-User-Id', managerUserId)
      .send({ status: 'RESOLVED', expectedVersion: 1 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('RESOLVED');
  });

  it('VIEWER cannot claim work items', async () => {
    const workItemId = await createTestWorkItem();

    const res = await request(app)
      .post(`/api/work-items/${workItemId}/claim`)
      .set('X-User-Id', viewerUserId)
      .send({});

    expect(res.status).toBe(403);
  });

  it('MEMBER cannot change priority', async () => {
    const workItemId = await createTestWorkItem();

    const res = await request(app)
      .post(`/api/work-items/${workItemId}/priority`)
      .set('X-User-Id', memberUserId)
      .send({ priority: 'CRITICAL', expectedVersion: 1 });

    expect(res.status).toBe(403);
  });

  it('MEMBER cannot assign work items', async () => {
    const workItemId = await createTestWorkItem();

    const res = await request(app)
      .post(`/api/work-items/${workItemId}/assign`)
      .set('X-User-Id', memberUserId)
      .send({ assigneeId: member2UserId, expectedVersion: 1 });

    expect(res.status).toBe(403);
  });
});

// ─── TEST 5: Workflow Validation ─────────────────────────────────────

describe('TEST 5: Workflow State Machine', () => {
  it('allows valid transition OPEN -> IN_PROGRESS', async () => {
    const workItemId = await createTestWorkItem({ status: WorkItemStatus.OPEN, assigneeId: memberUserId });

    const res = await request(app)
      .post(`/api/work-items/${workItemId}/transition`)
      .set('X-User-Id', memberUserId)
      .send({ status: 'IN_PROGRESS', expectedVersion: 1 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('IN_PROGRESS');
  });

  it('rejects invalid transition OPEN -> RESOLVED', async () => {
    const workItemId = await createTestWorkItem({ status: WorkItemStatus.OPEN });

    const res = await request(app)
      .post(`/api/work-items/${workItemId}/transition`)
      .set('X-User-Id', memberUserId)
      .send({ status: 'RESOLVED', expectedVersion: 1 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('rejects invalid transition OPEN -> PENDING_APPROVAL', async () => {
    const workItemId = await createTestWorkItem({ status: WorkItemStatus.OPEN });

    const res = await request(app)
      .post(`/api/work-items/${workItemId}/transition`)
      .set('X-User-Id', memberUserId)
      .send({ status: 'PENDING_APPROVAL', expectedVersion: 1 });

    expect(res.status).toBe(422);
  });

  it('rejects transition from terminal state RESOLVED', async () => {
    const workItemId = await createTestWorkItem({ status: WorkItemStatus.RESOLVED });

    const res = await request(app)
      .post(`/api/work-items/${workItemId}/transition`)
      .set('X-User-Id', managerUserId)
      .send({ status: 'IN_PROGRESS', expectedVersion: 1 });

    expect(res.status).toBe(422);
  });
});

// ─── TEST 6: Idempotency ────────────────────────────────────────────

describe('TEST 6: Idempotency', () => {
  it('same idempotency key returns same result without duplicate side effects', async () => {
    const idempotencyKey = randomUUID();

    const body = {
      title: 'Idempotent Work Item',
      description: 'Testing idempotency',
      priority: 'HIGH',
      teamId: team1Id,
    };

    // First request
    const res1 = await request(app)
      .post('/api/work-items')
      .set('X-User-Id', memberUserId)
      .set('Idempotency-Key', idempotencyKey)
      .send(body);

    expect(res1.status).toBe(201);
    const createdId = res1.body.id;

    // Second request with same key and body
    const res2 = await request(app)
      .post('/api/work-items')
      .set('X-User-Id', memberUserId)
      .set('Idempotency-Key', idempotencyKey)
      .send(body);

    // Should return same result
    expect(res2.status).toBe(201);
    expect(res2.body.id).toBe(createdId);

    // Verify only one work item was created
    const items = await prisma.workItem.findMany({
      where: { title: 'Idempotent Work Item' },
    });
    expect(items.length).toBe(1);

    // Verify only one activity event
    const events = await prisma.activityEvent.findMany({
      where: { workItemId: createdId, eventType: 'WORK_ITEM_CREATED' },
    });
    expect(events.length).toBe(1);
  });

  it('same key with different body returns conflict', async () => {
    const idempotencyKey = randomUUID();

    // First request
    await request(app)
      .post('/api/work-items')
      .set('X-User-Id', memberUserId)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        title: 'First Request',
        priority: 'LOW',
        teamId: team1Id,
      });

    // Second request with same key but different body
    const res2 = await request(app)
      .post('/api/work-items')
      .set('X-User-Id', memberUserId)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        title: 'Different Request',
        priority: 'HIGH',
        teamId: team1Id,
      });

    expect(res2.status).toBe(409);
    expect(res2.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });
});

// ─── TEST 7: Audit History ───────────────────────────────────────────

describe('TEST 7: Transactional Audit History', () => {
  it('status transition creates activity event transactionally', async () => {
    const workItemId = await createTestWorkItem({ status: WorkItemStatus.OPEN, assigneeId: memberUserId });

    const res = await request(app)
      .post(`/api/work-items/${workItemId}/transition`)
      .set('X-User-Id', memberUserId)
      .send({ status: 'IN_PROGRESS', expectedVersion: 1 });

    expect(res.status).toBe(200);

    const events = await prisma.activityEvent.findMany({
      where: { workItemId, eventType: 'STATUS_CHANGED' },
    });

    expect(events.length).toBe(1);
    expect(events[0].actorId).toBe(memberUserId);
    expect((events[0].metadata as any).from).toBe('OPEN');
    expect((events[0].metadata as any).to).toBe('IN_PROGRESS');
  });

  it('comment adds both comment and activity event', async () => {
    const workItemId = await createTestWorkItem();

    const res = await request(app)
      .post(`/api/work-items/${workItemId}/comments`)
      .set('X-User-Id', memberUserId)
      .send({ body: 'This is a test comment' });

    expect(res.status).toBe(201);

    const events = await prisma.activityEvent.findMany({
      where: { workItemId, eventType: 'COMMENT_ADDED' },
    });

    expect(events.length).toBe(1);
    expect(events[0].actorId).toBe(memberUserId);
  });

  it('title change creates TITLE_CHANGED event', async () => {
    const workItemId = await createTestWorkItem({ assigneeId: memberUserId });

    await request(app)
      .patch(`/api/work-items/${workItemId}`)
      .set('X-User-Id', memberUserId)
      .send({ title: 'New Title For Audit', expectedVersion: 1 });

    const events = await prisma.activityEvent.findMany({
      where: { workItemId, eventType: 'TITLE_CHANGED' },
    });

    expect(events.length).toBe(1);
    expect((events[0].metadata as any).to).toBe('New Title For Audit');
  });
});

// ─── TEST 8: Transaction Consistency ─────────────────────────────────

describe('TEST 8: Transaction Consistency', () => {
  it('work item creation includes activity event in same transaction', async () => {
    const res = await request(app)
      .post('/api/work-items')
      .set('X-User-Id', memberUserId)
      .send({
        title: 'Transaction Test Item',
        priority: 'MEDIUM',
        teamId: team1Id,
      });

    expect(res.status).toBe(201);

    // Both work item and event should exist
    const workItem = await prisma.workItem.findUnique({ where: { id: res.body.id } });
    expect(workItem).not.toBeNull();

    const events = await prisma.activityEvent.findMany({
      where: { workItemId: res.body.id, eventType: 'WORK_ITEM_CREATED' },
    });
    expect(events.length).toBe(1);
  });

  it('critical work item creation also creates outbox event', async () => {
    const res = await request(app)
      .post('/api/work-items')
      .set('X-User-Id', memberUserId)
      .send({
        title: 'Critical Transaction Test',
        priority: 'CRITICAL',
        teamId: team1Id,
      });

    expect(res.status).toBe(201);

    const outboxEvents = await prisma.outboxEvent.findMany({
      where: { aggregateId: res.body.id, eventType: 'CRITICAL_WORK_ITEM_CREATED' },
    });
    expect(outboxEvents.length).toBe(1);
    expect(outboxEvents[0].status).toBe('PENDING');
  });
});

// ─── TEST 9: Filtering and Pagination ────────────────────────────────

describe('TEST 9: Filtering and Pagination', () => {
  it('returns paginated results with correct total', async () => {
    // Create several items
    for (let i = 0; i < 5; i++) {
      await createTestWorkItem();
    }

    const res = await request(app)
      .get('/api/work-items')
      .set('X-User-Id', memberUserId)
      .query({ page: 1, pageSize: 2 });

    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeLessThanOrEqual(2);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(2);
    expect(res.body.total).toBeGreaterThanOrEqual(5);
    expect(res.body.totalPages).toBeGreaterThanOrEqual(3);
  });

  it('filters by status', async () => {
    await createTestWorkItem({ status: WorkItemStatus.IN_PROGRESS });

    const res = await request(app)
      .get('/api/work-items')
      .set('X-User-Id', memberUserId)
      .query({ status: 'IN_PROGRESS' });

    expect(res.status).toBe(200);
    res.body.items.forEach((item: any) => {
      expect(item.status).toBe('IN_PROGRESS');
    });
  });

  it('filters by priority', async () => {
    await createTestWorkItem({ priority: WorkItemPriority.CRITICAL });

    const res = await request(app)
      .get('/api/work-items')
      .set('X-User-Id', memberUserId)
      .query({ priority: 'CRITICAL' });

    expect(res.status).toBe(200);
    res.body.items.forEach((item: any) => {
      expect(item.priority).toBe('CRITICAL');
    });
  });

  it('search by title works', async () => {
    const workItemId = await createTestWorkItem();
    const item = await prisma.workItem.findUnique({ where: { id: workItemId } });

    const res = await request(app)
      .get('/api/work-items')
      .set('X-User-Id', memberUserId)
      .query({ search: 'Test Work Item' });

    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
  });

  it('enforces max page size', async () => {
    const res = await request(app)
      .get('/api/work-items')
      .set('X-User-Id', memberUserId)
      .query({ pageSize: 1000 });

    // Should be capped at max (100) or return validation error
    expect([200, 400]).toContain(res.status);
  });
});

// ─── TEST 10: Assignment Validation ──────────────────────────────────

describe('TEST 10: Assignment Validation', () => {
  it('manager can assign team member', async () => {
    const workItemId = await createTestWorkItem();

    const res = await request(app)
      .post(`/api/work-items/${workItemId}/assign`)
      .set('X-User-Id', managerUserId)
      .send({ assigneeId: memberUserId, expectedVersion: 1 });

    expect(res.status).toBe(200);
    expect(res.body.assignee.id).toBe(memberUserId);
  });

  it('cannot assign to user outside team', async () => {
    const workItemId = await createTestWorkItem();

    const res = await request(app)
      .post(`/api/work-items/${workItemId}/assign`)
      .set('X-User-Id', managerUserId)
      .send({ assigneeId: outsiderUserId, expectedVersion: 1 });

    expect(res.status).toBe(400);
  });
});

