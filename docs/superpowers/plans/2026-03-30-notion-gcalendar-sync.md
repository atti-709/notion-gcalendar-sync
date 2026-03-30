# Notion-GCal Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-way sync of Notion tasks (Episodes, Social Media, Video spaces) to Google Calendar as all-day events, deployed on Vercel with webhook + daily cron.

**Architecture:** Stateless Next.js app on Vercel. Two API routes (`/api/sync` for full reconciliation, `/api/webhook` for Notion push events) call shared sync logic. Google Calendar `extendedProperties` stores Notion page IDs — no external database needed.

**Tech Stack:** TypeScript, Next.js (App Router), `@notionhq/client`, `googleapis`, Vercel Hobby

**Spec:** `docs/superpowers/specs/2026-03-30-notion-gcalendar-sync-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/lib/config.ts` | Environment parsing, sync stream definitions, types |
| `src/lib/notion.ts` | Notion API client: query tasks by space, fetch single page |
| `src/lib/google-calendar.ts` | GCal API client: auth, find/create/update/delete events, find/create calendars |
| `src/lib/sync.ts` | Core reconciliation: compare Notion tasks vs GCal events, apply CRUD |
| `src/app/api/sync/route.ts` | GET handler: secret check, run full reconciliation for all streams |
| `src/app/api/webhook/route.ts` | POST handler: verify signature, fetch page, run single-task reconciliation |
| `scripts/google-auth.ts` | One-time OAuth2 consent flow, prints refresh token |
| `vercel.json` | Cron config |
| `.gitignore` | Standard Node + .env exclusions |
| `package.json` | Dependencies and scripts |
| `tsconfig.json` | TypeScript config |

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `vercel.json`
- Modify: `.env` (add new vars)

- [ ] **Step 1: Initialize git repo**

```bash
cd /Users/atti/Source/Repos/notion-gcalendar-sync
git init
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "notion-gcalendar-sync",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "google-auth": "npx tsx scripts/google-auth.ts"
  },
  "dependencies": {
    "@notionhq/client": "^2.2.15",
    "googleapis": "^144.0.0",
    "next": "^15.3.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "tsx": "^4.19.0",
    "vitest": "^3.1.0"
  }
}
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
.next/
.env
.env.local
.vercel
```

- [ ] **Step 5: Create `vercel.json`**

```json
{
  "crons": [{ "path": "/api/sync?secret=${SYNC_SECRET}", "schedule": "0 6 * * *" }]
}
```

- [ ] **Step 6: Update `.env` with all required variables**

