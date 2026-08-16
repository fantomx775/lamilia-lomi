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
    const foundationMigration = read(
      "supabase/migrations/20260531093244_lamilialomi_foundation.sql",
    );

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
    expect(rlsTest).toContain("RLS matrix complete: 23 positive scenarios passed");

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
