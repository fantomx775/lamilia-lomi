import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";

const productId = "11111111-1111-4111-8111-111111111111";
const premiumAssetId = "11111111-1111-4111-8111-111111111105";
const runSupabaseE2E = process.env.RUN_ISSUE_31_SUPABASE_E2E === "1";

test.use({ trace: "off", screenshot: "off", video: "off" });

test.describe("Issue 31 isolated local Supabase premium redemption", () => {
  test("one code has a single winner under concurrent redemption and retries are idempotent", async ({}, testInfo) => {
    test.setTimeout(90_000);
    test.skip(!runSupabaseE2E, "Requires the explicitly configured isolated local Supabase stack.");
    test.skip(
      testInfo.project.name !== "chromium",
      "This integration test mutates isolated Supabase fixtures and runs once.",
    );

    const supabaseUrl = requireLoopbackUrl(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      56421,
      "isolated Supabase",
    );
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const publishableKey =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(serviceRoleKey, "isolated service-role key must be configured").toBeTruthy();
    expect(publishableKey, "isolated publishable key must be configured").toBeTruthy();

    const admin = createAdminClient(supabaseUrl.href, serviceRoleKey!);
    const credentials = [createCredentials(), createCredentials()];
    const userIds: string[] = [];
    const code = `ISSUE31-${randomBytes(16).toString("hex").toUpperCase()}`;
    const disabledCode = `ISSUE31-DISABLED-${randomBytes(16).toString("hex").toUpperCase()}`;
    const codeIds = [randomUUID(), randomUUID()];
    let cleanupSucceeded = true;

    try {
      for (const credential of credentials) {
        const result = await admin.auth.admin.createUser({
          email: credential.email,
          password: credential.password,
          email_confirm: true,
        });
        if (result.error || !result.data.user) {
          throw new Error("Could not create an isolated premium-redemption account.");
        }
        userIds.push(result.data.user.id);
      }

      const codeInsert = await admin.from("premium_codes").insert([
        { id: codeIds[0], product_id: productId, code, active: true },
        { id: codeIds[1], product_id: productId, code: disabledCode, active: false },
      ]);
      if (codeInsert.error) {
        throw new Error("Could not create isolated premium-code fixtures.");
      }

      const clients = await Promise.all(
        credentials.map(async (credential) => {
          const client = createUserClient(supabaseUrl.href, publishableKey!);
          const signedIn = await client.auth.signInWithPassword(credential);
          if (signedIn.error || !signedIn.data.session) {
            throw new Error("Could not establish an isolated verified user session.");
          }
          return client;
        }),
      );

      const concurrentResults = await Promise.all(
        clients.map((client) =>
          client.rpc("redeem_premium_code", {
            requested_product_id: productId,
            requested_code: code,
          }),
        ),
      );
      for (const result of concurrentResults) {
        expect(result.error).toBeNull();
      }
      const statuses = concurrentResults.map((result) => statusOf(result.data)).sort();
      expect(statuses).toEqual(["already_used", "success"]);

      const winnerIndex = concurrentResults.findIndex(
        (result) => statusOf(result.data) === "success",
      );
      const loserIndex = winnerIndex === 0 ? 1 : 0;
      const redeemedRows = await admin
        .from("user_product_unlocks")
        .select("id,user_id,premium_code_id")
        .eq("premium_code_id", codeIds[0]);
      expect(redeemedRows.error).toBeNull();
      expect(redeemedRows.data).toHaveLength(1);
      expect(redeemedRows.data?.[0]?.user_id).toBe(userIds[winnerIndex]);

      const winnerRetry = await clients[winnerIndex]!.rpc("redeem_premium_code", {
        requested_product_id: productId,
        requested_code: code,
      });
      expect(winnerRetry.error).toBeNull();
      expect(statusOf(winnerRetry.data)).toBe("already_unlocked");

      const loserRetry = await clients[loserIndex]!.rpc("redeem_premium_code", {
        requested_product_id: productId,
        requested_code: code,
      });
      expect(loserRetry.error).toBeNull();
      expect(statusOf(loserRetry.data)).toBe("already_used");

      const loserEntitlements = await clients[loserIndex]!
        .from("user_product_unlocks")
        .select("id")
        .eq("product_id", productId);
      expect(loserEntitlements.error).toBeNull();
      expect(loserEntitlements.data).toEqual([]);

      const winnerAssets = await clients[winnerIndex]!
        .from("product_assets")
        .select("id")
        .eq("id", premiumAssetId);
      expect(winnerAssets.error).toBeNull();
      expect(winnerAssets.data).toHaveLength(1);
      const loserAssets = await clients[loserIndex]!
        .from("product_assets")
        .select("id")
        .eq("id", premiumAssetId);
      expect(loserAssets.error).toBeNull();
      expect(loserAssets.data).toEqual([]);

      const disabledResult = await clients[loserIndex]!.rpc("redeem_premium_code", {
        requested_product_id: productId,
        requested_code: disabledCode,
      });
      expect(disabledResult.error).toBeNull();
      expect(statusOf(disabledResult.data)).toBe("inactive_code");

      const invalidResult = await clients[loserIndex]!.rpc("redeem_premium_code", {
        requested_product_id: productId,
        requested_code: "ISSUE31-NOT-A-REAL-CODE",
      });
      expect(invalidResult.error).toBeNull();
      expect(statusOf(invalidResult.data)).toBe("invalid_code");
    } finally {
      for (const userId of userIds) {
        const unlockDelete = await admin
          .from("user_product_unlocks")
          .delete()
          .eq("user_id", userId)
          .eq("product_id", productId);
        cleanupSucceeded &&= !unlockDelete.error;
      }
      if (codeIds.length) {
        const codeDelete = await admin.from("premium_codes").delete().in("id", codeIds);
        cleanupSucceeded &&= !codeDelete.error;
      }
      for (const credential of credentials) {
        const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const user = users.data.users.find(
          (candidate) => candidate.email?.toLowerCase() === credential.email,
        );
        if (user) {
          const deletion = await admin.auth.admin.deleteUser(user.id);
          cleanupSucceeded &&= !deletion.error;
        }
      }
      expect(cleanupSucceeded, "isolated redemption fixtures should clean up successfully").toBe(true);
    }
  });
});

function createCredentials() {
  const id = randomUUID();
  return {
    email: `issue31-${id}@example.test`,
    password: `${randomBytes(24).toString("base64url")}A1!`,
  };
}

function createAdminClient(url: string, serviceRoleKey: string) {
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

function createUserClient(
  url: string,
  publishableKey: string,
) {
  return createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

function requireLoopbackUrl(value: string | undefined, port: number, label: string) {
  if (!value) {
    throw new Error(`The ${label} URL is not configured.`);
  }

  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    Number(url.port) !== port
  ) {
    throw new Error(`The ${label} URL must target loopback port ${port}.`);
  }

  return url;
}

function statusOf(value: unknown) {
  if (typeof value !== "object" || value === null || !("status" in value)) {
    return "missing-status";
  }
  return typeof value.status === "string" ? value.status : "missing-status";
}
