import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBackendMode: vi.fn(() => "supabase"),
  getContentSnapshot: vi.fn(),
  saveContentSnapshot: vi.fn(),
  getDemoSession: vi.fn(),
  getRequiredSupabaseEnv: vi.fn(() => ({
    url: "https://project.supabase.co",
    publishableKey: "publishable-key",
    appUrl: "https://lamilialomi.example",
  })),
  getSupabaseAuthContext: vi.fn(),
  getProductBySlug: vi.fn(),
  setDemoSession: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./config", () => ({
  getBackendMode: mocks.getBackendMode,
  getRequiredSupabaseEnv: mocks.getRequiredSupabaseEnv,
}));
vi.mock("./content-store", () => ({
  getContentSnapshot: mocks.getContentSnapshot,
  saveContentSnapshot: mocks.saveContentSnapshot,
}));
vi.mock("./session.server", () => ({
  getDemoSession: mocks.getDemoSession,
  getSupabaseAuthContext: mocks.getSupabaseAuthContext,
  setDemoSession: mocks.setDemoSession,
}));
vi.mock("./products", () => ({
  getProductBySlug: mocks.getProductBySlug,
}));

import {
  authorizePremiumDownloadForRequest,
  redeemPremiumCodeForRequest,
} from "./premium-request";

