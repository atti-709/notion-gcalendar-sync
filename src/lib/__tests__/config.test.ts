import { describe, it, expect, vi, beforeEach } from "vitest";
import { getSyncStreams, getCutoffDate, buildUserStreams } from "../config";

describe("getEnv", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns env value when set", async () => {
    vi.stubEnv("NOTION_API_KEY", "test-key");
    const { getEnv } = await import("../config");
    expect(getEnv("NOTION_API_KEY")).toBe("test-key");
  });

  it("throws when required env is missing", async () => {
    vi.stubEnv("NOTION_API_KEY", "");
    const { getEnv } = await import("../config");
    expect(() => getEnv("NOTION_API_KEY")).toThrow();
  });
});

describe("getSyncStreams", () => {
  it("returns only the Episodes base stream", () => {
    const streams = getSyncStreams();
    expect(streams).toHaveLength(1);
    expect(streams[0].name).toBe("Episodes");
  });

  it("Episodes stream targets primary calendar", () => {
    const episodes = getSyncStreams().find((s) => s.name === "Episodes")!;
    expect(episodes.calendarId).toBe("primary");
    expect(episodes.topLevelOnly).toBe(true);
    expect(episodes.eventType).toBe("publish");
  });
});

describe("buildUserStreams", () => {
  const users = [
    { id: "user-a", name: "Alice" },
    { id: "user-b", name: "Bob" },
  ];

  it("emits all 4 stream templates per user (Episodes + Social ×2 + Video)", () => {
    const streams = buildUserStreams(users);
    expect(streams).toHaveLength(4 * users.length);
  });

  it("scopes calendarName per user and overrides primary calendarId", () => {
    const streams = buildUserStreams(users);
    const aliceEpisodes = streams.find(
      (s) => s.assigneeId === "user-a" && s.name.startsWith("Episodes")
    )!;
    expect(aliceEpisodes.calendarName).toBe("Svätonázor – Alice");
    expect(aliceEpisodes.calendarId).toBeUndefined();
  });

  it("attaches assigneeId to every emitted stream", () => {
    const streams = buildUserStreams(users);
    expect(streams.every((s) => s.assigneeId)).toBe(true);
  });

  it("preserves the template's titleFormat", () => {
    const streams = buildUserStreams(users);
    const aliceVideo = streams.find(
      (s) => s.assigneeId === "user-a" && s.name.startsWith("Video")
    )!;
    const title = aliceVideo.titleFormat({
      pageId: "x",
      taskName: "Edit",
      date: "2025-01-01",
      status: "Not started",
      isInTrash: false,
      postType: null,
      platforms: [],
    });
    expect(title).toBe("[DEADLINE] Edit");
  });
});

describe("getCutoffDate", () => {
  it("returns a date string in YYYY-MM-DD format", () => {
    expect(getCutoffDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
