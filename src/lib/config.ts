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
      calendarName: "Svätonázor Social Media",
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
      calendarName: "Svätonázor Social Media",
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
      calendarName: "Svätonázor Video",
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
