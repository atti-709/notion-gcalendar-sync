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
