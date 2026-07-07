# Backend Architecture Analysis

This document provides a deep, exhaustive analysis of the `backend` directory, breaking down the modules, explaining their functionality, and highlighting severe architectural issues, bugs, duplicates, and dead code.

---

## 1. Module-by-Module Breakdown

### 1.1 Config & Database (`config/`, `sql/`, `scripts/`)
- **WHAT**: Handles database connections, setup, and on-the-fly migrations.
- **WHERE**: Specifically `config/db.ts`.
- **HOW**: Instead of using standard migration tools (e.g., Prisma, Knex), `config/db.ts` executes raw DDL statements on application start. It checks for missing columns/tables and applies patches dynamically (e.g., `addColIfMissing`, `renameColIfNeeded`). The database structure is a hybrid: a NoSQL-like `app_records` table for core entities (using JSONB) alongside standard relational tables (`rota_shifts`, `timesheets`, etc.).

### 1.2 Data Access Layer (`lib/`, `models/`)
- **WHAT**: Defines entities and provides the persistence mechanism to interact with the database.
- **WHERE**: `lib/model.ts`, `lib/recordModel.ts`, `lib/supabase.ts`, and individual entity files in `models/`.
- **HOW**: 
  - `lib/model.ts` and `lib/recordModel.ts` act as a custom, pseudo-Mongoose ORM. They abstract operations like `aggregate`, `findOneAndUpdate`, and `populate`, but ultimately stringify objects into a single Postgres JSONB column in the `app_records` table.
  - `lib/supabase.ts` is used when direct access to the standard relational tables is required (e.g., in `models/BasePattern.ts` and `models/Surgery.ts`).

### 1.3 Business Logic & Routing (`controllers/`, `routes/`)
- **WHAT**: The core application logic, mapped to REST APIs.
- **WHERE**: Files in `controllers/` and `routes/`.
- **HOW**: 
  - **Auth**: `authController.ts` handles JWT and sessions.
  - **Clinicians**: `clinicianController.ts` and `clinicianComplianceController.ts` manage profiles and compliance logic.
  - **Clients (PCN, Practice)**: `clientController.ts` manages client organizations.
  - **Rota & Shifts**: `rotaController.ts` (massive file) orchestrates complex shift scheduling and coverage logic.
  - **Timesheets**: `timesheetController.ts` and `timeEntryController.ts` manage working hours and leave.

### 1.4 Middleware (`middleware/`)
- **WHAT**: Intercepts requests for cross-cutting concerns like security and auditing.
- **WHERE**: `auth.ts`, `roleCheck.ts`, `auditLogger.ts`.
- **HOW**: Standard Express middleware that parses tokens, verifies user roles (RBAC), and logs sensitive operations to an `AuditLog` entity.

---

## 2. Bugs, Duplicates, Dead Code, and Missing Pieces

### 2.1 Duplicates (Severe)
- **`lib/model.ts` vs `lib/recordModel.ts`**: 
  These two files are 95% identical, duplicating over 600 lines of complex ORM logic (e.g., `applyUpdateOperators`, `deepMerge`, `matchesFilter`, `aggregate`). The only difference is that `recordModel.ts` introduces `fixedData` to allow for Single Table Inheritance (differentiating models within the same `tableModel` bucket). They must be refactored into a single utility file to prevent divergent bugs.

### 2.2 Bugs & Architectural Flaws
- **Data Siloing Bug in Models**:
  In `models/ContactHistory.ts`, there is an explicit comment highlighting a "ROOT CAUSE FIX" where the model was transitioned from `createModel` to `createRepository`. Because `model.ts` and `recordModel.ts` behave slightly differently under the hood, entities created with one system became invisible to the other. This indicates extreme fragility in the custom ORM.
- **Split-Brain Architecture (The "Sync Stub" Anti-Pattern)**:
  Because the backend stores primary entities (like `Clinician`) in a JSONB NoSQL format (`app_records`), but uses strictly relational tables for schedules (`rota_shifts`), standard SQL JOINs are impossible. To bypass this, `lib/syncClinicianStub.ts` (lines 23-26) explicitly clones data from the JSONB profiles into a `clinicians` SQL stub table. This is highly prone to data desyncs and race conditions. If you need SQL JOINs, the entities should be normalized in relational tables, not JSONB blobs.

### 2.3 Dead Code (Completely Unused)
- **`controllers/rateHistoryController.ts`**:
  This file is completely unhooked from any router. The top of the file literally contains a copy-paste instruction comment: *"RATE & CONTRACT HISTORY - Add this block to clientController.js"*. The developer saved the snippet as a file instead of integrating it. It is entirely dead code.
- **`controllers/scopeController.ts`**:
  Intended to handle "Tab 9 - Scope of Practice" and specifies routes to add to `clinicianRoutes.js`. However, it was never imported into `clinicianRoutes.ts` or any other router file. It is dead code.

### 2.4 Missing Pieces
- **Service Layer**: Controllers like `rotaController.ts` (~1,995 lines) and `clientController.ts` (~2,000 lines) are massively bloated. The backend is missing a distinct Service Layer to decouple routing from business logic.
- **Standardized ORM**: The usage of a custom Mongoose-like layer over Postgres JSONB is a massive technical debt. A standard ORM (like Prisma or Drizzle) would eliminate the need for hundreds of lines of brittle persistence code and the need for sync-stubs.
- **Robust Migration Tooling**: Using `config/db.ts` to randomly run `addColIfMissing` is dangerous for production systems. Proper stateful migrations are missing.
