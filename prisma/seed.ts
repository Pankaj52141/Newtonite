import { PrismaClient, TeamRole, WorkItemStatus, WorkItemPriority } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ─── Teams ──────────────────────────────────────────────────
  const teams = await Promise.all([
    prisma.team.create({
      data: { id: randomUUID(), name: 'Payments', description: 'Payment processing and financial operations' },
    }),
    prisma.team.create({
      data: { id: randomUUID(), name: 'Engineering', description: 'Software engineering and platform reliability' },
    }),
    prisma.team.create({
      data: { id: randomUUID(), name: 'Customer Operations', description: 'Customer support and issue resolution' },
    }),
    prisma.team.create({
      data: { id: randomUUID(), name: 'Compliance', description: 'Regulatory compliance and audit' },
    }),
  ]);

  const [payments, engineering, customerOps, compliance] = teams;
  console.log(`  ✅ Created ${teams.length} teams`);

  // ─── Users ──────────────────────────────────────────────────
  const users = await Promise.all([
    prisma.user.create({ data: { id: randomUUID(), name: 'Alice Johnson', email: 'alice@newtonite.dev' } }),
    prisma.user.create({ data: { id: randomUUID(), name: 'Bob Smith', email: 'bob@newtonite.dev' } }),
    prisma.user.create({ data: { id: randomUUID(), name: 'Carol Williams', email: 'carol@newtonite.dev' } }),
    prisma.user.create({ data: { id: randomUUID(), name: 'David Brown', email: 'david@newtonite.dev' } }),
    prisma.user.create({ data: { id: randomUUID(), name: 'Eve Davis', email: 'eve@newtonite.dev' } }),
    prisma.user.create({ data: { id: randomUUID(), name: 'Frank Miller', email: 'frank@newtonite.dev' } }),
    prisma.user.create({ data: { id: randomUUID(), name: 'Grace Wilson', email: 'grace@newtonite.dev' } }),
    prisma.user.create({ data: { id: randomUUID(), name: 'Henry Taylor', email: 'henry@newtonite.dev' } }),
  ]);

  const [alice, bob, carol, david, eve, frank, grace, henry] = users;
  console.log(`  ✅ Created ${users.length} users`);

  // ─── Team Memberships ──────────────────────────────────────
  const memberships = [
    // Payments
    { userId: alice.id, teamId: payments.id, role: TeamRole.MANAGER },
    { userId: bob.id, teamId: payments.id, role: TeamRole.MEMBER },
    { userId: frank.id, teamId: payments.id, role: TeamRole.VIEWER },
    // Engineering
    { userId: carol.id, teamId: engineering.id, role: TeamRole.MANAGER },
    { userId: david.id, teamId: engineering.id, role: TeamRole.MEMBER },
    { userId: bob.id, teamId: engineering.id, role: TeamRole.MEMBER },  // Bob is also in Engineering
    { userId: grace.id, teamId: engineering.id, role: TeamRole.VIEWER },
    // Customer Operations
    { userId: eve.id, teamId: customerOps.id, role: TeamRole.MANAGER },
    { userId: frank.id, teamId: customerOps.id, role: TeamRole.MEMBER },
    { userId: alice.id, teamId: customerOps.id, role: TeamRole.MEMBER },  // Alice is also in Customer Ops
    { userId: henry.id, teamId: customerOps.id, role: TeamRole.MEMBER },
    // Compliance
    { userId: grace.id, teamId: compliance.id, role: TeamRole.MANAGER },
    { userId: eve.id, teamId: compliance.id, role: TeamRole.MEMBER },
    { userId: henry.id, teamId: compliance.id, role: TeamRole.VIEWER },
  ];

  await prisma.teamMembership.createMany({ data: memberships });
  console.log(`  ✅ Created ${memberships.length} team memberships`);

  // ─── Seed work_item_sequence starting at 1000 ──────────────
  // We insert dummy rows to advance the sequence
  await prisma.$executeRaw`SELECT setval(pg_get_serial_sequence('work_item_sequence', 'id'), 1000, false)`;

  // ─── Work Items ─────────────────────────────────────────────
  interface WorkItemSeed {
    title: string;
    description: string;
    status: WorkItemStatus;
    priority: WorkItemPriority;
    teamId: string;
    assigneeId: string | null;
    createdById: string;
    resolvedAt?: Date | null;
    comments?: { authorId: string; body: string }[];
    events?: { actorId: string; eventType: string; metadata: any }[];
  }

  const now = new Date();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000);

  const workItemSeeds: WorkItemSeed[] = [
    // ── Payments team items ──
    {
      title: 'Investigate duplicate charge for customer #4521',
      description: 'Customer reported being charged twice for order #ORD-8891. Need to verify with payment processor and issue refund if confirmed.',
      status: WorkItemStatus.IN_PROGRESS,
      priority: WorkItemPriority.HIGH,
      teamId: payments.id,
      assigneeId: bob.id,
      createdById: alice.id,
      comments: [
        { authorId: alice.id, body: 'Customer called in today, very upset. Please prioritize.' },
        { authorId: bob.id, body: 'Confirmed duplicate charge in Stripe dashboard. Initiating refund.' },
      ],
      events: [
        { actorId: alice.id, eventType: 'WORK_ITEM_CREATED', metadata: {} },
        { actorId: bob.id, eventType: 'STATUS_CHANGED', metadata: { from: 'OPEN', to: 'IN_PROGRESS' } },
        { actorId: bob.id, eventType: 'ASSIGNEE_CHANGED', metadata: { from: null, to: bob.name } },
      ],
    },
    {
      title: 'Payment gateway timeout errors on checkout',
      description: 'Multiple customers reporting timeout errors during checkout. Payment gateway response times have increased significantly.',
      status: WorkItemStatus.OPEN,
      priority: WorkItemPriority.CRITICAL,
      teamId: payments.id,
      assigneeId: null,
      createdById: alice.id,
      comments: [
        { authorId: alice.id, body: 'Seeing 15% failure rate in the last hour. This is urgent.' },
      ],
      events: [
        { actorId: alice.id, eventType: 'WORK_ITEM_CREATED', metadata: {} },
        { actorId: alice.id, eventType: 'PRIORITY_CHANGED', metadata: { from: 'HIGH', to: 'CRITICAL' } },
      ],
    },
    {
      title: 'Reconcile monthly payment report discrepancy',
      description: 'September payment report shows $2,340 discrepancy between our records and bank statement.',
      status: WorkItemStatus.PENDING_APPROVAL,
      priority: WorkItemPriority.MEDIUM,
      teamId: payments.id,
      assigneeId: bob.id,
      createdById: bob.id,
      comments: [
        { authorId: bob.id, body: 'Found 3 transactions that were recorded but not settled. Prepared adjustment.' },
        { authorId: alice.id, body: 'Please submit for my approval once the adjustment document is ready.' },
      ],
      events: [
        { actorId: bob.id, eventType: 'WORK_ITEM_CREATED', metadata: {} },
        { actorId: bob.id, eventType: 'STATUS_CHANGED', metadata: { from: 'OPEN', to: 'IN_PROGRESS' } },
        { actorId: bob.id, eventType: 'STATUS_CHANGED', metadata: { from: 'IN_PROGRESS', to: 'PENDING_APPROVAL' } },
      ],
    },
    {
      title: 'Set up payment processing for new EU region',
      description: 'We are expanding to EU markets. Need to configure payment processing with proper currency handling and compliance.',
      status: WorkItemStatus.OPEN,
      priority: WorkItemPriority.MEDIUM,
      teamId: payments.id,
      assigneeId: null,
      createdById: alice.id,
      events: [
        { actorId: alice.id, eventType: 'WORK_ITEM_CREATED', metadata: {} },
      ],
    },
    {
      title: 'Update PCI compliance documentation',
      description: 'Annual PCI DSS compliance review is due next month. Documentation needs updating.',
      status: WorkItemStatus.RESOLVED,
      priority: WorkItemPriority.LOW,
      teamId: payments.id,
      assigneeId: bob.id,
      createdById: alice.id,
      resolvedAt: hoursAgo(48),
      events: [
        { actorId: alice.id, eventType: 'WORK_ITEM_CREATED', metadata: {} },
        { actorId: bob.id, eventType: 'STATUS_CHANGED', metadata: { from: 'OPEN', to: 'IN_PROGRESS' } },
        { actorId: bob.id, eventType: 'STATUS_CHANGED', metadata: { from: 'IN_PROGRESS', to: 'RESOLVED' } },
      ],
    },

    // ── Engineering team items ──
    {
      title: 'Database connection pool exhaustion in production',
      description: 'Production API servers are intermittently running out of database connections. Connection pool is set to 20 but we are seeing spikes to 50+ concurrent queries.',
      status: WorkItemStatus.IN_PROGRESS,
      priority: WorkItemPriority.CRITICAL,
      teamId: engineering.id,
      assigneeId: david.id,
      createdById: carol.id,
      comments: [
        { authorId: carol.id, body: 'This is causing intermittent 500 errors for ~5% of requests.' },
        { authorId: david.id, body: 'Found a long-running query in the analytics module that holds connections. Working on fix.' },
        { authorId: bob.id, body: 'Can confirm this is also affecting payment processing latency.' },
      ],
      events: [
        { actorId: carol.id, eventType: 'WORK_ITEM_CREATED', metadata: {} },
        { actorId: david.id, eventType: 'ASSIGNEE_CHANGED', metadata: { from: null, to: david.name } },
        { actorId: david.id, eventType: 'STATUS_CHANGED', metadata: { from: 'OPEN', to: 'IN_PROGRESS' } },
      ],
    },
    {
      title: 'Implement rate limiting for public API',
      description: 'We need rate limiting on public API endpoints to prevent abuse. Current system has no throttling.',
      status: WorkItemStatus.OPEN,
      priority: WorkItemPriority.HIGH,
      teamId: engineering.id,
      assigneeId: null,
      createdById: carol.id,
      events: [
        { actorId: carol.id, eventType: 'WORK_ITEM_CREATED', metadata: {} },
      ],
    },
    {
      title: 'Migrate user auth to OAuth 2.0',
      description: 'Current session-based auth needs to be migrated to OAuth 2.0 with PKCE for better security and mobile support.',
      status: WorkItemStatus.IN_PROGRESS,
      priority: WorkItemPriority.MEDIUM,
      teamId: engineering.id,
      assigneeId: bob.id,
      createdById: carol.id,
      comments: [
        { authorId: bob.id, body: 'Started with the token refresh flow. Will handle migration path for existing sessions next.' },
      ],
      events: [
        { actorId: carol.id, eventType: 'WORK_ITEM_CREATED', metadata: {} },
        { actorId: bob.id, eventType: 'ASSIGNEE_CHANGED', metadata: { from: null, to: bob.name } },
        { actorId: bob.id, eventType: 'STATUS_CHANGED', metadata: { from: 'OPEN', to: 'IN_PROGRESS' } },
      ],
    },
    {
      title: 'Upgrade Node.js from v18 to v22',
      description: 'Node 18 LTS is nearing end of life. Plan and execute upgrade to Node 22.',
      status: WorkItemStatus.OPEN,
      priority: WorkItemPriority.LOW,
      teamId: engineering.id,
      assigneeId: david.id,
      createdById: david.id,
      events: [
        { actorId: david.id, eventType: 'WORK_ITEM_CREATED', metadata: {} },
      ],
    },
    {
      title: 'Fix memory leak in WebSocket service',
      description: 'WebSocket service memory usage grows linearly over time. Suspected listener leak on disconnect.',
      status: WorkItemStatus.RESOLVED,
      priority: WorkItemPriority.HIGH,
      teamId: engineering.id,
      assigneeId: david.id,
      createdById: carol.id,
      resolvedAt: hoursAgo(24),
      events: [
        { actorId: carol.id, eventType: 'WORK_ITEM_CREATED', metadata: {} },
        { actorId: david.id, eventType: 'STATUS_CHANGED', metadata: { from: 'OPEN', to: 'IN_PROGRESS' } },
        { actorId: david.id, eventType: 'STATUS_CHANGED', metadata: { from: 'IN_PROGRESS', to: 'RESOLVED' } },
      ],
    },

    // ── Customer Operations items ──
    {
      title: 'Escalated complaint from enterprise client Acme Corp',
      description: 'Acme Corp VP emailed CEO directly about recurring billing issues. Need immediate investigation and response.',
      status: WorkItemStatus.IN_PROGRESS,
      priority: WorkItemPriority.CRITICAL,
      teamId: customerOps.id,
      assigneeId: frank.id,
      createdById: eve.id,
      comments: [
        { authorId: eve.id, body: 'CEO forwarded email. This is our largest enterprise client. Handle with care.' },
        { authorId: frank.id, body: 'Called Acme VP directly. They had 3 incorrect invoices in the last 2 months. Investigating root cause.' },
        { authorId: alice.id, body: 'Cross-checked with payments team. Looks like a billing system sync issue.' },
      ],
      events: [
        { actorId: eve.id, eventType: 'WORK_ITEM_CREATED', metadata: {} },
        { actorId: frank.id, eventType: 'ASSIGNEE_CHANGED', metadata: { from: null, to: frank.name } },
        { actorId: frank.id, eventType: 'STATUS_CHANGED', metadata: { from: 'OPEN', to: 'IN_PROGRESS' } },
        { actorId: eve.id, eventType: 'PRIORITY_CHANGED', metadata: { from: 'HIGH', to: 'CRITICAL' } },
      ],
    },
    {
      title: 'Process bulk refund requests from outage on Sept 15',
      description: '47 customers affected by the September 15 outage have requested refunds or credits. Need to process systematically.',
      status: WorkItemStatus.PENDING_APPROVAL,
      priority: WorkItemPriority.HIGH,
      teamId: customerOps.id,
      assigneeId: henry.id,
      createdById: eve.id,
      comments: [
        { authorId: henry.id, body: 'Compiled list of affected customers. Total refund amount: $12,450. Submitting for approval.' },
        { authorId: eve.id, body: 'Approved up to $15,000 total. Please proceed with individual refunds.' },
      ],
      events: [
        { actorId: eve.id, eventType: 'WORK_ITEM_CREATED', metadata: {} },
        { actorId: henry.id, eventType: 'STATUS_CHANGED', metadata: { from: 'OPEN', to: 'IN_PROGRESS' } },
        { actorId: henry.id, eventType: 'STATUS_CHANGED', metadata: { from: 'IN_PROGRESS', to: 'PENDING_APPROVAL' } },
      ],
    },
    {
      title: 'Customer onboarding documentation update',
      description: 'New features from Q3 release are not reflected in customer onboarding guides.',
      status: WorkItemStatus.OPEN,
      priority: WorkItemPriority.LOW,
      teamId: customerOps.id,
      assigneeId: null,
      createdById: frank.id,
      events: [
        { actorId: frank.id, eventType: 'WORK_ITEM_CREATED', metadata: {} },
      ],
    },
    {
      title: 'Set up automated NPS survey for new customers',
      description: 'We need to automatically send NPS surveys 30 days after customer activation.',
      status: WorkItemStatus.OPEN,
      priority: WorkItemPriority.MEDIUM,
      teamId: customerOps.id,
      assigneeId: frank.id,
      createdById: eve.id,
      events: [
        { actorId: eve.id, eventType: 'WORK_ITEM_CREATED', metadata: {} },
        { actorId: frank.id, eventType: 'ASSIGNEE_CHANGED', metadata: { from: null, to: frank.name } },
      ],
    },
    {
      title: 'Resolved: Customer unable to reset password',
      description: 'Customer john.doe@example.com reported inability to reset password. Issue was expired verification token.',
      status: WorkItemStatus.RESOLVED,
      priority: WorkItemPriority.MEDIUM,
      teamId: customerOps.id,
      assigneeId: henry.id,
      createdById: henry.id,
      resolvedAt: hoursAgo(72),
      events: [
        { actorId: henry.id, eventType: 'WORK_ITEM_CREATED', metadata: {} },
        { actorId: henry.id, eventType: 'STATUS_CHANGED', metadata: { from: 'OPEN', to: 'IN_PROGRESS' } },
        { actorId: henry.id, eventType: 'STATUS_CHANGED', metadata: { from: 'IN_PROGRESS', to: 'RESOLVED' } },
      ],
    },

    // ── Compliance items ──
    {
      title: 'GDPR data deletion request - User #7823',
      description: 'Received formal GDPR right-to-erasure request. Must process within 30 days per regulation.',
      status: WorkItemStatus.IN_PROGRESS,
      priority: WorkItemPriority.HIGH,
      teamId: compliance.id,
      assigneeId: eve.id,
      createdById: grace.id,
      comments: [
        { authorId: grace.id, body: 'Request received on Oct 1. Deadline is Oct 31.' },
        { authorId: eve.id, body: 'Started identifying all data stores containing user data.' },
      ],
      events: [
        { actorId: grace.id, eventType: 'WORK_ITEM_CREATED', metadata: {} },
        { actorId: eve.id, eventType: 'ASSIGNEE_CHANGED', metadata: { from: null, to: eve.name } },
        { actorId: eve.id, eventType: 'STATUS_CHANGED', metadata: { from: 'OPEN', to: 'IN_PROGRESS' } },
      ],
    },
    {
      title: 'Annual SOC 2 audit preparation',
      description: 'SOC 2 Type II audit scheduled for November. Need to prepare all evidence and documentation.',
      status: WorkItemStatus.OPEN,
      priority: WorkItemPriority.HIGH,
      teamId: compliance.id,
      assigneeId: null,
      createdById: grace.id,
      events: [
        { actorId: grace.id, eventType: 'WORK_ITEM_CREATED', metadata: {} },
      ],
    },
    {
      title: 'Review and update data retention policies',
      description: 'Current data retention policies are 2 years old. Need review against latest regulations.',
      status: WorkItemStatus.OPEN,
      priority: WorkItemPriority.MEDIUM,
      teamId: compliance.id,
      assigneeId: eve.id,
      createdById: grace.id,
      events: [
        { actorId: grace.id, eventType: 'WORK_ITEM_CREATED', metadata: {} },
        { actorId: eve.id, eventType: 'ASSIGNEE_CHANGED', metadata: { from: null, to: eve.name } },
      ],
    },
    {
      title: 'Vendor security assessment - CloudStore Inc',
      description: 'New vendor CloudStore Inc needs security assessment before contract approval.',
      status: WorkItemStatus.PENDING_APPROVAL,
      priority: WorkItemPriority.MEDIUM,
      teamId: compliance.id,
      assigneeId: eve.id,
      createdById: grace.id,
      comments: [
        { authorId: eve.id, body: 'Completed security questionnaire review. Vendor meets all requirements. Recommending approval.' },
      ],
      events: [
        { actorId: grace.id, eventType: 'WORK_ITEM_CREATED', metadata: {} },
        { actorId: eve.id, eventType: 'STATUS_CHANGED', metadata: { from: 'OPEN', to: 'IN_PROGRESS' } },
        { actorId: eve.id, eventType: 'STATUS_CHANGED', metadata: { from: 'IN_PROGRESS', to: 'PENDING_APPROVAL' } },
      ],
    },
    {
      title: 'CANCELLED: Redundant privacy impact assessment',
      description: 'Originally created for Project X, but PIA was already completed by legal team.',
      status: WorkItemStatus.CANCELLED,
      priority: WorkItemPriority.LOW,
      teamId: compliance.id,
      assigneeId: null,
      createdById: eve.id,
      events: [
        { actorId: eve.id, eventType: 'WORK_ITEM_CREATED', metadata: {} },
        { actorId: grace.id, eventType: 'STATUS_CHANGED', metadata: { from: 'OPEN', to: 'CANCELLED' } },
      ],
    },

    // ── Additional items for bulk ──
    ...generateBulkItems(payments, engineering, customerOps, compliance, { alice, bob, carol, david, eve, frank, grace, henry }),
  ];

  let seqCounter = 1000;
  for (const seed of workItemSeeds) {
    seqCounter++;
    const reference = `OPS-${seqCounter}`;
    const workItem = await prisma.workItem.create({
      data: {
        id: randomUUID(),
        reference,
        title: seed.title,
        description: seed.description,
        status: seed.status,
        priority: seed.priority,
        teamId: seed.teamId,
        assigneeId: seed.assigneeId,
        createdById: seed.createdById,
        resolvedAt: seed.resolvedAt || null,
        version: 1 + (seed.events?.length || 0),
      },
    });

    // Comments
    if (seed.comments) {
      for (let i = 0; i < seed.comments.length; i++) {
        await prisma.comment.create({
          data: {
            id: randomUUID(),
            workItemId: workItem.id,
            authorId: seed.comments[i].authorId,
            body: seed.comments[i].body,
            createdAt: hoursAgo(100 - i * 10),
          },
        });
      }
    }

    // Activity events
    if (seed.events) {
      for (let i = 0; i < seed.events.length; i++) {
        await prisma.activityEvent.create({
          data: {
            id: randomUUID(),
            workItemId: workItem.id,
            actorId: seed.events[i].actorId,
            eventType: seed.events[i].eventType,
            metadata: seed.events[i].metadata,
            createdAt: hoursAgo(100 - i * 5),
          },
        });
      }
    }
  }

  // Update sequence to match
  await prisma.$executeRaw`SELECT setval(pg_get_serial_sequence('work_item_sequence', 'id'), ${seqCounter}, true)`;

  console.log(`  ✅ Created ${workItemSeeds.length} work items with comments and activity`);
  console.log('🎉 Seeding complete!');
}

