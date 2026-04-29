import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getEnv, getSyncStreams, buildUserStreams } from "@/lib/config";
import type { SyncStream } from "@/lib/config";
import {
  getNotionClient,
  fetchPage,
  parseNotionTask,
  hasParentTask,
  discoverAssignees,
} from "@/lib/notion";
import {
  getCalendarClient,
  findOrCreateCalendar,
  findEventByPageId,
  createEvent,
  updateEvent,
  deleteEvent,
} from "@/lib/google-calendar";
import { determineAction } from "@/lib/sync";
import type { calendar_v3 } from "googleapis";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.text();

  // Verify signature
  const signature = request.headers.get("x-notion-signature");
  const webhookSecret = process.env.NOTION_WEBHOOK_SECRET;
  if (webhookSecret && signature) {
    const expected = `sha256=${crypto
      .createHmac("sha256", webhookSecret)
      .update(body)
      .digest("hex")}`;
    if (signature !== expected) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  const payload = JSON.parse(body);

  // Handle verification challenge
  if (payload.type === "url_verification" || payload.verification_token) {
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
    const databaseId = getEnv("NOTION_DATABASE_ID");
    const page = await fetchPage(notion, pageId);

    const spaceRelations: string[] = (page as any).properties?.Space?.relation?.map(
      (r: any) => r.id
    ) ?? [];
    const currentAssigneeIds = new Set<string>(
      ((page as any).properties?.Assignee?.people ?? []).map((p: any) => p.id)
    );

    // Discover all known assignees + list calendars once. We need this to
    // propagate de-assignments to past assignees' calendars in real time.
    const knownUsers = await discoverAssignees(notion, databaseId);
    const calendarList = await cal.calendarList.list();
    const calendarBySummary = new Map<string, string>();
    for (const c of calendarList.data.items ?? []) {
      if (c.summary && c.id) calendarBySummary.set(c.summary, c.id);
    }

    const allStreams: SyncStream[] = [
      ...getSyncStreams(),
      ...buildUserStreams(knownUsers),
    ];

    for (const stream of allStreams) {
      if (!spaceRelations.includes(stream.spaceId)) continue;

      // For per-user streams, force-delete on the user's calendar when they
      // aren't currently assigned (handles de-assignments and reassignments).
      const isAssigned = stream.assigneeId
        ? currentAssigneeIds.has(stream.assigneeId)
        : true;
      const forceDelete = !isAssigned;

      let calendarId: string | undefined;
      if (stream.calendarId) {
        calendarId = stream.calendarId;
      } else {
        calendarId = calendarBySummary.get(stream.calendarName!);
        if (!calendarId && !forceDelete) {
          // Only create a missing calendar when we'd actually write to it.
          calendarId = await findOrCreateCalendar(cal, stream.calendarName!);
          calendarBySummary.set(stream.calendarName!, calendarId);
        }
      }
      if (!calendarId) continue;

      await applyStreamToPage(cal, calendarId, stream, page, forceDelete);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Webhook processing failed:", error);
    return NextResponse.json({ ok: true }); // Return 200 to avoid retries
  }
}

async function applyStreamToPage(
  cal: calendar_v3.Calendar,
  calendarId: string,
  stream: SyncStream,
  page: any,
  forceDelete = false
): Promise<void> {
  // Even if the user is currently assigned, sub-tasks shouldn't appear on
  // top-level-only streams — delete any stale event we might find.
  if (stream.topLevelOnly && hasParentTask(page)) forceDelete = true;

  const lookupSpaceId = stream.assigneeId ? stream.spaceId : undefined;
  const existing = await findEventByPageId(
    cal,
    calendarId,
    page.id,
    stream.eventType,
    lookupSpaceId
  );

  if (forceDelete) {
    if (existing?.id) await deleteEvent(cal, calendarId, existing.id);
    return;
  }

  const task = parseNotionTask(page, stream.notionDateProperty);
  if (!task) {
    if (existing?.id) await deleteEvent(cal, calendarId, existing.id);
    return;
  }

  const action = determineAction(task, existing, stream.titleFormat);
  switch (action.action) {
    case "create":
      await createEvent(cal, calendarId, task, stream.eventType, action.title, stream.spaceId);
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
