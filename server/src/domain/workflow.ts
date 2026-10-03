import { WorkItemStatus } from '@prisma/client';
import { InvalidTransitionError } from '../errors';

/**
 * Workflow state machine for work item status transitions.
 *
 * State diagram:
 *
 *   OPEN ──────────> IN_PROGRESS
 *     │                  │
 *     │                  ├──> PENDING_APPROVAL ──┬──> IN_PROGRESS (rejected)
 *     │                  │                       └──> RESOLVED (approved)
 *     │                  ├──> RESOLVED
 *     │                  └──> CANCELLED
 *     └──> CANCELLED
 *
 * RESOLVED and CANCELLED are terminal states.
 */

const VALID_TRANSITIONS: Record<WorkItemStatus, WorkItemStatus[]> = {
  OPEN: [WorkItemStatus.IN_PROGRESS, WorkItemStatus.CANCELLED],
  IN_PROGRESS: [WorkItemStatus.PENDING_APPROVAL, WorkItemStatus.RESOLVED, WorkItemStatus.CANCELLED],
  PENDING_APPROVAL: [WorkItemStatus.IN_PROGRESS, WorkItemStatus.RESOLVED],
  RESOLVED: [],
  CANCELLED: [],
};

/**
 * Transitions that require MANAGER role.
 * Approval (PENDING_APPROVAL -> RESOLVED) is a privileged operation.
 * Rejection (PENDING_APPROVAL -> IN_PROGRESS) also requires MANAGER.
 */
const MANAGER_ONLY_TRANSITIONS: Array<{ from: WorkItemStatus; to: WorkItemStatus }> = [
  { from: WorkItemStatus.PENDING_APPROVAL, to: WorkItemStatus.RESOLVED },
  { from: WorkItemStatus.PENDING_APPROVAL, to: WorkItemStatus.IN_PROGRESS },
];

export function isValidTransition(from: WorkItemStatus, to: WorkItemStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function requiresManager(from: WorkItemStatus, to: WorkItemStatus): boolean {
  return MANAGER_ONLY_TRANSITIONS.some((t) => t.from === from && t.to === to);
}

export function validateTransition(from: WorkItemStatus, to: WorkItemStatus): void {
  if (!isValidTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

/**
 * Get the event type for a status transition.
 */
export function getTransitionEventType(from: WorkItemStatus, to: WorkItemStatus): string {
  if (from === WorkItemStatus.PENDING_APPROVAL && to === WorkItemStatus.RESOLVED) {
    return 'APPROVED';
  }
  if (from === WorkItemStatus.PENDING_APPROVAL && to === WorkItemStatus.IN_PROGRESS) {
    return 'REJECTED';
  }
  if (to === WorkItemStatus.PENDING_APPROVAL) {
    return 'APPROVAL_REQUESTED';
  }
  return 'STATUS_CHANGED';
}

export function getAvailableTransitions(status: WorkItemStatus): WorkItemStatus[] {
  return VALID_TRANSITIONS[status] || [];
}
