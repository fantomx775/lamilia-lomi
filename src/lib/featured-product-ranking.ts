type FeaturedProductRanking = {
  reviewDelayDays: number;
  title: string;
};

export function sortFeaturedProductCandidates<T extends FeaturedProductRanking>(
  products: readonly T[],
): T[] {
  return [...products].sort(
    (a, b) =>
      a.reviewDelayDays - b.reviewDelayDays || a.title.localeCompare(b.title),
  );
}
