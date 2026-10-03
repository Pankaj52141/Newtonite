# Engineering Decisions

As requested by the challenge brief, here are 5 important architectural and product decisions made while building this application:

## 1. Strict Backend Authorization Over UI Hiding
**Decision:** We intentionally exposed all UI controls (buttons, forms) to all users, regardless of their role, and instead rely entirely on the backend to enforce Role-Based Access Control (RBAC). 
**Why:** Hiding UI elements is a UX pattern, not a security model. By exposing the controls, we explicitly prove that our backend API properly validates the user's role (Manager, Member, Viewer) against the specific team the work item belongs to, throwing a `403 Forbidden` if they lack permission (e.g., a Member trying to approve a ticket).

## 2. Optimistic Concurrency Control (OCC)
**Decision:** We implemented OCC using a `version` integer column on the Work Item rather than pessimistic database locks.
**Why:** The prompt highlighted the risk of two users interacting with an issue simultaneously. If User A and User B both load the ticket, and User A makes a change, User B's subsequent save attempt will pass their stale `expectedVersion`. The SQL query (`UPDATE ... WHERE id = ? AND version = ?`) will affect 0 rows, and we throw a `409 Conflict`. This entirely eliminates the "Lost Update" problem while maintaining high read performance.

## 3. Strict State Machine & UTC Timezone Safety
**Decision:** Status transitions (OPEN &rarr; IN_PROGRESS &rarr; PENDING_APPROVAL &rarr; RESOLVED) are strictly enforced in a centralized domain logic layer (`workflow.ts`). We also force all raw SQL timestamps to `(NOW() AT TIME ZONE 'UTC')`.
**Why:** Relying on the frontend to dictate "what status comes next" is unsafe. The backend evaluates the current state and only allows valid forward transitions. Additionally, standardizing all SQL writes to UTC prevents the dangerous "5 hours in the future" timeline drift bugs that occur when a database server's local timezone misaligns with the application server.

## 4. PostgreSQL as the Universal Datastore (Transactional Outbox)
**Decision:** Instead of introducing Redis for caching or Kafka for background queues, we use PostgreSQL for everything, utilizing the Transactional Outbox pattern (`SELECT ... FOR UPDATE SKIP LOCKED`).
**Why:** It reduces infrastructure complexity and operational burden. By writing outbox events in the exact same database transaction as the domain changes, we guarantee "All or Nothing" consistency. Background workers can then pick up these jobs asynchronously for processing without blocking the primary request.

## 5. Team-Bound Work & Cross-Team Limitations
**Decision:** Work items are strictly scoped to a single `teamId`. Only members of that specific team can claim the work, and only managers of that specific team can approve it.
**Why:** While cross-team collaboration is common, allowing users to claim or approve tickets from departments they don't belong to leads to severe accountability issues. If a ticket requires another team's approval, the standard operational pattern is to create a linked sub-task in that team's queue. This enforces strict ownership boundaries as the system scales.
