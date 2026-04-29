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
  it("returns 4 streams", () => {
    expect(getSyncStreams()).toHaveLength(4);
  });

  it("Episodes stream targets primary calendar", () => {
    const episodes = getSyncStreams().find((s) => s.name === "Episodes")!;
    expect(episodes.calendarId).toBe("primary");
    expect(episodes.topLevelOnly).toBe(true);
    expect(episodes.eventType).toBe("publish");
  });

  it("Social Media Publish formats title with post type and platforms", () => {
    const sm = getSyncStreams().find((s) => s.name === "Social Media (Publish)")!;
    const title = sm.titleFormat({
      pageId: "x",
      taskName: "PROMO E05",
      date: "2025-01-01",
      status: "Not started",
      isInTrash: false,
      postType: "Reels",
      platforms: ["Instagram"],
    });
    expect(title).toBe("[PUBLISH] PROMO E05 (Reels) [Instagram]");
  });

  it("Video stream formats title with deadline prefix", () => {
    const video = getSyncStreams().find((s) => s.name === "Video")!;
    const title = video.titleFormat({
      pageId: "x",
      taskName: "Edit episode",
      date: "2025-01-01",
      status: "Not started",
      isInTrash: false,
      postType: null,
      platforms: [],
    });
    expect(title).toBe("[DEADLINE] Edit episode");
  });
});

describe("buildUserStreams", () => {
  const users = [
    { id: "user-a", name: "Alice" },
    { id: "user-b", name: "Bob" },
  ];

  it("emits one variant per base stream per user", () => {
    const streams = buildUserStreams(users);
    expect(streams).toHaveLength(getSyncStreams().length * users.length);
  });

  it("scopes calendarName per user and overrides primary calendarId", () => {
    const streams = buildUserStreams(users);
    const aliceEpisodes = streams.find(
      (s) => s.assigneeId === "user-a" && s.spaceId === getSyncStreams()[0].spaceId
    )!;
    expect(aliceEpisodes.calendarName).toBe("Svätonázor – Alice");
    expect(aliceEpisodes.calendarId).toBeUndefined();
  });

  it("attaches assigneeId to every emitted stream", () => {
    const streams = buildUserStreams(users);
    expect(streams.every((s) => s.assigneeId)).toBe(true);
  });

  it("preserves the base stream's titleFormat", () => {
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
