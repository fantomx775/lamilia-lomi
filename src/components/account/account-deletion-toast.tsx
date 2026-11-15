"use client";

import { useEffect } from "react";
import { useToast } from "@/components/ui/toast";

export function AccountDeletionToast() {
  const { showToast } = useToast();
  useEffect(() => {
    try {
      if (sessionStorage.getItem("lamilia-account-deleted") !== "1") return;
      sessionStorage.removeItem("lamilia-account-deleted");
      showToast("success", "Your account was deleted.");
    } catch {
      // Storage can be unavailable in restricted browsing contexts.
    }
  }, [showToast]);
  return null;
}
