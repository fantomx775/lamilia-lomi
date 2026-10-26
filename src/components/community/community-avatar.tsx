import { getCommunityAvatarPresentation } from "@/lib/community/avatar";
import { cn } from "@/lib/utils";

export function CommunityAvatar({
  username,
  seed,
  className,
}: {
  username: string;
  seed: string;
  className?: string;
}) {
  const presentation = getCommunityAvatarPresentation(username, seed);
  return (
    <span
      aria-label={`Generated avatar for @${username}`}
      className={cn("inline-grid size-12 shrink-0 place-items-center rounded-full font-semibold text-[var(--color-ink)]", className)}
      role="img"
      style={{ backgroundColor: presentation.color }}
    >
      {presentation.initials}
    </span>
  );
}
