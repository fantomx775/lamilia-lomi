"use client";
import { RouteRecovery } from "@/components/route-recovery";
export default function Error({ retry }: { error: unknown; retry: () => void }) {
  return <RouteRecovery retry={retry} title="Coloring Club could not be loaded" backHref="/en/club" backLabel="Coloring Club" />;
}
