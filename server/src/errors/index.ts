/**
 * Domain error hierarchy for the application.
 * Each error maps to a specific HTTP status code and error code.
 */

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(400, 'VALIDATION_ERROR', message, details);
    this.name = 'ValidationError';
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, 'UNAUTHENTICATED', message);
    this.name = 'UnauthenticatedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(403, 'FORBIDDEN', message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    const message = id ? `${resource} '${id}' not found` : `${resource} not found`;
    super(404, `${resource.toUpperCase().replace(/\s+/g, '_')}_NOT_FOUND`, message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(409, code, message, details);
    this.name = 'ConflictError';
  }
}

export class VersionConflictError extends ConflictError {
  constructor() {
    super('VERSION_CONFLICT', 'This work item changed while you were editing it. Please refresh and try again.');
  }
}

export class WorkItemAlreadyClaimedError extends ConflictError {
  constructor() {
    super('WORK_ITEM_ALREADY_CLAIMED', 'This work item has already been claimed by another user.');
  }
}

export class InvalidTransitionError extends AppError {
  constructor(from: string, to: string) {
    super(422, 'INVALID_STATUS_TRANSITION', `Cannot transition from ${from} to ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export class IdempotencyConflictError extends ConflictError {
  constructor() {
    super('IDEMPOTENCY_CONFLICT', 'This idempotency key was already used with a different request body.');
  }
}
