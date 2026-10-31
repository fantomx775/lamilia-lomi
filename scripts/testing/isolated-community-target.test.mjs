import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readFileSync: vi.fn(), execFileSync: vi.fn() }));
vi.mock("node:fs", () => ({ readFileSync: mocks.readFileSync }));
vi.mock("node:child_process", () => ({ execFileSync: mocks.execFileSync }));

import {
  communityTestOrigin,
  isolatedCommunityConfig,
  loadIsolatedCommunityTarget,
  validateIsolatedCommunityTarget,
} from "./isolated-community-target.mjs";

const projectId = "lomi-stabilize-20261031";
const status = {
  API_URL: "http://127.0.0.1:55421",
  DB_URL: "postgresql://postgres:synthetic-only@127.0.0.1:55422/postgres",
  ANON_KEY: "synthetic-publishable-key",
  SERVICE_ROLE_KEY: "synthetic-service-key",
};
function localContainers(id = projectId) {
  return [["db", "5432/tcp", "55422"], ["kong", "8000/tcp", "55421"]].map(([kind, port, hostPort]) => ({
    Id: (kind === "db" ? "d" : "e").repeat(64),
    Name: `/supabase_${kind}_${id}`,
    Running: true,
    Labels: { "com.supabase.cli.project": id, "com.docker.compose.project": id },
    Networks: { [`supabase_network_${id}`]: {} },
    Ports: { [port]: [{ HostIp: "127.0.0.1", HostPort: hostPort }] },
  }));
}

describe("isolated community fixture target", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads an absolute private status path and verifies both containers before returning keys", () => {
    const statusPath = path.resolve("private", "local-supabase-status.json");
    mocks.readFileSync.mockReturnValue(JSON.stringify(status));
    mocks.execFileSync.mockReturnValue(localContainers().map((container) => JSON.stringify(container)).join("\n"));

    const target = loadIsolatedCommunityTarget({
      COMMUNITY_SUPABASE_STATUS_PATH: statusPath,
      COMMUNITY_SUPABASE_PROJECT_ID: projectId,
    });

    expect(target).toMatchObject({ apiUrl: status.API_URL, databaseContainer: `supabase_db_${projectId}`, databaseContainerId: "d".repeat(64), projectId });
    expect(mocks.readFileSync).toHaveBeenCalledWith(statusPath, "utf8");
    const [, args, options] = mocks.execFileSync.mock.calls[0];
    expect(args.slice(-2)).toEqual([`supabase_db_${projectId}`, `supabase_kong_${projectId}`]);
    expect(args.join(" ")).not.toContain(status.SERVICE_ROLE_KEY);
    expect(args.join(" ")).not.toContain(status.DB_URL);
    expect(options).toMatchObject({ timeout: 10_000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  });

  it("preserves the historical local project default", () => {
    expect(isolatedCommunityConfig({})).toEqual({
      projectId: "lamilia-coloring-club-p0",
      statusPath: "/tmp/lamilia-p0-preflight/local-supabase-status.json",
    });
    expect(validateIsolatedCommunityTarget(status, "lamilia-coloring-club-p0", localContainers("lamilia-coloring-club-p0")))
      .toHaveProperty("databaseContainer", "supabase_db_lamilia-coloring-club-p0");
  });

  it.each(["../other", "project;echo", "--help", "project/name", "UPPERCASE", ""])("refuses unsafe project identity %j", (id) => {
    expect(() => isolatedCommunityConfig({ COMMUNITY_SUPABASE_PROJECT_ID: id })).toThrow("safe isolated");
    expect(mocks.execFileSync).not.toHaveBeenCalled();
  });

  it("refuses relative private status paths", () => {
    expect(() => isolatedCommunityConfig({ COMMUNITY_SUPABASE_STATUS_PATH: "private/status.json" })).toThrow("absolute");
  });

  it.each([
    { API_URL: "https://production.supabase.co" },
    { API_URL: "http://127.0.0.1:54321" },
    { API_URL: "http://127.0.0.1:55421/" },
    { ANON_KEY: "" },
    { SERVICE_ROLE_KEY: undefined },
  ])("refuses cloud, wrong-port, or incomplete API status %j", (override) => {
    expect(() => validateIsolatedCommunityTarget({ ...status, ...override }, projectId, localContainers())).toThrow("API port 55421");
  });

  it.each([
    "postgresql://postgres:synthetic@production.example:55422/postgres",
    "postgresql://postgres:synthetic@127.0.0.1:54322/postgres",
    "postgresql://postgres:synthetic@127.0.0.1:55422/other",
    "https://127.0.0.1:55422/postgres",
    "postgresql://postgres:synthetic@127.0.0.1:55422/postgres?host=production.example",
  ])("refuses a database outside the dedicated local target", (databaseUrl) => {
    expect(() => validateIsolatedCommunityTarget({ ...status, DB_URL: databaseUrl }, projectId, localContainers())).toThrow("port 55422");
  });

  it.each(["missing", "stopped", "container-id", "cli-label", "compose-label", "network", "database-port", "gateway-port"])("refuses mismatched Docker identity: %s", (kind) => {
    const containers = localContainers();
    if (kind === "missing") containers.pop();
    if (kind === "stopped") containers[0].Running = false;
    if (kind === "container-id") containers[0].Id = "unsafe-container-name";
    if (kind === "cli-label") containers[0].Labels["com.supabase.cli.project"] = "another-project";
    if (kind === "compose-label") containers[1].Labels["com.docker.compose.project"] = "another-project";
    if (kind === "network") containers[1].Networks = {};
    if (kind === "database-port") containers[0].Ports["5432/tcp"][0].HostPort = "54322";
    if (kind === "gateway-port") containers[1].Ports["8000/tcp"][0].HostPort = "54321";
    expect(() => validateIsolatedCommunityTarget(status, projectId, containers)).toThrow("selected running local project");
  });

  it("fails closed without echoing Docker errors or private status contents", () => {
    mocks.readFileSync.mockReturnValue(JSON.stringify(status));
    mocks.execFileSync.mockImplementation(() => { throw new Error(status.SERVICE_ROLE_KEY); });
    expect(() => loadIsolatedCommunityTarget({ COMMUNITY_SUPABASE_PROJECT_ID: projectId }))
      .toThrow("Cannot verify the selected isolated community Docker project.");
  });

  it.each(["https://localhost:3443", "https://127.0.0.1:3443"])("accepts only dedicated local HTTPS application origin %s", (origin) => {
    expect(communityTestOrigin({ COMMUNITY_TEST_ORIGIN: origin })).toBe(origin);
  });

  it.each(["https://production.example:3443", "http://localhost:3443", "https://localhost:3000", "https://localhost:3443/path", "https://user@localhost:3443", "https://localhost:3443/?token=private"])("refuses unsafe application origin", (origin) => {
    expect(() => communityTestOrigin({ COMMUNITY_TEST_ORIGIN: origin })).toThrow("dedicated local HTTPS origin");
  });
});
