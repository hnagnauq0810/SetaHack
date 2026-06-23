# Setup and Run Instructions

This guide explains how to set up and run the Seta Agent Platform locally.

It does not replace the existing `README.md`; it is a standalone quick-start file.

## Prerequisites

Install these tools first:

| Tool | Required version | Check command |
| --- | --- | --- |
| Node.js | 24 LTS or newer | `node --version` |
| pnpm | 11 or newer | `pnpm --version` |
| Docker | Running Docker Engine | `docker info` |

The project expects Node `>=24`. Running with Node 22 may work for some commands, but it can cause dev-server and dependency issues.

## 1. Install dependencies

From the repository root:

```bash
pnpm install
```

## 2. Create local environment file

Copy the example file:

```bash
cp .env.example .env
```

For Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Fill at least these local-required values in `.env`:

| Variable | Purpose | Example generation |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | Auth/session signing secret | `openssl rand -hex 32` |
| `CRYPTO_LOCAL_MASTER_KEY` | Local encryption key | `pnpm --filter @seta/shared-crypto crypto:gen-local-key` |
| `OPENAI_API_KEY` | Agent model access | Your OpenAI API key |

Local defaults already point to the Docker dev stack:

```env
PUBLIC_URL=http://localhost:5173
DATABASE_URL=postgres://seta:seta@localhost:5542/seta
CORS_ORIGINS=http://localhost:5173
```

## 3. Start local infrastructure

Start Postgres, Redis, and local observability services:

```bash
pnpm db:up
```

Apply database migrations:

```bash
pnpm db:migrate
```

Seed demo data:

```bash
pnpm db:seed
```

For L&D Reporting demos, use the dedicated Manager and BOD accounts:

```text
L&D Manager
Email:    manager@hackathon.com
Password: ChangeMe@2026

BOD / Board viewer
Email:    bod@hackathon.com
Password: ChangeMe@2026
```

The admin account is still available for administration and fallback access:

```text
Email:    admin@hackathon.com
Password: ChangeMe@2026
```

## 4. Run the app

Run the full dev stack:

```bash
pnpm dev
```

Then open:

```text
http://localhost:5173/login
```

## 5. Recommended split dev mode

For easier debugging, run backend and frontend in separate terminals.

Terminal 1:

```bash
pnpm -F @seta/server dev
```

Wait until the server prints:

```text
server listening
```

Terminal 2:

```bash
pnpm -F @seta/web dev
```

Open:

```text
http://localhost:5173/
```

The web app proxies `/api/*` requests to the backend at:

```text
http://localhost:3000
```

You can check backend health with:

```bash
curl http://localhost:3000/health/ready
```

## 6. Useful commands

| Command | Description |
| --- | --- |
| `pnpm db:up` | Start local Docker services |
| `pnpm db:down` | Stop local Docker services |
| `pnpm db:migrate` | Run migrations |
| `pnpm db:seed` | Seed demo data |
| `pnpm db:reset` | Recreate DB volume, migrate, and seed |
| `pnpm dev` | Run all dev services through Turbo |
| `pnpm -F @seta/server dev` | Run backend only |
| `pnpm -F @seta/web dev` | Run frontend only |
| `pnpm typecheck` | Typecheck all workspaces |
| `pnpm lint` | Run repository lint checks |
| `pnpm test` | Run test suites |
| `pnpm test:e2e` | Run web end-to-end tests |

## 7. L&D Reporting demo flow

Use two separate sessions, browsers, or browser profiles so the role difference is visible.

### L&D Manager account

Sign in as:

```text
manager@hackathon.com / ChangeMe@2026
```

Open the L&D Reporting workspace from the sidebar.

The Manager account is used to:

- generate draft L&D reports from chat;
- inspect Evidence Gate, metrics, quality, risks, and recommendations;
- save draft reports to the Reports workspace;
- edit draft narrative fields when needed;
- approve/finalize reports;
- export manager-level PPTX/DOCX artifacts.

Suggested demo prompts:

```text
create report AWS Cloud Architecture & Services
```

```text
Detailed infomation about course AI Agent
```

```text
Compare with course AWS Cloud Architecture & Services
```

### BOD account

Sign out, or use another browser profile, then sign in as:

```text
bod@hackathon.com / ChangeMe@2026
```

Open the L&D Reporting workspace.

The BOD account is used to verify RBAC behavior:

- BOD sees finalized reports only;
- draft and revision-requested reports are hidden;
- learner-level or employee-sensitive data is masked;
- BOD can download final PPTX/DOCX artifacts;
- BOD Q&A is grounded only in finalized reports.

Suggested demo prompts:

```text
Summarize finalized reports
```

```text
What is the total avarage score of this course
```

```text
Is there anyone at risk?
```

The last question should answer at an aggregate/masked level for BOD, not expose raw employee IDs or individual scores.

For the Reporting Agent chat flow, keep the backend running while the chat response is streaming. If the backend restarts during a streaming chat response, the UI may stay in a thinking state and the request should be retried.

Generated L&D data and evidence files may appear under:

```text
.data/
evidence/
```

## 8. Troubleshooting

### `Unsupported engine: wanted node >=24`

Install and use Node 24 LTS.

### `ECONNREFUSED` from Vite proxy

The frontend cannot reach the backend at `localhost:3000`.

Fix:

```bash
pnpm -F @seta/server dev
```

Then retry:

```bash
curl http://localhost:3000/health/ready
```

### `ECONNRESET` during chat or notification stream

The backend connection was closed while the frontend was streaming data. This commonly happens when the backend dev server restarts.

Fix:

- wait for `server listening`;
- refresh the page;
- retry the chat request;
- avoid saving backend files during a live chat stream.

### Database connection error on port `5542`

Postgres is not running or is still starting.

Fix:

```bash
pnpm db:up
pnpm db:migrate
```

### Login rejects credentials

The database likely has no seeded users.

Fix:

```bash
pnpm db:seed
```

Then use:

```text
manager@hackathon.com / ChangeMe@2026
bod@hackathon.com / ChangeMe@2026
```

Use `admin@hackathon.com / ChangeMe@2026` only for admin setup or fallback checks.

### Start from a clean local database

This is destructive for local Docker data:

```bash
pnpm db:reset
```

## 9. Verification checklist

Before handing off a local setup, verify:

- `pnpm db:up` completed successfully.
- `pnpm db:migrate` completed successfully.
- `pnpm db:seed` completed successfully.
- `curl http://localhost:3000/health/ready` returns `ok: true`.
- `http://localhost:5173/login` loads.
- Login works with `manager@hackathon.com / ChangeMe@2026`.
- Login works with `bod@hackathon.com / ChangeMe@2026`.
- Manager can generate/finalize an L&D report.
- BOD can see the finalized report but cannot see draft reports.
- `pnpm typecheck` passes.
