"use client";

import { trackEvent } from "@/lib/analytics-client";

import { ExternalLink } from "lucide-react";
import type { ComponentProps } from "react";

import { buttonClassName } from "./ui/button";

type AmazonLinkProps = ComponentProps<"a"> & {
  productId: string;
  market: string;
};

export function AmazonLink({ productId, market, className, ...props }: AmazonLinkProps) {
  return (
    <a
      className={buttonClassName({ className })}
      target="_blank"
      rel="noreferrer"
      onClick={() => {
        trackEvent("amazon_link_click", { product_id: productId, market });
      }}
      {...props}
    >
      <ExternalLink className="size-4" aria-hidden />
      <span>{props.children}</span>
    </a>
  );
}
