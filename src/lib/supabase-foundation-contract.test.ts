import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Supabase production foundation contracts", () => {
  it("keeps the production adapter and service role server-only", () => {
    expect(read("src/lib/supabase/admin.ts")).toContain('import "server-only"');
    expect(read("src/lib/content-repository.ts")).toContain('import "server-only"');
    expect(read("src/lib/premium-request.ts")).toContain('import "server-only"');
    expect(read("src/lib/supabase/admin.ts")).toContain("getServiceRoleKey");
    expect(read("src/lib/config.ts")).toContain("SUPABASE_SERVICE_ROLE_KEY");

    for (const relativePath of ["src/components", "src/app"]) {
      const files = collectFiles(path.join(root, relativePath));

      for (const file of files) {
        expect(fs.readFileSync(file, "utf8"), file).not.toContain(
          "SUPABASE_SERVICE_ROLE_KEY",
        );
      }
    }
  });

  it("defines the forward migration and deterministic seed for the current domain", () => {
    const migration = read(
      "supabase/migrations/20260815120000_supabase_production_foundation.sql",
    );
    const seed = read("supabase/seed.sql");
    const rlsTest = read("supabase/tests/production-foundation-rls.sql");
    const playwrightConfig = read("playwright.config.ts");
    const foundationMigration = read(
      "supabase/migrations/20260531093244_lamilialomi_foundation.sql",
    );
    const atomicMigration = read(
      "supabase/migrations/20260816113722_atomic_product_save.sql",
    );
    const verifiedDownloadsMigration = read(
      "supabase/migrations/20260904120000_require_verified_premium_downloads.sql",
    );
    const mediaStorageMigration = read(
      "supabase/migrations/20260906085540_secure_product_media_storage.sql",
    );
    const tagDescriptionsMigration = read(
      "supabase/migrations/20260905100000_add_tag_translation_descriptions.sql",
    );
    const concurrencyTest = read(
      "supabase/tests/atomic-product-save-concurrency.sql",
    );
    const concurrencyRunner = read(
      "supabase/tests/run-atomic-product-save-concurrency.ps1",
    );
    const productAdmin = read("src/lib/supabase-content-admin.ts");
    const authActions = read("src/app/actions.ts");

    expect(migration).toContain("create or replace function private.redeem_premium_code");
    expect(migration).toContain("on conflict (user_id, product_id) do nothing");
    expect(migration).toContain("revoke all on public.premium_codes from anon");
    expect(migration).toContain('create policy "unlocks_no_anon_access"');
    expect(migration).toContain(
      "grant select on public.user_product_unlocks to anon, authenticated",
    );
    expect(migration).toContain("create policy \"premium objects are readable after unlock\"");
    expect(migration).toContain("security definer");
    expect(seed).toContain("on conflict (id) do update");
    expect(seed).toContain("on conflict (slug, locale) do update");
    expect(rlsTest).toContain("set local role anon");
    expect(rlsTest).toContain("set local role authenticated");
    expect(migration).toContain("status = 'published'");
    expect(migration).toContain("p.status = 'published'");
    expect(rlsTest).toContain("LOMI-DRAFT-2026");
    expect(rlsTest).toContain("RLS matrix complete: 56 positive scenarios passed");
    expect(verifiedDownloadsMigration).toContain(
      "create or replace function private.is_email_verified()",
    );
    expect(verifiedDownloadsMigration).toContain("email_confirmed_at is not null");
    expect(verifiedDownloadsMigration).toContain("private.is_email_verified()");
    expect(verifiedDownloadsMigration).toContain(
      'create policy "premium objects are readable after unlock"',
    );
    expect(mediaStorageMigration).toContain("public = false");
    expect(mediaStorageMigration).toContain('drop policy if exists "public media objects are readable"');
    expect(mediaStorageMigration).toContain("bucket = 'public-videos'");
    expect(tagDescriptionsMigration).toContain(
      "alter table public.tag_translations",
    );
    expect(tagDescriptionsMigration).toContain(
      "add column if not exists description text",
    );
    expect(atomicMigration).toContain("create or replace function private.save_product(product_state jsonb)");
    expect(atomicMigration).toContain("pg_advisory_xact_lock");
    expect(atomicMigration).toContain("is_active boolean not null default true");
    expect(atomicMigration).toContain("download_events");
    expect(atomicMigration).toContain("revoke all on function public.save_product(jsonb) from public");
    expect(concurrencyTest).toContain("public.save_product");
    expect(concurrencyRunner).toContain("pg_advisory_xact_lock");
    expect(concurrencyTest).toContain("33333333-3333-4333-8333-333333333333");
    expect(productAdmin).toContain('supabase.rpc("save_product"');
    expect(productAdmin).not.toContain('from("product_assets").delete');
    expect(productAdmin).not.toContain('from("premium_codes").delete');
    expect(authActions).toContain("buildSupabaseAuthCallbackUrl(locale)");
    expect(authActions).toContain("setAuthResumeIntent");
    expect(authActions).toContain("redeemAuthResumeIntent");
    expect(authActions).toContain("await supabase.auth.resend({");
    expect(playwrightConfig).toContain('LAMILIA_BACKEND: "local"');
    expect(playwrightConfig).toContain('NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000"');

    for (const table of [
      "profiles",
      "products",
      "product_translations",
      "categories",
      "category_translations",
      "tags",
      "tag_translations",
      "product_categories",
      "product_tags",
      "product_assets",
      "amazon_links",
      "premium_codes",
      "user_product_unlocks",
      "download_events",
      "review_reminders",
      "static_pages",
    ]) {
      expect(foundationMigration).toContain(
        `alter table public.${table} enable row level security`,
      );
    }
  });
});

function collectFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return collectFiles(absolutePath);
    }

    return /\.(ts|tsx)$/.test(entry.name) ? [absolutePath] : [];
  });
}
