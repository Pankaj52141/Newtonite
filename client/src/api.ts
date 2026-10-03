const API_URL = 'http://localhost:3001';

let currentUserId: string | null = localStorage.getItem('userId');

export function setCurrentUserId(id: string) {
  currentUserId = id;
  localStorage.setItem('userId', id);
}

export function getCurrentUserId(): string | null {
  return currentUserId;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (currentUserId) {
    headers['X-User-Id'] = currentUserId;
  }

  const response = await fetch(`${API_URL}/api${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const error = new Error(errorBody?.error?.message || `Request failed: ${response.status}`);
    (error as any).status = response.status;
    (error as any).code = errorBody?.error?.code;
    (error as any).details = errorBody?.error?.details;
    throw error;
  }

  return response.json();
}

// ─── Types ───────────────────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  email: string;
  teamMemberships: {
    role: string;
    team: { id: string; name: string };
  }[];
}

export interface Team {
  id: string;
  name: string;
  description: string;
  memberships: {
    role: string;
    user: { id: string; name: string; email: string };
  }[];
}

export interface WorkItem {
  id: string;
  reference: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  version: number;
  teamId: string;
  assigneeId: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  team: { id: string; name: string };
  assignee: { id: string; name: string; email: string } | null;
  createdBy: { id: string; name: string; email: string };
  availableTransitions?: string[];
}

export interface Comment {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string; email: string };
}

export interface ActivityEvent {
  id: string;
  eventType: string;
  metadata: Record<string, any>;
  createdAt: string;
  actor: { id: string; name: string; email: string };
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface DashboardCounts {
  open: number;
  inProgress: number;
  pendingApproval: number;
  critical: number;
  unassigned: number;
  assignedToMe: number;
}

export interface WorkItemFilters {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  priority?: string;
  teamId?: string;
  assigneeId?: string;
  unassigned?: boolean;
  sortBy?: string;
  sortOrder?: string;
  view?: string;
}

// ─── API Functions ───────────────────────────────────────────────────

export const api = {
  // Auth
  me: () => request<User>('/me'),
  users: () => request<User[]>('/users'),

  // Teams
  teams: () => request<Team[]>('/teams'),

  // Work Items
  listWorkItems: (filters: WorkItemFilters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== '') {
        params.set(key, String(value));
      }
    });
    return request<PaginatedResponse<WorkItem>>(`/work-items?${params}`);
  },

  getDashboardCounts: () => request<DashboardCounts>('/work-items/counts'),

  getWorkItem: (id: string) => request<WorkItem>(`/work-items/${id}`),

  createWorkItem: (data: { title: string; description?: string; priority: string; teamId: string }, idempotencyKey?: string) => {
    const headers: Record<string, string> = {};
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    return request<WorkItem>('/work-items', {
      method: 'POST',
      body: JSON.stringify(data),
      headers,
    });
  },

  updateWorkItem: (id: string, data: { title?: string; description?: string; expectedVersion: number }) =>
    request<WorkItem>(`/work-items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  claimWorkItem: (id: string, expectedVersion?: number) =>
    request<WorkItem>(`/work-items/${id}/claim`, {
      method: 'POST',
      body: JSON.stringify({ expectedVersion }),
    }),

  unclaimWorkItem: (id: string, expectedVersion: number) =>
    request<WorkItem>(`/work-items/${id}/unclaim`, {
      method: 'POST',
      body: JSON.stringify({ expectedVersion }),
    }),

  assignWorkItem: (id: string, assigneeId: string, expectedVersion: number) =>
    request<WorkItem>(`/work-items/${id}/assign`, {
      method: 'POST',
      body: JSON.stringify({ assigneeId, expectedVersion }),
    }),

  transitionWorkItem: (id: string, status: string, expectedVersion: number) =>
    request<WorkItem>(`/work-items/${id}/transition`, {
      method: 'POST',
      body: JSON.stringify({ status, expectedVersion }),
    }),

  approveWorkItem: (id: string, expectedVersion: number, idempotencyKey?: string) => {
    const headers: Record<string, string> = {};
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    return request<WorkItem>(`/work-items/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ expectedVersion }),
      headers,
    });
  },

  changePriority: (id: string, priority: string, expectedVersion: number) =>
    request<WorkItem>(`/work-items/${id}/priority`, {
      method: 'POST',
      body: JSON.stringify({ priority, expectedVersion }),
    }),

  // Comments
  getComments: (workItemId: string, page = 1) =>
    request<PaginatedResponse<Comment>>(`/work-items/${workItemId}/comments?page=${page}`),

  addComment: (workItemId: string, body: string) =>
    request<Comment>(`/work-items/${workItemId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),

  // Activity
  getActivity: (workItemId: string, page = 1) =>
    request<PaginatedResponse<ActivityEvent>>(`/work-items/${workItemId}/activity?page=${page}`),
};
