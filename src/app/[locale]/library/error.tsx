"use client";
import { RouteRecovery } from "@/components/route-recovery";
export default function Error({ retry }: { error: unknown; retry: () => void }) {
  return <RouteRecovery retry={retry} title="Your library could not be loaded" backHref="/en/library" backLabel="My Library" />;
}
