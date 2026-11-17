"use client";
import { RouteRecovery } from "@/components/route-recovery";
export default function Error({ retry }: { error: unknown; retry: () => void }) {
  return <RouteRecovery retry={retry} title="The catalog could not be loaded" backHref="/en/products" backLabel="Catalog" />;
}
