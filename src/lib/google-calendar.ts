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

export async function listCalendars(
  cal: calendar_v3.Calendar
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const list = await cal.calendarList.list();
  for (const c of list.data.items ?? []) {
    if (c.summary && c.id) map.set(c.summary, c.id);
  }
  return map;
}

export async function findOrCreateCalendar(
  cal: calendar_v3.Calendar,
  name: string,
  cache?: Map<string, string>
): Promise<string> {
  if (cache?.has(name)) return cache.get(name)!;

  if (!cache) {
    const list = await cal.calendarList.list();
    const existing = list.data.items?.find((c) => c.summary === name);
    if (existing?.id) return existing.id;
  }

  const created = await cal.calendars.insert({
    requestBody: { summary: name },
  });
  const id = created.data.id!;
  cache?.set(name, id);
  return id;
}

export async function getTrackedEvents(
  cal: calendar_v3.Calendar,
  calendarId: string,
  eventType: NotionEventType,
  spaceId?: string
): Promise<Map<string, calendar_v3.Schema$Event>> {
  const map = new Map<string, calendar_v3.Schema$Event>();
  let pageToken: string | undefined;

  const privateExtendedProperty = [`notionEventType=${eventType}`];
  if (spaceId) privateExtendedProperty.push(`notionSpaceId=${spaceId}`);

  do {
    const response = await cal.events.list({
      calendarId,
      privateExtendedProperty,
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

export async function findEventByPageId(
  cal: calendar_v3.Calendar,
  calendarId: string,
  pageId: string,
  eventType: NotionEventType,
  spaceId?: string
): Promise<calendar_v3.Schema$Event | null> {
  const privateExtendedProperty = [
    `notionPageId=${pageId}`,
    `notionEventType=${eventType}`,
  ];
  if (spaceId) privateExtendedProperty.push(`notionSpaceId=${spaceId}`);

  const response = await cal.events.list({
    calendarId,
    privateExtendedProperty,
    maxResults: 10,
    singleEvents: true,
  });

  return response.data.items?.[0] ?? null;
}

export async function createEvent(
  cal: calendar_v3.Calendar,
  calendarId: string,
  task: TaskData,
  eventType: NotionEventType,
  title: string,
  spaceId: string
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
          notionSpaceId: spaceId,
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
