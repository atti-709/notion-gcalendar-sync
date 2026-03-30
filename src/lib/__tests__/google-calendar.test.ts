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
