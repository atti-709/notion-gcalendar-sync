import { describe, it, expect } from "vitest";
import { determineAction } from "../sync";
import type { TaskData } from "../config";
import type { calendar_v3 } from "googleapis";

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

const makeEvent = (
  overrides: Partial<calendar_v3.Schema$Event> = {}
): calendar_v3.Schema$Event => ({
  id: "gcal-event-1",
  summary: "Test Task",
  start: { date: "2025-04-01" },
  ...overrides,
});

const titleFormat = (t: TaskData) => t.taskName;

describe("determineAction", () => {
  it("returns 'create' when no existing event", () => {
    const task = makeTask();
    expect(determineAction(task, null, titleFormat)).toEqual({
      action: "create",
      title: "Test Task",
    });
  });

  it("returns 'delete' when task is trashed", () => {
    const task = makeTask({ isInTrash: true });
    const event = makeEvent();
    expect(determineAction(task, event, titleFormat)).toEqual({
      action: "delete",
    });
  });

  it("returns 'skip' when nothing changed", () => {
    const task = makeTask();
    const event = makeEvent({ summary: "Test Task" });
    expect(determineAction(task, event, titleFormat)).toEqual({
      action: "skip",
    });
  });

  it("returns 'update' when title changed", () => {
    const task = makeTask({ taskName: "New Name" });
    const event = makeEvent({ summary: "Old Name" });
    expect(determineAction(task, event, titleFormat)).toEqual({
      action: "update",
      title: "New Name",
    });
  });

  it("returns 'update' when date changed", () => {
    const task = makeTask({ date: "2025-05-01" });
    const event = makeEvent({ start: { date: "2025-04-01" } });
    expect(determineAction(task, event, titleFormat)).toEqual({
      action: "update",
      title: "Test Task",
    });
  });

  it("returns 'update' with [DONE] prefix when status is Done", () => {
    const task = makeTask({ status: "Done" });
    const event = makeEvent({ summary: "Test Task" });
    expect(determineAction(task, event, titleFormat)).toEqual({
      action: "update",
      title: "[DONE] Test Task",
    });
  });

  it("returns 'skip' when already marked [DONE] and nothing else changed", () => {
    const task = makeTask({ status: "Done" });
    const event = makeEvent({
      summary: "[DONE] Test Task",
      start: { date: "2025-04-01" },
    });
    expect(determineAction(task, event, titleFormat)).toEqual({
      action: "skip",
    });
  });
});