```
# Notion
NOTION_API_KEY=<your-notion-api-key>
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

- [ ] **Step 7: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` generated.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore vercel.json
git commit -m "chore: scaffold project with Next.js, Notion SDK, and Google APIs"
```

---

### Task 2: Config & Types (`src/lib/config.ts`)

**Files:**
- Create: `src/lib/config.ts`
- Test: `src/lib/__tests__/config.test.ts`

- [ ] **Step 1: Write failing test for `getEnv`**

Create `src/lib/__tests__/config.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("getEnv", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns env value when set", async () => {
    vi.stubEnv("NOTION_API_KEY", "test-key");
    const { getEnv } = await import("../config");
    expect(getEnv("NOTION_API_KEY")).toBe("test-key");
  });

  it("throws when required env is missing", async () => {
    vi.stubEnv("NOTION_API_KEY", "");
    const { getEnv } = await import("../config");
    expect(() => getEnv("NOTION_API_KEY")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/config.ts`**

```typescript
export function getEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export type NotionEventType = "publish" | "deadline";

export interface SyncStream {
  name: string;
  spaceId: string;
  calendarId?: string;       // if set, use this calendar ID directly (e.g., "primary")
  calendarName?: string;     // if set, find or create calendar by this name
  topLevelOnly: boolean;
  notionDateProperty: string; // "Publish Date" or "Deadline"
  eventType: NotionEventType;
  titleFormat: (task: TaskData) => string;
}

export interface TaskData {
  pageId: string;
  taskName: string;
  date: string;           // "YYYY-MM-DD"
  status: string;         // "Not started", "In progress", "Done", "Archived"
  isInTrash: boolean;
  postType: string | null;
  platforms: string[];
}

export function getSyncStreams(): SyncStream[] {
  return [
    {
      name: "Episodes",
      spaceId: "e266c6db-7019-4f61-8eaa-604460fe066b",
      calendarId: "primary",
      topLevelOnly: true,
      notionDateProperty: "Publish Date",
      eventType: "publish",
      titleFormat: ({ taskName }) => taskName,
    },
    {
      name: "Social Media (Publish)",
      spaceId: "4b5db616-566e-422c-aeaf-562a7bebb13f",
      calendarName: "Social Media",
      topLevelOnly: false,
      notionDateProperty: "Publish Date",
      eventType: "publish",
      titleFormat: ({ taskName, postType, platforms }) => {
        let title = `[PUBLISH] ${taskName}`;
        if (postType) title += ` (${postType})`;
        if (platforms.length) title += ` [${platforms.join(", ")}]`;
        return title;
      },
    },
    {
      name: "Social Media (Deadline)",
      spaceId: "4b5db616-566e-422c-aeaf-562a7bebb13f",
      calendarName: "Social Media",
      topLevelOnly: false,
      notionDateProperty: "Deadline",
      eventType: "deadline",
      titleFormat: ({ taskName, postType, platforms }) => {
        let title = `[DEADLINE] ${taskName}`;
        if (postType) title += ` (${postType})`;
        if (platforms.length) title += ` [${platforms.join(", ")}]`;
        return title;
      },
    },
    {
      name: "Video",
      spaceId: "9a87fda0-ca7f-40c5-b89d-c2e05a8a4e7c",
      calendarName: "Video",
      topLevelOnly: false,
      notionDateProperty: "Deadline",
      eventType: "deadline",
      titleFormat: ({ taskName }) => `[DEADLINE] ${taskName}`,
    },
  ];
}

export function getCutoffDate(): string {
  const days = parseInt(process.env.SYNC_CUTOFF_DAYS || "30", 10);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff.toISOString().split("T")[0];
}
```

- [ ] **Step 4: Add test for `getSyncStreams` and `getCutoffDate`**

Append to `src/lib/__tests__/config.test.ts`:

```typescript
import { getSyncStreams, getCutoffDate } from "../config";

describe("getSyncStreams", () => {
  it("returns 4 streams", () => {
    expect(getSyncStreams()).toHaveLength(4);
  });

  it("Episodes stream targets primary calendar", () => {
    const episodes = getSyncStreams().find((s) => s.name === "Episodes")!;
    expect(episodes.calendarId).toBe("primary");
    expect(episodes.topLevelOnly).toBe(true);
    expect(episodes.eventType).toBe("publish");
  });

  it("Social Media Publish formats title with post type and platforms", () => {
    const sm = getSyncStreams().find((s) => s.name === "Social Media (Publish)")!;
    const title = sm.titleFormat({
      pageId: "x",
      taskName: "PROMO E05",
      date: "2025-01-01",
      status: "Not started",
      isInTrash: false,
      postType: "Reels",
      platforms: ["Instagram"],
    });
    expect(title).toBe("[PUBLISH] PROMO E05 (Reels) [Instagram]");
  });

  it("Video stream formats title with deadline prefix", () => {
    const video = getSyncStreams().find((s) => s.name === "Video")!;
    const title = video.titleFormat({
      pageId: "x",
      taskName: "Edit episode",
      date: "2025-01-01",
      status: "Not started",
      isInTrash: false,
      postType: null,
      platforms: [],
    });
    expect(title).toBe("[DEADLINE] Edit episode");
  });
});

describe("getCutoffDate", () => {
  it("returns a date string in YYYY-MM-DD format", () => {
    expect(getCutoffDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
```

- [ ] **Step 5: Run all tests**

Run: `npx vitest run src/lib/__tests__/config.test.ts`
Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/config.ts src/lib/__tests__/config.test.ts
git commit -m "feat: add config module with sync stream definitions and types"
```

---

### Task 3: Notion Client (`src/lib/notion.ts`)

**Files:**
- Create: `src/lib/notion.ts`
- Test: `src/lib/__tests__/notion.test.ts`

- [ ] **Step 1: Write failing test for `parseNotionTask`**

Create `src/lib/__tests__/notion.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseNotionTask } from "../notion";

describe("parseNotionTask", () => {
  it("parses a Notion page into TaskData for Publish Date", () => {
    const page = {
      id: "abc-123",
      in_trash: false,
      properties: {
        "Task name": {
          type: "title",
          title: [{ plain_text: "Episode #30" }],
        },
        "Publish Date": {
          type: "date",
          date: { start: "2025-04-01" },
        },
        Deadline: {
          type: "date",
          date: null,
        },
        Status: {
          type: "status",
          status: { name: "In progress" },
        },
        "Post Type": {
          type: "select",
          select: null,
        },
        Platform: {
          type: "multi_select",
          multi_select: [],
        },
        "Parent-task": {
          type: "relation",
          relation: [],
        },
      },
    } as any;

    const result = parseNotionTask(page, "Publish Date");
    expect(result).toEqual({
      pageId: "abc-123",
      taskName: "Episode #30",
      date: "2025-04-01",
      status: "In progress",
      isInTrash: false,
      postType: null,
      platforms: [],
    });
  });

  it("returns null when date property is empty", () => {
    const page = {
      id: "abc-123",
      in_trash: false,
      properties: {
        "Task name": { type: "title", title: [{ plain_text: "Test" }] },
        "Publish Date": { type: "date", date: null },
        Status: { type: "status", status: { name: "Not started" } },
        "Post Type": { type: "select", select: null },
        Platform: { type: "multi_select", multi_select: [] },
        "Parent-task": { type: "relation", relation: [] },
      },
    } as any;

    const result = parseNotionTask(page, "Publish Date");
    expect(result).toBeNull();
  });

  it("parses post type and platforms", () => {
    const page = {
      id: "def-456",
      in_trash: false,
      properties: {
        "Task name": { type: "title", title: [{ plain_text: "Promo" }] },
        "Publish Date": { type: "date", date: { start: "2025-05-01" } },
        Deadline: { type: "date", date: { start: "2025-04-28" } },
        Status: { type: "status", status: { name: "Not started" } },
        "Post Type": { type: "select", select: { name: "Reels" } },
        Platform: { type: "multi_select", multi_select: [{ name: "Instagram" }, { name: "TikTok" }] },
        "Parent-task": { type: "relation", relation: [] },
      },
    } as any;

    const result = parseNotionTask(page, "Publish Date");
    expect(result!.postType).toBe("Reels");
    expect(result!.platforms).toEqual(["Instagram", "TikTok"]);
  });

  it("detects trashed pages", () => {
    const page = {
      id: "ghi-789",
      in_trash: true,
      properties: {
        "Task name": { type: "title", title: [{ plain_text: "Old" }] },
        "Publish Date": { type: "date", date: { start: "2025-01-01" } },
        Status: { type: "status", status: { name: "Done" } },
        "Post Type": { type: "select", select: null },
        Platform: { type: "multi_select", multi_select: [] },
        "Parent-task": { type: "relation", relation: [] },
      },
    } as any;

    const result = parseNotionTask(page, "Publish Date");
    expect(result!.isInTrash).toBe(true);
  });

  it("identifies top-level tasks (no parent)", () => {
    const page = {
      id: "jkl-012",
      in_trash: false,
      properties: {
        "Task name": { type: "title", title: [{ plain_text: "Ep" }] },
        "Publish Date": { type: "date", date: { start: "2025-06-01" } },
        Status: { type: "status", status: { name: "Not started" } },
        "Post Type": { type: "select", select: null },
        Platform: { type: "multi_select", multi_select: [] },
        "Parent-task": { type: "relation", relation: [{ id: "parent-id" }] },
      },
    } as any;

    expect(parseNotionTask(page, "Publish Date")!.pageId).toBe("jkl-012");
    // hasParent is checked at the stream level, not in parseNotionTask
  });
});

describe("hasParentTask", () => {
  it("returns true when parent-task relation is non-empty", async () => {
    const { hasParentTask } = await import("../notion");
    const page = {
      properties: {
        "Parent-task": { type: "relation", relation: [{ id: "parent-id" }] },
      },
    } as any;
    expect(hasParentTask(page)).toBe(true);
  });

  it("returns false when parent-task relation is empty", async () => {
    const { hasParentTask } = await import("../notion");
    const page = {
      properties: {
        "Parent-task": { type: "relation", relation: [] },
      },
    } as any;
    expect(hasParentTask(page)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/notion.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/notion.ts`**

```typescript
import { Client } from "@notionhq/client";
import { getEnv } from "./config";
import type { TaskData } from "./config";

export function getNotionClient(): Client {
  return new Client({ auth: getEnv("NOTION_API_KEY") });
}

export function parseNotionTask(page: any, dateProperty: string): TaskData | null {
  const dateProp = page.properties[dateProperty];
  if (!dateProp?.date?.start) return null;

  const titleProp = page.properties["Task name"];
  const taskName = titleProp?.title?.[0]?.plain_text ?? "";

  const statusProp = page.properties["Status"];
  const status = statusProp?.status?.name ?? "Not started";

  const postTypeProp = page.properties["Post Type"];
  const postType = postTypeProp?.select?.name ?? null;

  const platformProp = page.properties["Platform"];
  const platforms = (platformProp?.multi_select ?? []).map((p: any) => p.name);

  return {
    pageId: page.id,
    taskName,
    date: dateProp.date.start,
    status,
    isInTrash: page.in_trash ?? false,
    postType,
    platforms,
  };
}

export function hasParentTask(page: any): boolean {
  const parentRel = page.properties["Parent-task"];
  return (parentRel?.relation?.length ?? 0) > 0;
}

export async function queryTasksBySpace(
  client: Client,
  databaseId: string,
  spaceId: string,
  dateProperty: string,
  cutoffDate: string
): Promise<any[]> {
  const pages: any[] = [];
  let cursor: string | undefined;

  do {
    const response = await client.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      filter: {
        and: [
          { property: "Space", relation: { contains: spaceId } },
          { property: dateProperty, date: { on_or_after: cutoffDate } },
        ],
      },
    });

    pages.push(...response.results);
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return pages;
}

export async function fetchPage(client: Client, pageId: string): Promise<any> {
  return client.pages.retrieve({ page_id: pageId });
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/__tests__/notion.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/notion.ts src/lib/__tests__/notion.test.ts
git commit -m "feat: add Notion client with task parsing and query helpers"
```

---

### Task 4: Google Calendar Client (`src/lib/google-calendar.ts`)

**Files:**
- Create: `src/lib/google-calendar.ts`
- Test: `src/lib/__tests__/google-calendar.test.ts`

- [ ] **Step 1: Write failing test for `buildEventTitle`**

Create `src/lib/__tests__/google-calendar.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildEventTitle } from "../google-calendar";
import type { TaskData, SyncStream } from "../config";

const makeTask = (overrides: Partial<TaskData> = {}): TaskData => ({
  pageId: "test-id",
  taskName: "Test Task",
  date: "2025-04-01",
  status: "Not started",
  isInTrash: false,
  postType: null,
  platforms: [],
  ...overrides,
});

describe("buildEventTitle", () => {
  const titleFormat = (task: TaskData) => task.taskName;

  it("returns plain title for active task", () => {
    const task = makeTask();
    expect(buildEventTitle(task, titleFormat)).toBe("Test Task");
  });

  it("prefixes [DONE] for Done status", () => {
    const task = makeTask({ status: "Done" });
    expect(buildEventTitle(task, titleFormat)).toBe("[DONE] Test Task");
  });

  it("prefixes [DONE] for Archived status", () => {
    const task = makeTask({ status: "Archived" });
    expect(buildEventTitle(task, titleFormat)).toBe("[DONE] Test Task");
  });

  it("does not double-prefix if titleFormat already includes a prefix", () => {
    const task = makeTask({ status: "Done" });
    const format = (t: TaskData) => `[PUBLISH] ${t.taskName}`;
    expect(buildEventTitle(task, format)).toBe("[DONE] [PUBLISH] Test Task");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/google-calendar.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/google-calendar.ts`**

```typescript
import { google, calendar_v3 } from "googleapis";
import { getEnv } from "./config";
import type { TaskData, NotionEventType } from "./config";

export function getCalendarClient(): calendar_v3.Calendar {
  const oauth2 = new google.auth.OAuth2(
    getEnv("GOOGLE_CLIENT_ID"),
    getEnv("GOOGLE_CLIENT_SECRET")
  );
  oauth2.setCredentials({ refresh_token: getEnv("GOOGLE_REFRESH_TOKEN") });
  return google.calendar({ version: "v3", auth: oauth2 });
}

const DONE_STATUSES = ["Done", "Archived"];

export function buildEventTitle(
  task: TaskData,
  titleFormat: (task: TaskData) => string
): string {
  const base = titleFormat(task);
  if (DONE_STATUSES.includes(task.status)) {
    return `[DONE] ${base}`;
  }
  return base;
}

export async function findOrCreateCalendar(
  cal: calendar_v3.Calendar,
  name: string
): Promise<string> {
  const list = await cal.calendarList.list();
  const existing = list.data.items?.find((c) => c.summary === name);
  if (existing?.id) return existing.id;

  const created = await cal.calendars.insert({
    requestBody: { summary: name },
  });
  return created.data.id!;
}

export async function getTrackedEvents(
  cal: calendar_v3.Calendar,
  calendarId: string,
  eventType: NotionEventType
): Promise<Map<string, calendar_v3.Schema$Event>> {
  const map = new Map<string, calendar_v3.Schema$Event>();
  let pageToken: string | undefined;

  do {
    const response = await cal.events.list({
      calendarId,
      privateExtendedProperty: [
        `notionEventType=${eventType}`,
      ],
      maxResults: 2500,
      singleEvents: true,
      pageToken,
    });

    for (const event of response.data.items ?? []) {
      const notionId = event.extendedProperties?.private?.notionPageId;
      if (notionId) {
        map.set(notionId, event);
      }
    }
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return map;
}

export async function createEvent(
  cal: calendar_v3.Calendar,
  calendarId: string,
  task: TaskData,
  eventType: NotionEventType,
  title: string
): Promise<void> {
  await cal.events.insert({
    calendarId,
    requestBody: {
      summary: title,
      description: `https://notion.so/${task.pageId.replace(/-/g, "")}`,
      start: { date: task.date },
      end: { date: task.date },
      extendedProperties: {
        private: {
          notionPageId: task.pageId,
          notionEventType: eventType,
        },
      },
    },
  });
}

export async function updateEvent(
  cal: calendar_v3.Calendar,
  calendarId: string,
  eventId: string,
  task: TaskData,
  title: string
): Promise<void> {
  await cal.events.patch({
    calendarId,
    eventId,
    requestBody: {
      summary: title,
      description: `https://notion.so/${task.pageId.replace(/-/g, "")}`,
      start: { date: task.date },
      end: { date: task.date },
    },
  });
}

export async function deleteEvent(
  cal: calendar_v3.Calendar,
  calendarId: string,
  eventId: string
): Promise<void> {
  await cal.events.delete({ calendarId, eventId });
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/__tests__/google-calendar.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/google-calendar.ts src/lib/__tests__/google-calendar.test.ts
git commit -m "feat: add Google Calendar client with event CRUD and calendar management"
```

---

### Task 5: Core Sync Logic (`src/lib/sync.ts`)

**Files:**
- Create: `src/lib/sync.ts`
- Test: `src/lib/__tests__/sync.test.ts`

- [ ] **Step 1: Write failing test for `reconcileTask`**

Create `src/lib/__tests__/sync.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { determineAction } from "../sync";
import type { TaskData } from "../config";
import type { calendar_v3 } from "googleapis";

const makeTask = (overrides: Partial<TaskData> = {}): TaskData => ({
  pageId: "test-id",
  taskName: "Test Task",
  date: "2025-04-01",
  status: "Not started",
  isInTrash: false,
  postType: null,
  platforms: [],
  ...overrides,
});

const makeEvent = (
  overrides: Partial<calendar_v3.Schema$Event> = {}
): calendar_v3.Schema$Event => ({
  id: "gcal-event-1",
  summary: "Test Task",
  start: { date: "2025-04-01" },
  ...overrides,
});

const titleFormat = (t: TaskData) => t.taskName;

describe("determineAction", () => {
  it("returns 'create' when no existing event", () => {
    const task = makeTask();
    expect(determineAction(task, null, titleFormat)).toEqual({
      action: "create",
      title: "Test Task",
    });
  });

  it("returns 'delete' when task is trashed", () => {
    const task = makeTask({ isInTrash: true });
    const event = makeEvent();
    expect(determineAction(task, event, titleFormat)).toEqual({
      action: "delete",
    });
  });

  it("returns 'skip' when nothing changed", () => {
    const task = makeTask();
    const event = makeEvent({ summary: "Test Task" });
    expect(determineAction(task, event, titleFormat)).toEqual({
      action: "skip",
    });
  });

  it("returns 'update' when title changed", () => {
    const task = makeTask({ taskName: "New Name" });
    const event = makeEvent({ summary: "Old Name" });
    expect(determineAction(task, event, titleFormat)).toEqual({
      action: "update",
      title: "New Name",
    });
  });

  it("returns 'update' when date changed", () => {
    const task = makeTask({ date: "2025-05-01" });
    const event = makeEvent({ start: { date: "2025-04-01" } });
    expect(determineAction(task, event, titleFormat)).toEqual({
      action: "update",
      title: "Test Task",
    });
  });

  it("returns 'update' with [DONE] prefix when status is Done", () => {
    const task = makeTask({ status: "Done" });
    const event = makeEvent({ summary: "Test Task" });
    expect(determineAction(task, event, titleFormat)).toEqual({
      action: "update",
      title: "[DONE] Test Task",
    });
  });

  it("returns 'skip' when already marked [DONE] and nothing else changed", () => {
    const task = makeTask({ status: "Done" });
    const event = makeEvent({
      summary: "[DONE] Test Task",
      start: { date: "2025-04-01" },
    });
    expect(determineAction(task, event, titleFormat)).toEqual({
      action: "skip",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/sync.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/sync.ts`**

```typescript
import type { calendar_v3 } from "googleapis";
import type { TaskData, SyncStream, NotionEventType } from "./config";
import { getEnv, getCutoffDate, getSyncStreams } from "./config";
import { getNotionClient, queryTasksBySpace, parseNotionTask, hasParentTask } from "./notion";
import {
  getCalendarClient,
  findOrCreateCalendar,
  getTrackedEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  buildEventTitle,
} from "./google-calendar";

export type SyncAction =
  | { action: "create"; title: string }
  | { action: "update"; title: string }
  | { action: "delete" }
  | { action: "skip" };

export function determineAction(
  task: TaskData,
  existingEvent: calendar_v3.Schema$Event | null,
  titleFormat: (task: TaskData) => string
): SyncAction {
  const title = buildEventTitle(task, titleFormat);

  if (!existingEvent) {
    if (task.isInTrash) return { action: "skip" };
    return { action: "create", title };
  }

  if (task.isInTrash) {
    return { action: "delete" };
  }

  const currentTitle = existingEvent.summary ?? "";
  const currentDate = existingEvent.start?.date ?? "";

  if (currentTitle === title && currentDate === task.date) {
    return { action: "skip" };
  }

  return { action: "update", title };
}

export interface SyncResult {
  stream: string;
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
}

export async function syncStream(stream: SyncStream): Promise<SyncResult> {
  const notion = getNotionClient();
  const cal = getCalendarClient();
  const databaseId = getEnv("NOTION_DATABASE_ID");
  const cutoffDate = getCutoffDate();

  const result: SyncResult = {
    stream: stream.name,
    created: 0,
    updated: 0,
    deleted: 0,
    skipped: 0,
  };

  // Resolve calendar ID
  let calendarId: string;
  if (stream.calendarId) {
    calendarId = stream.calendarId;
  } else {
    calendarId = await findOrCreateCalendar(cal, stream.calendarName!);
  }

  // Fetch Notion tasks
  const pages = await queryTasksBySpace(
    notion,
    databaseId,
    stream.spaceId,
    stream.notionDateProperty,
    cutoffDate
  );

  // Filter top-level only if needed
  const filteredPages = stream.topLevelOnly
    ? pages.filter((p) => !hasParentTask(p))
    : pages;

  // Parse tasks
  const tasks: TaskData[] = [];
  for (const page of filteredPages) {
    const task = parseNotionTask(page, stream.notionDateProperty);
    if (task) tasks.push(task);
  }

  // Fetch existing GCal events
  const existingEvents = await getTrackedEvents(cal, calendarId, stream.eventType);

  // Reconcile each task
  const seenPageIds = new Set<string>();
  for (const task of tasks) {
    seenPageIds.add(task.pageId);
    const existing = existingEvents.get(task.pageId) ?? null;
    const action = determineAction(task, existing, stream.titleFormat);

    switch (action.action) {
      case "create":
        await createEvent(cal, calendarId, task, stream.eventType, action.title);
        result.created++;
        break;
      case "update":
        await updateEvent(cal, calendarId, existing!.id!, task, action.title);
        result.updated++;
        break;
      case "delete":
        await deleteEvent(cal, calendarId, existing!.id!);
        result.deleted++;
        break;
      case "skip":
        result.skipped++;
        break;
    }
  }

  // Delete orphaned events (Notion task was trashed/removed and not in query results)
  for (const [notionId, event] of existingEvents) {
    if (!seenPageIds.has(notionId) && event.id) {
      await deleteEvent(cal, calendarId, event.id);
      result.deleted++;
    }
  }

  return result;
}

export async function syncAll(): Promise<SyncResult[]> {
  const streams = getSyncStreams();
  const results: SyncResult[] = [];
  for (const stream of streams) {
    results.push(await syncStream(stream));
  }
  return results;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/__tests__/sync.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sync.ts src/lib/__tests__/sync.test.ts
git commit -m "feat: add core sync reconciliation logic with stream-based processing"
```

---

### Task 6: Sync API Route (`src/app/api/sync/route.ts`)

**Files:**
- Create: `src/app/api/sync/route.ts`

- [ ] **Step 1: Create the route handler**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { syncAll } from "@/lib/sync";

export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const secret = request.nextUrl.searchParams.get("secret");
  const expectedSecret = process.env.SYNC_SECRET;

  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await syncAll();
    return NextResponse.json({ ok: true, results });
  } catch (error) {
    console.error("Sync failed:", error);
    return NextResponse.json(
      { error: "Sync failed", message: String(error) },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds with no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/sync/route.ts
git commit -m "feat: add /api/sync route with secret-based auth"
```

---

### Task 7: Webhook API Route (`src/app/api/webhook/route.ts`)

**Files:**
- Create: `src/app/api/webhook/route.ts`

- [ ] **Step 1: Create the webhook handler**

```typescript
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getEnv, getSyncStreams } from "@/lib/config";
import { getNotionClient, fetchPage, parseNotionTask, hasParentTask } from "@/lib/notion";
import {
  getCalendarClient,
  findOrCreateCalendar,
  getTrackedEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  buildEventTitle,
} from "@/lib/google-calendar";
import { determineAction } from "@/lib/sync";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.text();

  // Verify signature
  const signature = request.headers.get("x-notion-signature");
  const webhookSecret = process.env.NOTION_WEBHOOK_SECRET;
  if (webhookSecret && signature) {
    const expected = crypto
      .createHmac("sha256", webhookSecret)
      .update(body)
      .digest("hex");
    if (signature !== expected) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  const payload = JSON.parse(body);

  // Handle verification challenge
  if (payload.type === "url_verification") {
    return NextResponse.json({ challenge: payload.challenge });
  }

  // Process page update events
  const pageId = payload?.entity?.id;
  if (!pageId) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  try {
    const notion = getNotionClient();
    const cal = getCalendarClient();
    const page = await fetchPage(notion, pageId);
    const streams = getSyncStreams();

    // Check which streams this page belongs to
    const spaceRelations: string[] = (page as any).properties?.Space?.relation?.map(
      (r: any) => r.id
    ) ?? [];

    for (const stream of streams) {
      if (!spaceRelations.includes(stream.spaceId)) continue;
      if (stream.topLevelOnly && hasParentTask(page)) continue;

      const task = parseNotionTask(page, stream.notionDateProperty);

      // Resolve calendar ID
      let calendarId: string;
      if (stream.calendarId) {
        calendarId = stream.calendarId;
      } else {
        calendarId = await findOrCreateCalendar(cal, stream.calendarName!);
      }

      // Find existing event
      const existingEvents = await getTrackedEvents(cal, calendarId, stream.eventType);
      const existing = existingEvents.get(pageId) ?? null;

      if (!task) {
        // Date was cleared — delete event if it exists
        if (existing?.id) {
          await deleteEvent(cal, calendarId, existing.id);
        }
        continue;
      }

      const action = determineAction(task, existing, stream.titleFormat);

      switch (action.action) {
        case "create":
          await createEvent(cal, calendarId, task, stream.eventType, action.title);
          break;
        case "update":
          await updateEvent(cal, calendarId, existing!.id!, task, action.title);
          break;
        case "delete":
          if (existing?.id) await deleteEvent(cal, calendarId, existing.id);
          break;
        case "skip":
          break;
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Webhook processing failed:", error);
    return NextResponse.json({ ok: true }); // Return 200 to avoid retries
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/webhook/route.ts
git commit -m "feat: add /api/webhook route with Notion signature verification"
```

---

### Task 8: Google OAuth2 Auth Script (`scripts/google-auth.ts`)

**Files:**
- Create: `scripts/google-auth.ts`

- [ ] **Step 1: Create the auth script**

```typescript
import { google } from "googleapis";
import http from "http";
import { URL } from "url";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:3333/callback";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first");
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: ["https://www.googleapis.com/auth/calendar"],
});

console.log("\nOpen this URL in your browser:\n");
console.log(authUrl);
console.log("\nWaiting for callback...\n");

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith("/callback")) return;

  const url = new URL(req.url, `http://localhost:3333`);
  const code = url.searchParams.get("code");

  if (!code) {
    res.writeHead(400);
    res.end("Missing code parameter");
    return;
  }

  try {
    const { tokens } = await oauth2.getToken(code);
    console.log("=== Add this to your .env ===\n");
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<h1>Done! You can close this tab.</h1><p>Check your terminal for the refresh token.</p>");
  } catch (err) {
    console.error("Failed to get token:", err);
    res.writeHead(500);
    res.end("Token exchange failed");
  }

  server.close();
});

server.listen(3333);
```

- [ ] **Step 2: Verify the script compiles**

Run: `npx tsx --version`
Expected: tsx version prints without error.

- [ ] **Step 3: Commit**

```bash
git add scripts/google-auth.ts
git commit -m "feat: add Google OAuth2 one-time auth script"
```

---

### Task 9: Next.js Layout & App Config

**Files:**
- Create: `src/app/layout.tsx`

- [ ] **Step 1: Create minimal layout (required by Next.js)**

```typescript
export const metadata = {
  title: "Notion-GCal Sync",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 2: Verify full build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/layout.tsx
git commit -m "chore: add minimal Next.js layout"
```

---

### Task 10: End-to-End Manual Test

- [ ] **Step 1: Set up Google OAuth credentials**

1. Go to https://console.cloud.google.com/apis/credentials
2. Create an OAuth 2.0 Client ID (type: Web application)
3. Add `http://localhost:3333/callback` as an authorized redirect URI
4. Copy client ID and secret into `.env`

- [ ] **Step 2: Run the auth script to get a refresh token**

Run: `npm run google-auth`
Follow the browser flow, then copy the `GOOGLE_REFRESH_TOKEN` into `.env`.

- [ ] **Step 3: Set a `SYNC_SECRET` in `.env`**

Generate a random string and set it:
```
SYNC_SECRET=my-secret-value-here
```

- [ ] **Step 4: Start dev server and trigger sync**

Run: `npm run dev`

In another terminal:
```bash
curl "http://localhost:3000/api/sync?secret=my-secret-value-here"
```

Expected: JSON response with `{ ok: true, results: [...] }` showing created/updated/skipped counts per stream.

- [ ] **Step 5: Verify in Google Calendar**

Open Google Calendar and confirm:
- Episode tasks appear on the primary calendar
- Social Media tasks appear on a "Social Media" calendar (auto-created)
- Video tasks appear on a "Video" calendar (auto-created)
- Titles have correct prefixes (`[PUBLISH]`, `[DEADLINE]`, `[DONE]`)
- Events link back to Notion in the description

- [ ] **Step 6: Test update behavior**

Change a task name or date in Notion, then re-run the curl command. Verify the calendar event updates.

- [ ] **Step 7: Test done/trash behavior**

Mark a task as "Done" in Notion → re-sync → verify `[DONE]` prefix appears.
Trash a task in Notion → re-sync → verify event is deleted from calendar.

- [ ] **Step 8: Commit any fixes**

If any adjustments were needed during testing, commit them.

---

### Task 11: Deploy to Vercel

- [ ] **Step 1: Initialize Vercel project**

Run: `npx vercel`
Follow the prompts to link to your Vercel account.

- [ ] **Step 2: Set environment variables in Vercel**

Run:
```bash
npx vercel env add NOTION_API_KEY
npx vercel env add NOTION_DATABASE_ID
npx vercel env add NOTION_WEBHOOK_SECRET
npx vercel env add GOOGLE_CLIENT_ID
npx vercel env add GOOGLE_CLIENT_SECRET
npx vercel env add GOOGLE_REFRESH_TOKEN
npx vercel env add SYNC_CUTOFF_DAYS
npx vercel env add SYNC_SECRET
```

- [ ] **Step 3: Deploy**

Run: `npx vercel --prod`
Expected: Deployment succeeds, URL printed.

- [ ] **Step 4: Test production sync**

```bash
curl "https://your-app.vercel.app/api/sync?secret=your-secret"
```
Expected: Same results as local test.

- [ ] **Step 5: Configure Notion webhook**

1. Go to https://www.notion.so/profile/integrations
2. Select your "Google Calendar Sync" integration
3. Go to Webhooks tab → Create subscription
4. Enter URL: `https://your-app.vercel.app/api/webhook`
5. Save the verification token as `NOTION_WEBHOOK_SECRET` in Vercel env vars
6. Redeploy: `npx vercel --prod`

- [ ] **Step 6: Test webhook**

Change a task in Notion. Check Google Calendar within a few seconds — the event should update.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "chore: finalize deployment configuration"
```
