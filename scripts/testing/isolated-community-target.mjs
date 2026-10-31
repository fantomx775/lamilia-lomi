import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const historicalProjectId = "lamilia-coloring-club-p0";
const historicalStatusPath = "/tmp/lamilia-p0-preflight/local-supabase-status.json";
const isolatedApiUrl = "http://127.0.0.1:55421";

export function assertLocalDockerEndpoint(endpoint) {
  if (typeof endpoint === "string" && /^npipe:\/\/\/\/\.\/pipe\/(docker_engine|dockerDesktopLinuxEngine|dockerDesktopWindowsEngine)$/i.test(endpoint)) {
    return endpoint;
  }
  let parsed;
  try { parsed = new URL(endpoint); } catch {
    throw new Error("Community fixtures require a local Docker named pipe or Unix socket.");
  }
  if (parsed.protocol !== "unix:" || parsed.hostname || parsed.username || parsed.password
    || !parsed.pathname.startsWith("/") || !parsed.pathname.endsWith(".sock") || parsed.search || parsed.hash) {
    throw new Error("Community fixtures require a local Docker named pipe or Unix socket.");
  }
  return endpoint;
}

export function isolatedCommunityConfig(env = process.env) {
  const projectId = env.COMMUNITY_SUPABASE_PROJECT_ID ?? historicalProjectId;
  const statusPath = env.COMMUNITY_SUPABASE_STATUS_PATH ?? historicalStatusPath;
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(projectId)) {
    throw new Error("A safe isolated community Supabase project ID is required.");
  }
  if (!path.isAbsolute(statusPath)) {
    throw new Error("The isolated community status file path must be absolute.");
  }
  return { projectId, statusPath };
}

export function communityTestOrigin(env = process.env) {
  const value = env.COMMUNITY_TEST_ORIGIN ?? "https://127.0.0.1:3443";
  let origin;
  try { origin = new URL(value); } catch {
    throw new Error("The community test application must use its dedicated local HTTPS origin.");
  }
  if (origin.protocol !== "https:" || !["127.0.0.1", "localhost"].includes(origin.hostname)
    || origin.port !== "3443" || origin.username || origin.password || origin.pathname !== "/"
    || origin.search || origin.hash) {
    throw new Error("The community test application must use its dedicated local HTTPS origin.");
  }
  return origin.origin;
}

/** Read only the private local application's maintenance bearer; never log its value. */
export function readCommunityCronSecret(env = process.env) {
  const secretPath = env.COMMUNITY_CRON_SECRET_PATH ?? "/tmp/lamilia-p0-preflight/community-cron-secret";
  if (!path.isAbsolute(secretPath)) {
    throw new Error("The private community cron secret file path must be absolute.");
  }
  let secret;
  try { secret = readFileSync(secretPath, "utf8").trim(); } catch {
    throw new Error("Cannot read the private local community cron secret file.");
  }
  if (secret.length < 32 || /\s/.test(secret)) {
    throw new Error("The private community cron secret must contain at least 32 non-whitespace characters.");
  }
  return secret;
}

