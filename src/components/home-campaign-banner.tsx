import Image from "next/image";

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
          srcSet="/assets/home/campaign-mobile.webp"
          width={1200}
          height={800}
        />
        <Image
          src="/assets/home/campaign-desktop.webp"
          alt="A fairy in a colorful storybook workshop filled with illustrated books, potion bottles, and magical keepsakes."
          width={1920}
          height={400}
          sizes="100vw"
          unoptimized
          loading="eager"
          fetchPriority="high"
          className="block h-auto w-full"
        />
      </picture>
    </section>
  );
}
