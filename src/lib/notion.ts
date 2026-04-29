import { Client } from "@notionhq/client";
import { getEnv } from "./config";
import type { TaskData, NotionUser } from "./config";

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
  cutoffDate: string,
  assigneeId?: string
): Promise<any[]> {
  const pages: any[] = [];
  let cursor: string | undefined;

  const filters: any[] = [
    { property: "Space", relation: { contains: spaceId } },
    { property: dateProperty, date: { on_or_after: cutoffDate } },
  ];
  if (assigneeId) {
    filters.push({ property: "Assignee", people: { contains: assigneeId } });
  }

  do {
    const response = await client.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      filter: { and: filters },
    });

    pages.push(...response.results);
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return pages;
}

export async function discoverAssignees(
  client: Client,
  databaseId: string
): Promise<NotionUser[]> {
  const seen = new Map<string, string>();
  let cursor: string | undefined;

  do {
    const response: any = await client.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const page of response.results) {
      const people = page.properties?.Assignee?.people ?? [];
      for (const p of people) {
        if (p.name && !seen.has(p.id)) {
          seen.set(p.id, p.name);
        }
      }
    }
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return [...seen.entries()].map(([id, name]) => ({ id, name }));
}

export async function fetchPage(client: Client, pageId: string): Promise<any> {
  return client.pages.retrieve({ page_id: pageId });
}
