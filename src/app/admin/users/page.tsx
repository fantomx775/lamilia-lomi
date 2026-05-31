import Link from "next/link";

import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { demoUsers } from "@/lib/seed-data";

export default function AdminUsersPage() {
  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-[var(--color-terracotta)]">Użytkownicy</p>
          <h1 className="mt-2 font-serif text-4xl font-semibold">Użytkownicy i eksport</h1>
        </div>
        <Link className={buttonClassName()} href="/admin/users/export?marketingOnly=1">
          Eksport marketing CSV
        </Link>
      </div>
      <Card className="mt-8 overflow-hidden">
        {demoUsers.map((user) => (
          <div key={user.email} className="grid grid-cols-[1.4fr_0.6fr_0.7fr_0.7fr] border-b border-[var(--color-border)] p-4 text-sm last:border-b-0">
            <span>{user.email}</span>
            <span>{user.role}</span>
            <span>{user.emailVerified ? "verified" : "unverified"}</span>
            <span>{user.marketingConsent ? "marketing" : "no marketing"}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
