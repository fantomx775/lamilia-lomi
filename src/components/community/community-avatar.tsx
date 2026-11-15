"use client";

import Image from "next/image";
import { useState } from "react";
import { getCommunityAvatarPresentation } from "@/lib/community/avatar";
import { cn } from "@/lib/utils";

export function CommunityAvatar({
  username,
  seed,
  className,
  photoSrc,
}: {
  username: string;
  seed: string;
  className?: string;
  photoSrc?: string;
}) {
  const presentation = getCommunityAvatarPresentation(username, seed);
  const [failedPhoto, setFailedPhoto] = useState<string>();
  const showPhoto = photoSrc && photoSrc !== failedPhoto;
  return (
    <span
      aria-label={showPhoto ? `Profile photo for @${username}` : `Generated avatar for @${username}`}
      className={cn("relative inline-grid size-12 shrink-0 place-items-center overflow-hidden rounded-full font-semibold text-[var(--color-ink)]", className)}
      role="img"
      style={{ backgroundColor: presentation.color }}
    >
      {showPhoto ? null : presentation.initials}
      {showPhoto ? <Image src={photoSrc} alt="" fill unoptimized sizes="80px" className="object-cover" onError={() => setFailedPhoto(photoSrc)} /> : null}
    </span>
  );
}
