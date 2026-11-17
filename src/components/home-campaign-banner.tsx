export function HomeCampaignBanner() {
  return (
    <section
      data-testid="home-campaign-banner"
      aria-label="LamiliaLomi illustrated banner"
      className="w-full"
    >
      <picture>
        <source
          media="(max-width: 767px)"
          srcSet="/assets/home/campaign-mobile-640.webp 640w, /assets/home/campaign-mobile-960.webp 960w, /assets/home/campaign-mobile-1200.webp 1200w"
          sizes="100vw"
          width={1200}
          height={800}
        />
        {/* Art-directed local derivatives deliberately bypass the image optimizer. */}
        <img
          src="/assets/home/campaign-desktop-1920.webp"
          alt="A fairy in a colorful storybook workshop filled with illustrated books, potion bottles, and magical keepsakes."
          width={1920}
          height={400}
          sizes="100vw"
          srcSet="/assets/home/campaign-desktop-1280.webp 1280w, /assets/home/campaign-desktop-1920.webp 1920w"
          loading="eager"
          fetchPriority="high"
          className="block h-auto w-full"
        />
      </picture>
    </section>
  );
}