describe("authorizePremiumDownloadForRequest", () => {
  it("denies an unverified Supabase user before any asset or Storage access", async () => {
    const from = vi.fn();
    mocks.getSupabaseAuthContext.mockResolvedValue({
      supabase: { from },
      user: { id: "user-1", email_confirmed_at: null },
    });

    await expect(
      authorizePremiumDownloadForRequest("asset-1"),
    ).resolves.toEqual({
      ok: false,
      decision: { allowed: false, reason: "unverified" },
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("requests a signed URL with the premium filename for browser downloads", async () => {
    const assetRow = {
      id: "asset-1",
      product_id: "product-1",
      kind: "premium_download",
      bucket: "premium-files",
      path: "products/product-1/premium_download/bonus.pdf",
      filename: "bonus.pdf",
      content_type: "application/pdf",
      size_bytes: 123,
      locale: null,
      title: "Bonus PDF",
      sort_order: 1,
      is_public: false,
      is_active: true,
    };
    const assetMaybeSingle = vi.fn().mockResolvedValue({ data: assetRow, error: null });
    const productMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: "product-1", status: "published" },
      error: null,
    });
    const assetQuery = { select: vi.fn(), eq: vi.fn(), maybeSingle: assetMaybeSingle };
    const productQuery = { select: vi.fn(), eq: vi.fn(), maybeSingle: productMaybeSingle };
    assetQuery.select.mockReturnValue(assetQuery);
    assetQuery.eq.mockReturnValue(assetQuery);
    productQuery.select.mockReturnValue(productQuery);
    productQuery.eq.mockReturnValue(productQuery);

    const from = vi.fn()
      .mockReturnValueOnce(assetQuery)
      .mockReturnValueOnce(productQuery);
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: {
        signedUrl:
          "https://project.supabase.co/storage/v1/object/sign/premium-files/products/product-1%2Fpremium_download%2Fbonus.pdf?token=short",
      },
      error: null,
    });
    mocks.getSupabaseAuthContext.mockResolvedValue({
      supabase: {
        from,
        storage: { from: vi.fn().mockReturnValue({ createSignedUrl }) },
        rpc: vi.fn().mockResolvedValue({ data: "event-1", error: null }),
      },
      user: { id: "user-1", email_confirmed_at: "2026-09-08T00:00:00.000Z" },
    });

    await expect(authorizePremiumDownloadForRequest("asset-1")).resolves.toMatchObject({
      ok: true,
      url: "https://project.supabase.co/storage/v1/object/sign/premium-files/products/product-1%2Fpremium_download%2Fbonus.pdf?token=short",
    });
    expect(createSignedUrl).toHaveBeenCalledWith(
      assetRow.path,
      10 * 60,
      { download: "bonus.pdf" },
    );
  });

  it("fails closed when Supabase returns a signed URL outside the configured project", async () => {
    const assetMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: "asset-1",
        product_id: "product-1",
        kind: "premium_download",
        bucket: "premium-files",
        path: "products/product-1/premium_download/bonus.pdf",
        filename: "bonus.pdf",
        content_type: "application/pdf",
        size_bytes: 123,
        locale: null,
        title: "Bonus PDF",
        sort_order: 1,
        is_public: false,
        is_active: true,
      },
      error: null,
    });
    const productMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: "product-1", status: "published" },
      error: null,
    });
    const assetQuery = { select: vi.fn(), eq: vi.fn(), maybeSingle: assetMaybeSingle };
    const productQuery = { select: vi.fn(), eq: vi.fn(), maybeSingle: productMaybeSingle };
    assetQuery.select.mockReturnValue(assetQuery);
    assetQuery.eq.mockReturnValue(assetQuery);
    productQuery.select.mockReturnValue(productQuery);
    productQuery.eq.mockReturnValue(productQuery);
    const from = vi.fn()
      .mockReturnValueOnce(assetQuery)
      .mockReturnValueOnce(productQuery);
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: "https://evil.example/storage/v1/object/sign/premium-files/file?token=short" },
      error: null,
    });
    const rpc = vi.fn();
    mocks.getSupabaseAuthContext.mockResolvedValue({
      supabase: {
        from,
        storage: { from: vi.fn().mockReturnValue({ createSignedUrl }) },
        rpc,
      },
      user: { id: "user-1", email_confirmed_at: "2026-09-08T00:00:00.000Z" },
    });

    await expect(authorizePremiumDownloadForRequest("asset-1")).rejects.toThrow(
      "untrusted URL",
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("normalizes the premium code before calling the authoritative RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        status: "success",
        product_id: "product-1",
        premium_code_id: "code-1",
      },
      error: null,
    });
    mocks.getSupabaseAuthContext.mockResolvedValue({
      supabase: { rpc },
      user: { id: "user-1", email_confirmed_at: "2026-09-08T00:00:00.000Z" },
    });

    await expect(
      redeemPremiumCodeForRequest({
        productSlug: "moon-garden-coloring-book",
        productId: "product-1",
        code: " lomi – book 2026 ",
      }),
    ).resolves.toMatchObject({ ok: true, normalizedCode: "LOMI-BOOK2026" });
    expect(rpc).toHaveBeenCalledWith("redeem_premium_code", {
      requested_product_id: "product-1",
      requested_code: "LOMI-BOOK2026",
    });
  });

  it("maps an already-used premium code to a recoverable domain result", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { status: "already_used" },
      error: null,
    });
    mocks.getSupabaseAuthContext.mockResolvedValue({
      supabase: { rpc },
      user: { id: "user-1", email_confirmed_at: "2026-09-08T00:00:00.000Z" },
    });

    await expect(
      redeemPremiumCodeForRequest({
        productSlug: "moon-garden-coloring-book",
        productId: "product-1",
        code: "LOMI-BOOK-2026",
      }),
    ).resolves.toEqual({ ok: false, status: "already_used" });
  });

  it.each([
    {
      label: "an unexpected bucket",
      asset: { bucket: "public-media" },
    },
    {
      label: "a cross-product storage path",
      asset: { path: "products/other-product/premium_download/bonus.pdf" },
    },
  ])("fails closed for premium metadata with $label", async ({ asset }) => {
    const assetMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: "asset-1",
        product_id: "product-1",
        kind: "premium_download",
        bucket: "premium-files",
        path: "products/product-1/premium_download/bonus.pdf",
        filename: "bonus.pdf",
        content_type: "application/pdf",
        size_bytes: 123,
        locale: null,
        title: "Bonus PDF",
        sort_order: 1,
        is_public: false,
        is_active: true,
        ...asset,
      },
      error: null,
    });
    const productMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: "product-1", status: "published" },
      error: null,
    });
    const assetQuery = { select: vi.fn(), eq: vi.fn(), maybeSingle: assetMaybeSingle };
    const productQuery = { select: vi.fn(), eq: vi.fn(), maybeSingle: productMaybeSingle };
    assetQuery.select.mockReturnValue(assetQuery);
    assetQuery.eq.mockReturnValue(assetQuery);
    productQuery.select.mockReturnValue(productQuery);
    productQuery.eq.mockReturnValue(productQuery);
    const from = vi.fn()
      .mockReturnValueOnce(assetQuery)
      .mockReturnValueOnce(productQuery);
    const createSignedUrl = vi.fn();
    mocks.getSupabaseAuthContext.mockResolvedValue({
      supabase: {
        from,
        storage: { from: vi.fn().mockReturnValue({ createSignedUrl }) },
      },
      user: { id: "user-1", email_confirmed_at: "2026-09-08T00:00:00.000Z" },
    });

    await expect(authorizePremiumDownloadForRequest("asset-1")).resolves.toEqual({
      ok: false,
      decision: { allowed: false, reason: "wrong_asset" },
    });
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
});

