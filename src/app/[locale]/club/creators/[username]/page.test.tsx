import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({
  publicEnabled: true,
  creator: {
    username: "garden_user",
    avatarSeed: "public-safe-seed",
    artworks: [{
      id: "public-artwork-id",
      product: { id: "public-product-id", slug: "moon-garden", title: "Moon Garden", audience: "adults" },
      creator: { username: "garden_user", avatarSeed: "public-safe-seed" },
      contentType: "image/png",
      description: "A quiet garden in bloom",
      publishedAt: "2026-10-25T12:00:00.000Z",
      likesCount: 4,
      likedByMe: false,
    }],
  } as null | {
    username: string;
    avatarSeed: string;
    artworks: Array<{
      id: string;
      product: { id: string; slug: string; title: string; audience: string };
      creator: { username: string; avatarSeed: string };
      contentType: string;
      description: string;
      publishedAt: string;
      likesCount: number;
      likedByMe: boolean;
    }>;
  },
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.ComponentProps<"a">) => <a href={href} {...props}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/community-flags", () => ({
  getCommunityFlags: () => ({ publicEnabled: state.publicEnabled, uploadsEnabled: false }),
}));
vi.mock("@/lib/community/repository", () => ({
  getCommunityPublicCreator: vi.fn(async () => state.creator),
  getCommunityHeartContext: vi.fn(async () => ({ access: "guest" })),
}));

import CreatorProfilePage, { generateMetadata } from "./page";

const pageProps = { params: Promise.resolve({ locale: "en" as const, username: "garden_user" }) };

describe("public creator profile route", () => {
  it("renders only approved public metadata and links to the real book page", async () => {
    const node = await CreatorProfilePage(pageProps);
    const html = renderToStaticMarkup(node);
    expect(html).toContain("@garden_user");
    expect(html).toContain("A quiet garden in bloom");
    expect(html).toContain("/en/products/moon-garden");
    expect(html).not.toContain("authUUID");
    expect(html).not.toContain("email@example.test");
  });

  it("has noindex metadata for inactive creators and when public access is disabled", async () => {
    state.creator = null;
    expect((await generateMetadata(pageProps)).robots).toEqual({ index: false, follow: false });
    state.publicEnabled = false;
    state.creator = {
      username: "garden_user", avatarSeed: "public-safe-seed", artworks: [],
    };
    expect((await generateMetadata(pageProps)).robots).toEqual({ index: false, follow: false });
    await expect(CreatorProfilePage(pageProps)).rejects.toThrow("NOT_FOUND");
    state.publicEnabled = true;
  });

  it("shows a useful empty state for an active creator without approved work", async () => {
    state.creator = { username: "garden_user", avatarSeed: "public-safe-seed", artworks: [] };
    const node = await CreatorProfilePage(pageProps);
    expect(renderToStaticMarkup(node)).toContain("No approved creations yet");
  });
});
