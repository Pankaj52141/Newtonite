# Newtonite

A full-stack operational work management system built to guarantee correctness under concurrency and reliable state transitions.

## Tech Stack
* **Backend:** Node.js, Express, TypeScript, Prisma
* **Database:** PostgreSQL (with embedded support for easy testing)
* **Frontend:** React, TypeScript, Vite, TanStack Query
* **Testing:** Vitest, Supertest

## Getting Started

I have configured the project to run entirely using Node.js without requiring a system-level PostgreSQL installation. It uses an embedded PostgreSQL binary.

### 1. Install Dependencies
Make sure to be in root directiry first
```bash
# Install root, server, and client dependencies
npm install
cd server
npm install
cd ../client
npm install
cd ..
```

### 2. Start the Database
Open a new terminal window (Terminal 1) and run:
make sure to be in root directory
```bash
npx ts-node scripts/start-db.ts
```

### 3. Setup DB & Start Application
In your original terminal window (Terminal 2), run the migrations, seed the data, and start the app:
Make sure to be in root directory
```bash
npm run db:migrate:dev
npm run db:seed
npm run dev
```


## Running Integration Tests
The project includes a comprehensive suite of 28 integration tests that run against a real PostgreSQL instance to verify concurrency, idempotency, and authorization rules.

make sure you are in root directory
```bash
npx ts-node scripts/start-db.ts
npm run test:integration
```

## System Architecture & Authorization

```mermaid
graph TD
    %% Define styles
    classDef client fill:#3b82f6,stroke:#1d4ed8,color:white,font-weight:bold;
    classDef server fill:#10b981,stroke:#047857,color:white,font-weight:bold;
    classDef db fill:#f59e0b,stroke:#b45309,color:white,font-weight:bold;
    classDef worker fill:#8b5cf6,stroke:#6d28d9,color:white,font-weight:bold;
    classDef role fill:#475569,stroke:#1e293b,color:white;

    %% Components
    UI[React Client Frontend]:::client
    API[Express API Server]:::server
    DB[(PostgreSQL Database)]:::db
    Worker[Background Outbox Worker]:::worker

    %% Flow
    UI -->|HTTP Requests| API
    API -->|Auth & Idempotency Check| API
    API -->|Read/Write Data + Outbox Events| DB
    Worker -->|Polls Outbox Events| DB
    Worker -->|Executes Async Tasks| External[External Integrations]
    
    %% Authorization Box
    subgraph Authorization [Role-Based Access Control]
        Manager[MANAGER]:::role -.->|Full Access, Reassign, Approve| API
        Member[MEMBER]:::role -.->|Create, Claim, Edit Own| API
        Viewer[VIEWER]:::role -.->|Read-Only Access| API
    end
```

## Critical Behaviors Implemented
1. **Concurrency:** Prevents "Lost Updates" via optimistic concurrency control (versioning). Prevents simultaneous claims via atomic updates.
2. **Authorization:** Granular RBAC (Manager, Member, Viewer) preventing unauthorized state transitions or access.
3. **Auditability:** Complete transactional audit log (`ActivityEvent`) of all changes and comments.
4. **Resilience:** Implements the Transactional Outbox pattern for background jobs to guarantee "at-least-once" delivery without 2-phase commits.
5. **Idempotency:** Protects creation endpoints with `Idempotency-Key` headers to prevent duplicate records during network retries.

## Troubleshooting: Busy Ports

By default, this project uses the following ports:
- **Frontend (Vite):** `5173`
- **Backend (API):** `3001`
- **Database (PostgreSQL):** `5432`

If any of these ports are currently in use by another application on your system, the project will fail to start. You can change them by modifying the configuration files:

1. **Change Database or Backend Port:**
   If the default database port (`5432`) is busy, `scripts/start-db.ts` will automatically find the next available port (e.g., `5433`). If this happens, you must manually update your `.env` file to match the port it printed in the terminal:
   ```env
   # Update 5432 to the port chosen by start-db.ts (e.g., 5433)
   DATABASE_URL="postgresql://newtonite:newtonite_dev@localhost:5433/newtonite"
   TEST_DATABASE_URL="postgresql://newtonite:newtonite_dev@localhost:5433/newtonite_test"
   
   # If the backend API port (3001) is busy, you can change it here:
   PORT=3002
   ```

2. **Change Frontend Port:**
   If the Vite frontend port (`5173`) is busy, Vite will automatically try the next available port (e.g. `5174`).
   However, if you changed the **Backend** port (to `3002`), you must tell the frontend where to find it. Create or edit `client/.env` and add:
   ```env
   VITE_API_URL="http://localhost:3002"
   ```
