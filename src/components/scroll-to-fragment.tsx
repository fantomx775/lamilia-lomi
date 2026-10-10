"use client";

import { useEffect } from "react";

export function ScrollToFragment({ targetId }: { targetId: string }) {
  useEffect(() => {
    if (window.location.hash !== `#${targetId}`) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({ block: "start" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [targetId]);

  return null;
}