/** Pure safety check used before creating any Auth, Storage, or SQL fixture. */
export function validateIsolatedCommunityTarget(status, projectId, containers) {
  isolatedCommunityConfig({ COMMUNITY_SUPABASE_PROJECT_ID: projectId });
  if (status?.API_URL !== isolatedApiUrl || typeof status.ANON_KEY !== "string" || !status.ANON_KEY.trim()
    || typeof status.SERVICE_ROLE_KEY !== "string" || !status.SERVICE_ROLE_KEY.trim()) {
    throw new Error("Community fixtures require private local Supabase status on API port 55421.");
  }
  let databaseUrl;
  try { databaseUrl = new URL(status.DB_URL); } catch {
    throw new Error("The community fixture status must identify its isolated local database.");
  }
  if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol)
    || !["127.0.0.1", "localhost"].includes(databaseUrl.hostname)
    || databaseUrl.port !== "55422" || databaseUrl.pathname !== "/postgres" || databaseUrl.search || databaseUrl.hash) {
    throw new Error("The community fixture database must use its dedicated local port 55422.");
  }
  const databaseContainer = `supabase_db_${projectId}`;
  const gatewayContainer = `supabase_kong_${projectId}`;
  const network = `supabase_network_${projectId}`;
  if (!Array.isArray(containers)) {
    throw new Error("The community fixture API and database must belong to the selected running local project.");
  }
  const expected = [[databaseContainer, "5432/tcp", "55422"], [gatewayContainer, "8000/tcp", "55421"]];
  for (const [name, internalPort, externalPort] of expected) {
    const container = containers.find((item) => item?.Name === `/${name}`);
    if (!container?.Running || !/^[a-f0-9]{64}$/.test(container.Id ?? "")
      || container.Labels?.["com.supabase.cli.project"] !== projectId
      || container.Labels?.["com.docker.compose.project"] !== projectId
      || !container.Networks?.[network]
      || !container.Ports?.[internalPort]?.some((binding) => binding.HostPort === externalPort
        && ["127.0.0.1", "0.0.0.0"].includes(binding.HostIp))) {
      throw new Error("The community fixture API and database must belong to the selected running local project.");
    }
  }
  return {
    apiUrl: isolatedApiUrl,
    publishableKey: status.ANON_KEY,
    serviceRoleKey: status.SERVICE_ROLE_KEY,
    databaseContainer,
    databaseContainerId: containers.find((item) => item.Name === `/${databaseContainer}`).Id,
    projectId,
  };
}

/** No credentials or complete Docker inspect payloads are logged or put in subprocess arguments. */
export function loadIsolatedCommunityTarget(env = process.env) {
  const { projectId, statusPath } = isolatedCommunityConfig(env);
  const dockerExecutable = process.platform === "win32" ? "docker.exe" : "docker";
  const dockerEnv = { ...process.env, ...env };
  if (dockerEnv.DOCKER_HOST) assertLocalDockerEndpoint(dockerEnv.DOCKER_HOST);
  let dockerEndpoint;
  try {
    const contextEndpoint = JSON.parse(execFileSync(dockerExecutable,
      ["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"], {
        encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000, windowsHide: true, env: dockerEnv,
      }).trim());
    assertLocalDockerEndpoint(contextEndpoint);
    dockerEndpoint = assertLocalDockerEndpoint(dockerEnv.DOCKER_HOST || contextEndpoint);
  } catch {
    throw new Error("Cannot verify a local Docker endpoint for community fixtures.");
  }
  // Pin subsequent commands to the verified local daemon even if another tool changes the active context.
  dockerEnv.DOCKER_HOST = dockerEndpoint;
  dockerEnv.DOCKER_CONTEXT = "";
  let status;
  try { status = JSON.parse(readFileSync(statusPath, "utf8")); } catch {
    throw new Error("Cannot read the private isolated community Supabase status file.");
  }
  let containers;
  const format = '{"Id":{{json .Id}},"Name":{{json .Name}},"Running":{{json .State.Running}},"Labels":{{json .Config.Labels}},"Networks":{{json .NetworkSettings.Networks}},"Ports":{{json .NetworkSettings.Ports}}}';
  try {
    const output = execFileSync(dockerExecutable, ["inspect", "--format", format,
      `supabase_db_${projectId}`, `supabase_kong_${projectId}`], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000, windowsHide: true, env: dockerEnv,
    });
    containers = output.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  } catch {
    throw new Error("Cannot verify the selected isolated community Docker project.");
  }
  return { ...validateIsolatedCommunityTarget(status, projectId, containers), dockerExecutable, dockerEndpoint };
}

/** Python/SQL runners receive only safe metadata from the same complete target verification. */
export function loadIsolatedCommunityDockerTarget(env = process.env) {
  const { dockerExecutable, dockerEndpoint, databaseContainerId } = loadIsolatedCommunityTarget(env);
  return { dockerExecutable, dockerEndpoint, databaseContainerId };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== "--docker-metadata") {
      throw new Error("Unsupported isolated-target helper option.");
    }
    process.stdout.write(JSON.stringify(loadIsolatedCommunityDockerTarget()) + "\n");
  } catch {
    // Never echo status contents, provider keys, or the output of a failed Docker invocation.
    process.stderr.write("Cannot verify the isolated local community Docker target.\n");
    process.exitCode = 1;
  }
}