describe("redeemPremiumCodeForRequest in local mode", () => {
  it("allows one account to claim a code when two accounts redeem it concurrently", async () => {
    type LocalSnapshot = {
      products: Array<{
        id: string;
        premiumCodes: Array<{
          id: string;
          productId: string;
          code: string;
          active: boolean;
          redeemedAt?: string;
          redeemedBy?: string;
        }>;
      }>;
    };
    const productId = "local-product-1";
    const code = "LOCAL-CROSS-ACCOUNT-TEST";
    const state: { snapshot: LocalSnapshot } = {
      snapshot: {
        products: [{
          id: productId,
          premiumCodes: [{
            id: "local-premium-code-1",
            productId,
            code,
            active: true,
          }],
        }],
      },
    };
    mocks.getBackendMode.mockReturnValue("local");
    mocks.getProductBySlug.mockReturnValue({ id: productId });
    mocks.getContentSnapshot.mockImplementation(() => state.snapshot);
    mocks.saveContentSnapshot.mockImplementation((snapshot: typeof state.snapshot) => {
      state.snapshot = snapshot;
    });
    mocks.getDemoSession
      .mockResolvedValueOnce({
        email: "reader-one@example.com",
        emailVerified: true,
        unlockedProductIds: [],
      })
      .mockResolvedValueOnce({
        email: "reader-two@example.com",
        emailVerified: true,
        unlockedProductIds: [],
      });

    const results = await Promise.all([
      redeemPremiumCodeForRequest({ productSlug: "local-product", productId, code }),
      redeemPremiumCodeForRequest({ productSlug: "local-product", productId, code }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      "already_used",
      "success",
    ]);
    expect(mocks.saveContentSnapshot).toHaveBeenCalledTimes(1);
    expect(state.snapshot.products[0]?.premiumCodes[0]).toMatchObject({
      redeemedAt: expect.any(String),
      redeemedBy: expect.stringMatching(/^email:/),
    });

    const ownerEmail = state.snapshot.products[0]?.premiumCodes[0]?.redeemedBy?.slice(6) ?? "";
    expect(ownerEmail).toBeTruthy();
    mocks.getDemoSession.mockResolvedValueOnce({
      email: ownerEmail,
      emailVerified: true,
      unlockedProductIds: [],
    });

    await expect(
      redeemPremiumCodeForRequest({ productSlug: "local-product", productId, code }),
    ).resolves.toMatchObject({ ok: true, status: "already_unlocked" });
    expect(mocks.setDemoSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ unlockedProductIds: [productId] }),
    );
    expect(mocks.saveContentSnapshot).toHaveBeenCalledTimes(1);
  });
});
