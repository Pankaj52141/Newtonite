import { TeamRole, WorkItemStatus } from '@prisma/client';
import prisma from '../lib/prisma';
import { ForbiddenError } from '../errors';

/**
 * Authorization module.
 *
 * All authorization checks happen on the backend using team membership and role.
 * The frontend may hide UI elements for convenience, but the backend is authoritative.
 * A user calling the API manually must still receive 403 when unauthorized.
 */

export interface TeamMembershipInfo {
  userId: string;
  teamId: string;
  role: TeamRole;
}

export interface WorkItemContext {
  assigneeId: string | null;
  status: WorkItemStatus;
}

/** Role hierarchy: MANAGER > MEMBER > VIEWER */
const ROLE_LEVEL: Record<TeamRole, number> = {
  VIEWER: 0,
  MEMBER: 1,
  MANAGER: 2,
};

function hasMinRole(membership: TeamMembershipInfo | null, minRole: TeamRole): boolean {
  if (!membership) return false;
  return ROLE_LEVEL[membership.role] >= ROLE_LEVEL[minRole];
}

/**
 * Get a user's membership in a specific team.
 * Returns null if the user is not a member.
 */
export async function getTeamMembership(
  userId: string,
  teamId: string,
): Promise<TeamMembershipInfo | null> {
  const membership = await prisma.teamMembership.findUnique({
    where: { userId_teamId: { userId, teamId } },
  });
  return membership;
}

// ─── Permission Checks ───────────────────────────────────────────────

export function canViewWorkItem(membership: TeamMembershipInfo | null): boolean {
  return hasMinRole(membership, 'VIEWER');
}

export function canCreateWorkItem(membership: TeamMembershipInfo | null): boolean {
  return hasMinRole(membership, 'MEMBER');
}

export function canEditWorkItem(membership: TeamMembershipInfo | null, item: WorkItemContext): boolean {
  if (!hasMinRole(membership, 'MEMBER')) return false;
  if (hasMinRole(membership, 'MANAGER')) return true;
  // Members can only edit their own assigned items
  return item.assigneeId === membership?.userId;
}

export function canClaimWorkItem(membership: TeamMembershipInfo | null): boolean {
  return hasMinRole(membership, 'MEMBER');
}

export function canAddComment(membership: TeamMembershipInfo | null): boolean {
  return hasMinRole(membership, 'MEMBER');
}

export function canAssignWorkItem(membership: TeamMembershipInfo | null): boolean {
  return hasMinRole(membership, 'MANAGER');
}

export function canChangePriority(membership: TeamMembershipInfo | null): boolean {
  return hasMinRole(membership, 'MANAGER');
}

export function canApproveWorkItem(membership: TeamMembershipInfo | null): boolean {
  return hasMinRole(membership, 'MANAGER');
}

export function canTransitionStatus(
  membership: TeamMembershipInfo | null,
  item: WorkItemContext,
  toStatus: string,
): boolean {
  if (!hasMinRole(membership, 'MEMBER')) return false;
  
  // Managers can do any valid transition
  if (hasMinRole(membership, 'MANAGER')) return true;

  // Members can only transition if they are the assignee
  if (item.assigneeId !== membership?.userId) return false;

  // Even if they are the assignee, there are things they cannot do:
  if (toStatus === 'CANCELLED') return false; // Cancel requires Manager
  if (item.status === 'RESOLVED' || item.status === 'CANCELLED') return false; // Reopen requires Manager
  if (item.status === 'PENDING_APPROVAL') return false; // Approve/Reject requires Manager

  // Members can do: OPEN -> IN_PROGRESS, IN_PROGRESS -> PENDING_APPROVAL, IN_PROGRESS -> RESOLVED
  return true;
}

// ─── Enforcement Helpers ─────────────────────────────────────────────

export async function requireTeamMembership(
  userId: string,
  teamId: string,
  minRole: TeamRole = 'VIEWER',
): Promise<TeamMembershipInfo> {
  const membership = await getTeamMembership(userId, teamId);
  if (!membership || !hasMinRole(membership, minRole)) {
    throw new ForbiddenError('You do not have the required permissions on this team');
  }
  return membership;
}