function generateBulkItems(
  payments: { id: string },
  engineering: { id: string },
  customerOps: { id: string },
  compliance: { id: string },
  users: Record<string, { id: string; name: string }>,
) {
  const { alice, bob, carol, david, eve, frank, grace, henry } = users;
  const statuses = [WorkItemStatus.OPEN, WorkItemStatus.IN_PROGRESS, WorkItemStatus.OPEN, WorkItemStatus.RESOLVED];
  const priorities = [WorkItemPriority.LOW, WorkItemPriority.MEDIUM, WorkItemPriority.HIGH, WorkItemPriority.MEDIUM];
  const items: any[] = [];

  const bulkTitles = [
    'Review access control policies',
    'Investigate slow API response times',
    'Update deployment runbook',
    'Fix broken CI pipeline for staging',
    'Audit third-party API usage',
    'Customer data export request',
    'Resolve SSL certificate warnings',
    'Plan capacity for Black Friday',
    'Update employee onboarding checklist',
    'Migrate legacy cron jobs to modern scheduler',
    'Investigate elevated error rates',
    'Review Q3 operational metrics',
    'Update API documentation',
    'Fix timezone handling in reports',
    'Implement webhook retry logic',
    'Review infrastructure costs',
    'Set up staging environment',
    'Address accessibility audit findings',
    'Configure automated backups',
    'Review security incident response plan',
  ];

  const teamAssignments = [
    { teamId: payments.id, creators: [alice, bob], assignees: [bob, null, alice] },
    { teamId: engineering.id, creators: [carol, david], assignees: [david, bob, null] },
    { teamId: customerOps.id, creators: [eve, frank], assignees: [frank, henry, null] },
    { teamId: compliance.id, creators: [grace, eve], assignees: [eve, null] },
  ];

  for (let i = 0; i < bulkTitles.length; i++) {
    const teamAssign = teamAssignments[i % teamAssignments.length];
    const creator = teamAssign.creators[i % teamAssign.creators.length];
    const assignee = teamAssign.assignees[i % teamAssign.assignees.length];

    items.push({
      title: bulkTitles[i],
      description: `Operational task: ${bulkTitles[i]}. Created for tracking and resolution.`,
      status: statuses[i % statuses.length],
      priority: priorities[i % priorities.length],
      teamId: teamAssign.teamId,
      assigneeId: assignee?.id || null,
      createdById: creator.id,
      events: [
        { actorId: creator.id, eventType: 'WORK_ITEM_CREATED', metadata: {} },
      ],
    });
  }

  return items;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
