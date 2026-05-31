"use client";

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
        const body = JSON.stringify({ productId, market });
        if (navigator.sendBeacon) {
          navigator.sendBeacon("/api/analytics/amazon-click", body);
        } else {
          void fetch("/api/analytics/amazon-click", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
          });
        }
      }}
      {...props}
    >
      <ExternalLink className="size-4" aria-hidden />
      <span>{props.children}</span>
    </a>
  );
}
