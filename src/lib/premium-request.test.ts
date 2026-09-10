import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBackendMode: vi.fn(() => "supabase"),
  getRequiredSupabaseEnv: vi.fn(() => ({
    url: "https://project.supabase.co",
    publishableKey: "publishable-key",
    appUrl: "https://lamilialomi.example",
  })),
  getSupabaseAuthContext: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./config", () => ({
  getBackendMode: mocks.getBackendMode,
  getRequiredSupabaseEnv: mocks.getRequiredSupabaseEnv,
}));
vi.mock("./session.server", () => ({
  getDemoSession: vi.fn(),
  getSupabaseAuthContext: mocks.getSupabaseAuthContext,
  setDemoSession: vi.fn(),
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
