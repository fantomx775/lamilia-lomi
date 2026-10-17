import nextConfig from "../../next.config";

describe("Next Image local media optimization", () => {
  it("keeps static paths query-free and permits versioned media proxy paths", () => {
    expect(nextConfig.images?.localPatterns).toEqual([
      { pathname: "/assets/**", search: "" },
      { pathname: "/uploads/**", search: "" },
      { pathname: "/api/media/**" },
      { pathname: "/api/category-media/**" },
    ]);
  });
});
