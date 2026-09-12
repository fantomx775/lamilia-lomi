import { describe, expect, it, vi } from "vitest";

import {
  buildDeployArgs,
  buildVercelInvocation,
  buildVercelSpawnOptions,
  findReusablePreview,
  parseArgs,
} from "./deploy-preview.mjs";

const commitSha = "c".repeat(40);

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

describe("Lamilia Preview deployment reuse", () => {
  it("paginates and chooses the newest READY Preview for the exact SHA", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          deployments: [
            {
              target: "production",
              readyState: "READY",
              meta: { githubCommitSha: commitSha },
              url: "production.vercel.app",
              created: 100,
            },
          ],
          pagination: { next: 456 },
        }),
      )
      .mockResolvedValueOnce(
        response({
          deployments: [
            {
              target: null,
              readyState: "READY",
              meta: { githubCommitSha: commitSha },
              url: "older-preview.vercel.app",
              created: 200,
            },
            {
              target: null,
              readyState: "READY",
              meta: { githubCommitSha: commitSha },
              url: "newer-preview.vercel.app",
              created: 300,
            },
          ],
          pagination: {},
        }),
      );

    const result = await findReusablePreview({
      projectId: "prj_lamilia",
      teamId: "team_lamilia",
      token: "test-token",
      commitSha,
      fetchImpl,
    });

    expect(result.url).toBe("newer-preview.vercel.app");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(new URL(fetchImpl.mock.calls[1][0]).searchParams.get("until")).toBe(
      "456",
    );
  });

  it("does not reuse a non-READY, production-target, or wrong-SHA deployment", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      response({
        deployments: [
          {
            target: null,
            readyState: "BUILDING",
            meta: { githubCommitSha: commitSha },
            url: "building.vercel.app",
          },
          {
            target: "production",
            readyState: "READY",
            meta: { githubCommitSha: commitSha },
            url: "production.vercel.app",
          },
          {
            target: null,
            readyState: "READY",
            meta: { githubCommitSha: "d".repeat(40) },
            url: "wrong-sha.vercel.app",
          },
        ],
        pagination: {},
      }),
    );

    await expect(
      findReusablePreview({
        projectId: "prj_lamilia",
        teamId: "team_lamilia",
        token: "test-token",
        commitSha,
        fetchImpl,
      }),
    ).resolves.toBeNull();
  });

  it("requires a reason for an explicit rebuild", () => {
    expect(() => parseArgs(["--force"])).toThrow("--force requires --reason");
    expect(
      parseArgs(["--force", "--reason", "debug cache invalidation"]),
    ).toMatchObject({
      force: true,
      reason: "debug cache invalidation",
    });
  });

  it("passes an untrusted branch name as one argument without a Windows shell", () => {
    const commitRef = "feature/$(whoami); & echo hacked";
    const deployArgs = buildDeployArgs({
      commitSha,
      commitRef,
      scope: "fantomxs-projects",
    });
    const invocation = buildVercelInvocation(deployArgs, {
      platform: "win32",
      nodePath: "C:\\Program Files\\nodejs\\node.exe",
      cliEntrypoint: "C:\\Program Files\\nodejs\\node_modules\\vercel\\dist\\vc.js",
    });

    expect(invocation.command).toBe("C:\\Program Files\\nodejs\\node.exe");
    expect(invocation.args).toEqual([
      "C:\\Program Files\\nodejs\\node_modules\\vercel\\dist\\vc.js",
      ...deployArgs,
    ]);
    expect(invocation.args).toContain(`githubCommitRef=${commitRef}`);
    expect(buildVercelSpawnOptions({ cwd: "C:\\repo", env: {} })).toMatchObject({
      shell: false,
    });
  });

  it("fails closed when the Vercel lookup fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({}, 503));

    await expect(
      findReusablePreview({
        projectId: "prj_lamilia",
        teamId: "team_lamilia",
        token: "test-token",
        commitSha,
        fetchImpl,
      }),
    ).rejects.toThrow("HTTP 503");
  });
});
