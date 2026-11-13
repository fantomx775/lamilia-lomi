"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAdminToast } from "@/components/admin/admin-toast";
import { Button } from "@/components/ui/button";

export function AvatarModerationActions({ id, status }: { id: string; status: "pending" | "approved" }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useAdminToast();

  async function review(decision: "approved" | "rejected" | "removed") {
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/community/avatars/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }),
      });
      if (!response.ok) throw new Error("Review failed.");
      toast("success", "Zapisano decyzję moderacji zdjęcia.");
      router.refresh();
    } catch {
      toast("error", "Nie udało się zapisać decyzji. Odśwież kolejkę i spróbuj ponownie.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {status === "pending" ? (
        <>
          <Button disabled={busy} onClick={() => { void review("approved"); }}>Zatwierdź</Button>
          <Button disabled={busy} variant="outline" onClick={() => { void review("rejected"); }}>Odrzuć</Button>
        </>
      ) : (
        <Button disabled={busy} variant="outline" onClick={() => { void review("removed"); }}>Usuń publiczne zdjęcie</Button>
      )}
    </div>
  );
}
