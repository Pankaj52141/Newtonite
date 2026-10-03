import prisma from '../lib/prisma';

/**
 * Background outbox worker.
 *
 * Processes events from the transactional outbox using SELECT ... FOR UPDATE SKIP LOCKED
 * to allow multiple workers to run safely without double-processing events.
 *
 * Pattern:
 * 1. SELECT an available event FOR UPDATE SKIP LOCKED
 * 2. Process the event (simulate notification/email/etc.)
 * 3. Mark as PROCESSED on success, or increment attempts and record error on failure
 * 4. Events with too many failures remain in FAILED state for manual review
 */

const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 60_000; // 1 minute delay between retries

export async function processOutboxEvents(batchSize = 5): Promise<number> {
  let processed = 0;

  for (let i = 0; i < batchSize; i++) {
    const event = await claimNextEvent();
    if (!event) break;

    try {
      await handleEvent(event);

      // Mark as processed
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: 'PROCESSED',
          processedAt: new Date(),
          attempts: event.attempts + 1,
        },
      });

      processed++;
    } catch (error: any) {
      const attempts = event.attempts + 1;
      const status = attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING';
      const availableAt = new Date(Date.now() + RETRY_DELAY_MS * attempts);

      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status,
          attempts,
          lastError: error.message || 'Unknown error',
          availableAt: status === 'PENDING' ? availableAt : undefined,
        },
      });
    }
  }

  return processed;
}

/**
 * Claims the next available event using FOR UPDATE SKIP LOCKED.
 * This prevents multiple workers from processing the same event.
 */
async function claimNextEvent() {
  const events = await prisma.$queryRaw<Array<{
    id: string;
    event_type: string;
    aggregate_type: string;
    aggregate_id: string;
    payload: any;
    attempts: number;
  }>>`
    SELECT id, event_type, aggregate_type, aggregate_id, payload, attempts
    FROM outbox_events
    WHERE status = 'PENDING'
      AND available_at <= NOW()
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  `;

  if (events.length === 0) return null;

  const event = events[0];

  // Mark as processing
  await prisma.outboxEvent.update({
    where: { id: event.id },
    data: { status: 'PROCESSING' },
  });

  return {
    id: event.id,
    eventType: event.event_type,
    aggregateType: event.aggregate_type,
    aggregateId: event.aggregate_id,
    payload: event.payload,
    attempts: event.attempts,
  };
}

/**
 * Handle a specific event type.
 * In production, this would dispatch to notification services, email providers, etc.
 * For the MVP, we simulate processing with logging.
 */
async function handleEvent(event: {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: any;
}): Promise<void> {
  console.log(`[OutboxWorker] Processing event: ${event.eventType} for ${event.aggregateType}/${event.aggregateId}`);

  switch (event.eventType) {
    case 'CRITICAL_WORK_ITEM_CREATED':
      // Simulate sending urgent notification
      console.log(`[OutboxWorker] 🚨 CRITICAL work item created: ${event.payload.reference} - ${event.payload.title}`);
      console.log(`[OutboxWorker]   Team: ${event.payload.teamName}`);
      console.log(`[OutboxWorker]   → Would send email/Slack notification to team managers`);
      break;

    case 'WORK_ITEM_RESOLVED':
      console.log(`[OutboxWorker] ✅ Work item resolved: ${event.payload.reference}`);
      console.log(`[OutboxWorker]   → Would send resolution notification`);
      break;

    case 'WORK_ITEM_CANCELLED':
      console.log(`[OutboxWorker] ❌ Work item cancelled: ${event.payload.reference}`);
      break;

    case 'WORK_ITEM_ESCALATED_TO_CRITICAL':
      console.log(`[OutboxWorker] 🔥 Work item escalated to CRITICAL: ${event.payload.reference}`);
      console.log(`[OutboxWorker]   → Would send escalation alert`);
      break;

    default:
      console.log(`[OutboxWorker] Unknown event type: ${event.eventType}`);
  }
}

/**
 * Start the outbox worker polling loop.
 * In production, this would run as a separate process.
 */
export function startOutboxWorker(intervalMs = 5000): NodeJS.Timeout {
  console.log(`[OutboxWorker] Starting with ${intervalMs}ms poll interval`);

  const timer = setInterval(async () => {
    try {
      const processed = await processOutboxEvents();
      if (processed > 0) {
        console.log(`[OutboxWorker] Processed ${processed} events`);
      }
    } catch (error: any) {
      console.error(`[OutboxWorker] Error: ${error.message}`);
    }
  }, intervalMs);

  return timer;
}
