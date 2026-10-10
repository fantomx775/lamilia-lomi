import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { getR2PublicBaseUrl } from "./src/lib/media-r2-config";

const r2PublicBaseUrl = getR2PublicBaseUrl();

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  logging: {
    incomingRequests: {
      ignore: [/\/auth\/callback(?:\?|$)/],
    },
  },
  images: {
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    minimumCacheTTL: 60,
    remotePatterns: r2PublicBaseUrl
      ? [{ protocol: "https", hostname: new URL(r2PublicBaseUrl).hostname, pathname: "/products/**" }]
      : [],
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
