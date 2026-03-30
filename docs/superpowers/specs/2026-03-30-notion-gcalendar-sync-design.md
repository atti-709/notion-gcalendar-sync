# Notion to Google Calendar Sync — Design Spec

## Overview

One-way sync from a Notion Tasks database to Google Calendar. Two sync streams map Notion "Spaces" to target calendars. Deployed as a Vercel (Hobby) Next.js app with a Notion webhook for near real-time updates and a daily cron for reconciliation.

## Sync Streams

| Stream | Notion Space ID | Filter | Target Calendar | Title Format |
|--------|----------------|--------|-----------------|--------------|
| Episodes | `e266c6db-7019-4f61-8eaa-604460fe066b` | Top-level only (no Parent-task), has Publish Date | Primary | `{Task name}` |
| Social Media (Publish) | `4b5db616-566e-422c-aeaf-562a7bebb13f` | All tasks with Publish Date | "Social Media" (auto-created) | `[PUBLISH] {Task name} ({Post Type}) [{Platforms}]` |
| Social Media (Deadline) | `4b5db616-566e-422c-aeaf-562a7bebb13f` | All tasks with Deadline | "Social Media" (same calendar) | `[DEADLINE] {Task name} ({Post Type}) [{Platforms}]` |
| Video | `9a87fda0-ca7f-40c5-b89d-c2e05a8a4e7c` | All tasks with Deadline | "Video" (auto-created) | `[DEADLINE] {Task name}` |

A single Social Media task can produce **two** calendar events: one for Publish Date and one for Deadline. They are tracked independently using distinct extended properties: `notionPageId` stores the page ID and `notionEventType` stores either `publish` or `deadline`.

- **Notion Database ID:** `e19eb46b-f771-43bc-b4c6-f3c9ca39bd22`
- **Historical cutoff:** Only tasks with dates within the last 30 days or in the future (configurable via `SYNC_CUTOFF_DAYS` env var). Applied to both Publish Date and Deadline.

## Architecture

Vercel Next.js project with two API routes. No external database — Google Calendar's `extendedProperties.private` stores `notionPageId` (the Notion page ID) and `notionEventType` (`publish` or `deadline`) on each event, serving as the mapping store. The combination of both properties uniquely identifies a calendar event.

### API Routes

- **`GET /api/sync`** — Full reconciliation. Called by daily cron (6am UTC) and can be triggered manually.
- **`POST /api/webhook`** — Receives Notion webhook events. Verifies signature, fetches the affected page, and runs reconciliation for that single task.

### Core Sync Logic

Both routes call the same reconciliation function. Per-task logic:

1. **No matching GCal event exists** — Create an all-day event with:
   - Title per stream's format
   - Description containing a clickable Notion link (`https://notion.so/{page_id}`)
   - `extendedProperties.private.notionPageId` set to the Notion page ID
2. **Matching event exists, task data changed** — Update title, date, and/or description
3. **Task status is Done or Archived** — Prefix title with `[DONE]` (continue updating if name/date changes)
4. **Task is trashed in Notion** — Delete the GCal event
5. **Matching event exists, nothing changed** — Skip

**Change detection:** Compare title, date, and status between Notion task and existing GCal event. Update if any differ.

**Overwrite policy:** Manual edits to calendar events are overwritten on next sync. Notion is the source of truth.

### Full Reconciliation Flow (`/api/sync`)

1. For each sync stream:
   a. Query Notion database filtered by Space, Publish Date not empty, and cutoff date
   b. For Episodes stream: additionally filter to tasks with no Parent-task
   c. Query Google Calendar for all events with `extendedProperties.private.notionPageId` set
   d. Build a map of `notionPageId → GCal event`
   e. For each Notion task: create, update, mark done, or skip per the rules above
   f. For each GCal event whose `notionPageId` is not in the current Notion results: check if the task was trashed → delete the event

### Webhook Flow (`/api/webhook`)

1. Receive Notion `page.content_updated` event
2. Verify `X-Notion-Signature` header (HMAC-SHA256 with verification token)
3. Fetch the updated page from Notion API
4. Check if it belongs to a configured sync stream (correct Space, has Publish Date, passes filters)
5. If yes: fetch matching GCal event by `notionPageId`, run reconciliation for that single task
6. If no: ignore
7. Return 200

Edge cases:
- Webhook down → daily cron catches up
- Batched/delayed events → reconciliation is idempotent
- Irrelevant tasks → ignored, return 200

## Google Calendar Authentication

OAuth2 with a stored refresh token:

1. One-time: run `scripts/google-auth.ts` locally, which opens a browser for consent and outputs a refresh token
2. Store refresh token + client credentials as Vercel env vars
3. At runtime: use refresh token to obtain short-lived access tokens

**Scope:** `https://www.googleapis.com/auth/calendar`

## Social Media Calendar Auto-Creation

On first sync, if a calendar named "Social Media" doesn't exist, create it via the Google Calendar API. Cache the calendar ID in memory for the duration of the request (stateless — looked up each invocation).

## Environment Variables

```
# Notion
NOTION_API_KEY=
NOTION_DATABASE_ID=e19eb46bf77143bcb4c6f3c9ca39bd22
NOTION_WEBHOOK_SECRET=

# Google Calendar
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=

# Sync config
SYNC_CUTOFF_DAYS=30
SYNC_SECRET=
```

## Project Structure

```
notion-gcalendar-sync/
├── src/
│   ├── app/
│   │   └── api/
│   │       ├── sync/
│   │       │   └── route.ts          # GET - full reconciliation (cron + manual)
│   │       └── webhook/
│   │           └── route.ts          # POST - Notion webhook handler
│   ├── lib/
│   │   ├── notion.ts                 # Notion API client & query helpers
│   │   ├── google-calendar.ts        # GCal API client & event CRUD
│   │   ├── sync.ts                   # Core reconciliation logic
│   │   └── config.ts                 # Stream definitions & env parsing
├── scripts/
│   └── google-auth.ts                # One-time OAuth2 token generator
├── .env
├── .gitignore
├── vercel.json
├── package.json
└── tsconfig.json
```

## Cron Configuration

```json
// vercel.json
{
  "crons": [{ "path": "/api/sync", "schedule": "0 6 * * *" }]
}
```

Daily at 6am UTC.

## Security

- Webhook endpoint verifies Notion's HMAC-SHA256 signature before processing
- `/api/sync` is protected by a `SYNC_SECRET` env var — the cron/manual caller must pass it as `?secret=<value>` query parameter
- `.env` and credentials never committed to git

## Dependencies

- `@notionhq/client` — official Notion SDK
- `googleapis` — Google Calendar API
- `next` — Next.js framework
