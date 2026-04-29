import type { calendar_v3 } from "googleapis";
import type { TaskData, SyncStream, NotionEventType } from "./config";
import { getEnv, getCutoffDate, getSyncStreams, buildUserStreams } from "./config";
import {
  getNotionClient,
  queryTasksBySpace,
  parseNotionTask,
  hasParentTask,
  discoverAssignees,
} from "./notion";
import {
  getCalendarClient,
  findOrCreateCalendar,
  getTrackedEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  buildEventTitle,
  listCalendars,
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

export async function syncStream(
  stream: SyncStream,
  calendarCache?: Map<string, string>
): Promise<SyncResult> {
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
    calendarId = await findOrCreateCalendar(cal, stream.calendarName!, calendarCache);
  }

  // Fetch Notion tasks
  const pages = await queryTasksBySpace(
    notion,
    databaseId,
    stream.spaceId,
    stream.notionDateProperty,
    cutoffDate,
    stream.assigneeId
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

  // Fetch existing GCal events. For per-user calendars, multiple streams of the
  // same eventType share a calendar, so we must scope by spaceId to avoid the
  // orphan-deletion loop wiping events created by other streams.
  const trackedSpaceId = stream.assigneeId ? stream.spaceId : undefined;
  const existingEvents = await getTrackedEvents(cal, calendarId, stream.eventType, trackedSpaceId);

  // Reconcile each task
  const seenPageIds = new Set<string>();
  for (const task of tasks) {
    seenPageIds.add(task.pageId);
    const existing = existingEvents.get(task.pageId) ?? null;
    const action = determineAction(task, existing, stream.titleFormat);

    switch (action.action) {
      case "create":
        await createEvent(cal, calendarId, task, stream.eventType, action.title, stream.spaceId);
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

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (next < items.length) {
        const idx = next++;
        results[idx] = await fn(items[idx]);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

export async function syncAll(): Promise<SyncResult[]> {
  const baseStreams = getSyncStreams();
  const notion = getNotionClient();
  const cal = getCalendarClient();
  const databaseId = getEnv("NOTION_DATABASE_ID");

  const users = await discoverAssignees(notion, databaseId);
  const userStreams = buildUserStreams(users);
  const streams = [...baseStreams, ...userStreams];

  // Prefetch calendar list once and pre-create any missing user calendars
  // sequentially to avoid races when streams run in parallel.
  const calendarCache = await listCalendars(cal);
  const namesToEnsure = new Set<string>();
  for (const s of streams) {
    if (!s.calendarId && s.calendarName) namesToEnsure.add(s.calendarName);
  }
  for (const name of namesToEnsure) {
    if (!calendarCache.has(name)) {
      await findOrCreateCalendar(cal, name, calendarCache);
    }
  }

  // Concurrency 3 keeps us under Notion's ~3 req/sec sustained rate limit
  // while still cutting wall-clock from ~40 sequential streams to ~14.
  return runWithConcurrency(streams, 3, (s) => syncStream(s, calendarCache));
}
