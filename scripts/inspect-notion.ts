import "dotenv/config";
import { Client } from "@notionhq/client";

const client = new Client({ auth: process.env.NOTION_API_KEY });

async function main() {
  console.log("=== Unique assignees in database (members + guests) ===");
  const seen = new Map<string, { name?: string; email?: string; type?: string }>();

  let cursor: string | undefined;
  do {
    const res: any = await client.databases.query({
      database_id: process.env.NOTION_DATABASE_ID!,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const page of res.results) {
      const people = page.properties?.Assignee?.people ?? [];
      for (const p of people) {
        if (!seen.has(p.id)) {
          seen.set(p.id, {
            name: p.name,
            email: p.person?.email,
            type: p.type,
          });
        }
      }
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  for (const [id, info] of seen) {
    console.log(`  ${id}  ${info.name ?? "(unnamed)"}${info.email ? ` <${info.email}>` : ""}`);
  }
  console.log(`\nTotal: ${seen.size}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
