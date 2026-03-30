import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getSyncStreams } from "@/lib/config";
import { getNotionClient, fetchPage, parseNotionTask, hasParentTask } from "@/lib/notion";
import {
  getCalendarClient,
  findOrCreateCalendar,
  getTrackedEvents,
  createEvent,
  updateEvent,
  deleteEvent,
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
    return NextResponse.json({ challenge: payload.challenge, verification_token: payload.verification_token });
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
