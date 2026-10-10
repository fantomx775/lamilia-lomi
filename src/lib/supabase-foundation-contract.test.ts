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
    const verifiedStoragePolicyMigration = read(
      "supabase/migrations/20260910144459_restore_verified_premium_storage_policy.sql",
    );
    const premiumCodeLengthMigration = read(
      "supabase/migrations/20260912111002_enforce_premium_code_length.sql",
    );
    const r2MediaMigration = read(
      "supabase/migrations/20261008120000_r2_media_storage_provider.sql",
    );
    const r2PublicationMigration = read(
      "supabase/migrations/20261008224035_r2_media_publication_pending.sql",
    );
    const r2RevocationMigration = read(
      "supabase/migrations/20261009113000_r2_media_publication_revoking.sql",
    );
    const r2BackfillScript = read("scripts/media-r2-backfill.mjs");
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
    expect(rlsTest).toContain("RLS matrix complete:");
    expect(premiumCodeLengthMigration).toContain(
      "premium_codes_normalized_code_length_check",
    );
    expect(premiumCodeLengthMigration).toContain(
      "check (char_length(normalized_code) between 1 and 128)",
    );
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
    expect(verifiedStoragePolicyMigration).toContain(
      'create policy "premium objects are readable after unlock"',
    );
    expect(verifiedStoragePolicyMigration).toContain(
      "private.is_email_verified()",
    );
    expect(verifiedStoragePolicyMigration).toContain("a.is_active");
    expect(verifiedStoragePolicyMigration).toContain("p.status = 'published'");
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
    expect(productAdmin).toContain('"save_product_with_storage_provider" : "save_product"');
    expect(r2MediaMigration).toContain("add column if not exists storage_provider text not null default 'supabase'");
    expect(r2MediaMigration).toContain("asset.kind in ('cover', 'gallery')");
    expect(r2MediaMigration).toContain("product.status = 'published'");
    expect(r2MediaMigration).toContain("grant execute on function public.set_product_asset_storage_provider(uuid, text) to authenticated, service_role");
    expect(r2MediaMigration).toMatch(/create or replace function public\.save_product_with_storage_provider\(product_state jsonb\)[\s\S]*?security invoker/);
    expect(r2MediaMigration).toMatch(/create or replace function public\.set_product_asset_storage_provider\([\s\S]*?security invoker/);
    expect(r2MediaMigration).toContain("grant execute on function private.save_product_with_storage_provider(jsonb) to authenticated");
    expect(r2MediaMigration).toContain("grant execute on function private.set_product_asset_storage_provider(uuid, text) to authenticated, service_role");
    expect(r2PublicationMigration).toContain("'r2_public_pending'");
    expect(r2PublicationMigration).toContain("asset.path = requested_path");
    expect(r2PublicationMigration).toContain("product.status = 'published'");
    expect(r2PublicationMigration).toContain("pg_advisory_xact_lock(hashtextextended(requested_product_id::text, 0))");
    expect(r2PublicationMigration).toContain("grant execute on function public.set_product_asset_storage_provider(uuid, text, text) to authenticated, service_role");
    expect(r2PublicationMigration).toContain("if requested_provider = 'r2_public' then");
    expect(r2RevocationMigration).toContain("current_provider in ('r2_public_pending', 'r2_public_revoking', 'r2_public')");
    expect(r2RevocationMigration).toMatch(/and current_provider = 'r2_public_pending'\r?\n\s+and coalesce\(\(select auth\.role\(\)\), ''\) <> 'service_role'/);
    expect(r2RevocationMigration).toMatch(/requested_provider = 'r2_private'\r?\n\s+and current_provider = 'r2_public_revoking'\r?\n\s+and coalesce\(\(select auth\.role\(\)\), ''\) <> 'service_role' then\r?\n\s+return false/);
    expect(r2RevocationMigration).toMatch(/create or replace function private\.save_product_with_storage_provider\(product_state jsonb\)[\s\S]+?previous_asset\.storage_provider = 'r2_public_revoking'[\s\S]+?Public media must be revoked before changing product media or publication state\./);
    expect(r2RevocationMigration).toMatch(/if requested_provider in \('r2_public_pending', 'r2_public'\) and not exists \([\s\S]+?asset\.is_active[\s\S]+?product\.status = 'published'/);
    expect(r2RevocationMigration).toMatch(/requested_provider in \('r2_public_pending', 'r2_public'\) and exists \([\s\S]+?sibling\.storage_provider = 'r2_public_revoking'[\s\S]+?return false/);
    expect(r2RevocationMigration).toMatch(/current_provider = 'r2_public_revoking' or exists \([\s\S]+?sibling\.storage_provider = 'r2_public_revoking'[\s\S]+?return false/);
    expect(r2RevocationMigration).toMatch(/create or replace function private\.begin_stale_product_asset_public_revocation\([\s\S]+?if current_product_status = 'published' and exists \([\s\S]+?sibling\.path = requested_path[\s\S]+?sibling\.storage_provider in \('r2_public_pending', 'r2_public'\)[\s\S]+?sibling\.is_active[\s\S]+?sibling\.is_public[\s\S]+?return false;[\s\S]+?if current_provider = 'r2_public_revoking' then return true; end if;/);
    const staleRevocationFunction = r2RevocationMigration.match(
      /create or replace function private\.begin_stale_product_asset_public_revocation\([\s\S]*?\n\$\$;/,
    )?.[0] ?? "";
    expect(staleRevocationFunction).toContain(
      "if current_provider = 'r2_public_revoking' then return true; end if;",
    );
    expect(staleRevocationFunction).not.toContain(
      "sibling.storage_provider = 'r2_public_revoking'",
    );
    expect(r2BackfillScript).toContain('.in("storage_provider", ["r2_public_pending", "r2_public"])');
    expect(r2BackfillScript).toMatch(/function isPotentiallyEligiblePublicAsset\(row\)[\s\S]+?\["r2_public_pending", "r2_public"\]\.includes\(row\.storage_provider\)/);
    expect(r2RevocationMigration).toMatch(/when nullif\(item ->> 'storageProvider', ''\) in \('r2_public_pending', 'r2_public_revoking', 'r2_public'\)\s+then 'r2_private'/);
    expect(r2RevocationMigration).toMatch(/previous_asset\.storage_provider = 'r2_public_revoking'[\s\S]+?requested_product_status is distinct from 'published'[\s\S]+?next_asset\.path is distinct from previous_asset\.path[\s\S]+?Public media must be revoked before changing product media or publication state\./);
    expect(r2RevocationMigration).toMatch(/create or replace function private\.assert_legacy_product_save_safe\(product_state jsonb\)[\s\S]+?previous_asset\.storage_provider in \('r2_public_pending', 'r2_public_revoking', 'r2_public'\)[\s\S]+?Public media must be revoked before changing product media or publication state\./);
    expect(r2RevocationMigration).toMatch(/create or replace function public\.save_product\(product_state jsonb\)[\s\S]+?perform private\.assert_legacy_product_save_safe\(product_state\);[\s\S]+?return private\.save_product\(product_state\);/);
    expect(r2RevocationMigration).toContain("grant execute on function private.assert_legacy_product_save_safe(jsonb) to authenticated");
    expect(r2RevocationMigration).toContain("revoke insert, update, delete, truncate, references, trigger");
    expect(r2RevocationMigration).toContain('drop policy if exists "products_admin_all" on public.products');
    expect(r2RevocationMigration).toContain('drop policy if exists "assets_admin_all" on public.product_assets');
    expect(r2RevocationMigration).toMatch(/create or replace function private\.archive_product\(requested_product_id uuid\)[\s\S]+?pg_advisory_xact_lock\(hashtextextended\(requested_product_id::text, 0\)\)[\s\S]+?if not found then return false; end if;[\s\S]+?storage_provider in \('r2_public_pending', 'r2_public_revoking', 'r2_public'\)[\s\S]+?update public\.products\s+set status = 'archived'/);
    expect(r2RevocationMigration).toContain("grant execute on function public.archive_product(uuid) to authenticated");
    expect(r2RevocationMigration).toMatch(/create or replace function private\.delete_product\(requested_product_id uuid\)[\s\S]+?storage_provider in \('r2_public_pending', 'r2_public_revoking', 'r2_public'\)[\s\S]+?Public media must be revoked before deleting this product\./);
    expect(r2RevocationMigration).toContain("grant execute on function public.delete_product(uuid) to authenticated");
    expect(productAdmin).toContain('supabase.rpc("archive_product"');
    expect(rlsTest).toContain("admin direct writes to product and asset rows are restricted");
    expect(rlsTest).toContain("legacy save RPC blocks archive while public R2 media exists");
    expect(rlsTest).toContain("delete RPC blocks deletion while public R2 media exists");
    expect(productAdmin).toContain('supabase.rpc("delete_product"');
    expect(productAdmin).not.toContain('from("products").delete');
    expect(productAdmin).not.toContain('from("products").update');
    expect(r2PublicationMigration).toContain("grant execute on function public.set_product_asset_storage_provider(uuid, text) to authenticated, service_role");
    expect(productAdmin).not.toContain('from("product_assets").delete');
    expect(productAdmin).not.toContain('from("premium_codes").delete');
    expect(authActions).toContain("buildSupabaseAuthCallbackUrl(locale, safeRedirectTo, intent)");
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
