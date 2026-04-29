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

export async function syncAll(): Promise<SyncResult[]> {
  const baseStreams = getSyncStreams();
  const notion = getNotionClient();
  const databaseId = getEnv("NOTION_DATABASE_ID");
  const users = await discoverAssignees(notion, databaseId);
  const userStreams = buildUserStreams(users);
  const streams = [...baseStreams, ...userStreams];

  const results: SyncResult[] = [];
  for (const stream of streams) {
    results.push(await syncStream(stream));
  }
  return results;
}
