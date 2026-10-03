import { createHash } from 'crypto';
import prisma from '../lib/prisma';
import { IdempotencyConflictError } from '../errors';
import { Prisma } from '@prisma/client';

/**
 * Idempotency service.
 *
 * Ensures that duplicate requests with the same Idempotency-Key produce the
 * same result without executing the operation twice.
 *
 * Uses database uniqueness (uq_idempotency_key_user) to handle concurrent
 * duplicate requests safely — the second INSERT will fail with a unique
 * constraint violation, not silently create a duplicate.
 */

const IDEMPOTENCY_TTL_HOURS = 24;

function hashRequestBody(body: unknown): string {
  const json = JSON.stringify(body || {});
  return createHash('sha256').update(json).digest('hex');
}

export interface IdempotencyResult {
  isReplay: boolean;
  responseStatus: number;
  responseBody: unknown;
}

/**
 * Check for an existing idempotency record.
 * Returns the previous response if the key was used with the same request body.
 * Throws IdempotencyConflictError if the key was used with a different request body.
 * Returns null if this is a new request.
 */
export async function checkIdempotency(
  key: string,
  userId: string,
  endpoint: string,
  body: unknown,
): Promise<IdempotencyResult | null> {
  const requestHash = hashRequestBody(body);

  const existing = await prisma.idempotencyRecord.findUnique({
    where: { uq_idempotency_key_user: { key, userId } },
  });

  if (!existing) return null;

  // Check if expired
  if (existing.expiresAt < new Date()) {
    // Expired — delete and treat as new
    await prisma.idempotencyRecord.delete({
      where: { uq_idempotency_key_user: { key, userId } },
    });
    return null;
  }

  // Same key but different request body
  if (existing.requestHash !== requestHash) {
    throw new IdempotencyConflictError();
  }

  // Same key, same body — return cached response
  return {
    isReplay: true,
    responseStatus: existing.responseStatus,
    responseBody: existing.responseBody,
  };
}

/**
 * Store the result of an idempotent operation.
 * Uses INSERT with conflict handling to be safe under concurrent duplicate requests.
 */
export async function storeIdempotencyRecord(
  key: string,
  userId: string,
  endpoint: string,
  body: unknown,
  responseStatus: number,
  responseBody: unknown,
): Promise<void> {
  const requestHash = hashRequestBody(body);
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000);

  try {
    await prisma.idempotencyRecord.create({
      data: {
        key,
        userId,
        endpoint,
        requestHash,
        responseStatus,
        responseBody: responseBody as Prisma.InputJsonValue,
        expiresAt,
      },
    });
  } catch (error: any) {
    // Handle concurrent duplicate inserts — unique constraint violation
    if (error.code === 'P2002') {
      // Another request already stored the record — this is fine
      return;
    }
    throw error;
  }
}
