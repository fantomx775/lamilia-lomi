"use client";

import Link from "next/link";
import { useId, useRef, useState, type FormEvent } from "react";

import { CommunityAvatar } from "@/components/community/community-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { COMMUNITY_RULES_VERSION } from "@/lib/community/rules";

type CommunityProfileView = {
  username: string;
  avatarSeed: string;
  isAdult: boolean;
  adultAttestedAt: string | null;
  optedInAt: string | null;
  participationRevokedAt: string | null;
  rulesVersion: string;
  acceptedAt: string;
  suspendedAt: string | null;
};

export function CommunityAccountPanel({
  profile: initialProfile,
  enabled,
  publicEnabled,
  emailVerified,
  guidelinesHref,
  creatorProfileBaseHref,
  contactHref,
}: {
  profile: CommunityProfileView | null;
  enabled: boolean;
  publicEnabled: boolean;
  emailVerified: boolean;
  guidelinesHref: string;
  creatorProfileBaseHref: string;
  contactHref: string;
}) {
  const idPrefix = useId();
  const usernameRef = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState(initialProfile);
  const [username, setUsername] = useState(initialProfile?.username ?? "");
  const [adultAttested, setAdultAttested] = useState(false);
  const [rulesAccepted, setRulesAccepted] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const active = Boolean(profile && profile.isAdult && profile.adultAttestedAt && profile.optedInAt
    && !profile.participationRevokedAt && !profile.suspendedAt
    && profile.rulesVersion === COMMUNITY_RULES_VERSION);
  const suspended = Boolean(profile?.suspendedAt);

  async function submitJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!adultAttested || !rulesAccepted) {
      setError("Confirm both requirements before joining.");
      return;
    }
    setBusy(true);
    try {
      const result = await sendCommunityRequest("/api/community/join", "POST", {
        username,
        adultAttested,
        rulesAccepted,
        rulesVersion: COMMUNITY_RULES_VERSION,
      });
      const nextProfile = result.profile as CommunityProfileView;
      setProfile(nextProfile);
      setUsername(nextProfile.username);
      setAdultAttested(false);
      setRulesAccepted(false);
      setNotice("You joined the Coloring Club. Your artwork stays private until approved.");
    } catch (caught) {
      setError(toMessage(caught));
      usernameRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  async function submitUsername(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const result = await sendCommunityRequest("/api/community/profile", "PATCH", { username });
      const nextProfile = result.profile as CommunityProfileView;
      setProfile(nextProfile);
      setUsername(nextProfile.username);
      setNotice("Your public username was updated.");
    } catch (caught) {
      setError(toMessage(caught));
      usernameRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  async function leaveClub() {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const result = await sendCommunityRequest("/api/community/profile", "DELETE");
      setProfile(result.profile as CommunityProfileView | null);
      setConfirmLeave(false);
      setNotice("You left the Coloring Club. Your profile and work are no longer public.");
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid="community-account-panel">
      <CardHeader>
        <p className="text-sm font-medium uppercase tracking-[0.14em] text-[var(--color-terracotta)]">Coloring Club</p>
        <h2 className="font-serif text-2xl font-semibold text-[var(--color-ink)]">{profile ? "Community settings" : "Join the Coloring Club"}</h2>
        <p className="text-sm leading-6 text-[var(--color-muted)]">
          Share your coloring with the community. Joining is separate from marketing consent.
        </p>
      </CardHeader>
      <CardContent className="grid gap-5">
        {error ? <p id={`${idPrefix}-error`} className="rounded-md bg-[var(--color-error-bg)] p-3 text-sm text-[var(--color-error)]" role="alert">{error}</p> : null}
        {notice ? <p className="rounded-md bg-[var(--color-sage)] p-3 text-sm text-[var(--color-ink)]" role="status" aria-live="polite">{notice}</p> : null}

        {profile ? (
          <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-md border border-[var(--color-border)] bg-white p-4">
            <CommunityAvatar username={profile.username} seed={profile.avatarSeed} />
            <div className="min-w-0 flex-1">
              <p className="break-all font-semibold text-[var(--color-ink)]">@{profile.username}</p>
              <p className="text-sm text-[var(--color-muted)]">
                {profile.suspendedAt ? "Participation is paused." : active ? "Community member" : "You are not currently participating."}
              </p>
            </div>
            {publicEnabled && active ? (
              <Link
                className="ml-auto max-w-full shrink-0 rounded-sm text-sm font-medium text-[var(--color-ink)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]"
                href={`${creatorProfileBaseHref}/${encodeURIComponent(profile.username)}`}
              >
                View profile
              </Link>
            ) : null}
          </div>
        ) : null}

        {!emailVerified ? (
          <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-alt)] p-4 text-sm leading-6 text-[var(--color-muted)]">
            Verify your email before joining or changing community settings.
          </div>
        ) : null}

        {suspended ? (
          <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-alt)] p-4 text-sm leading-6 text-[var(--color-muted)]">
            Your community participation is paused. Contact the team if you have a question.
            <Link className="ml-1 font-medium text-[var(--color-ink)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]" href={contactHref}>Contact us</Link>
          </div>
        ) : null}

        {enabled && emailVerified && !active && !suspended ? (
          <form className="grid gap-4" onSubmit={submitJoin}>
            <div className="grid gap-2">
              <Label htmlFor={`${idPrefix}-username`}>Public username</Label>
              <div className="flex h-11 items-center rounded-md border border-[var(--color-border)] bg-white focus-within:border-[var(--color-terracotta)] focus-within:ring-4 focus-within:ring-[var(--color-terracotta-ring)]">
                <span className="pl-3 text-sm text-[var(--color-muted)]" aria-hidden="true">@</span>
                <Input
                  id={`${idPrefix}-username`}
                  ref={usernameRef}
                  autoComplete="nickname"
                  readOnly={Boolean(profile)}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? `${idPrefix}-error` : `${idPrefix}-username-help`}
                  className="h-full border-0 bg-transparent shadow-none focus:border-0 focus:ring-0"
                  maxLength={24}
                  minLength={3}
                  onChange={(event) => setUsername(event.target.value)}
                  pattern="[A-Za-z0-9_]{3,24}"
                  placeholder="garden_artist"
                  required
                  value={username}
                />
              </div>
              <p id={`${idPrefix}-username-help`} className="text-xs leading-5 text-[var(--color-muted)]">
                {profile ? "Your current username stays assigned while you rejoin. Change it separately after rejoining." : "Use 3–24 letters, numbers, or underscores. Your username is public."}
              </p>
            </div>
            <label className="flex items-start gap-3 text-sm leading-6 text-[var(--color-ink)]">
              <input
                checked={adultAttested}
                className="mt-1 size-4 accent-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]"
                onChange={(event) => setAdultAttested(event.target.checked)}
                required
                type="checkbox"
                aria-describedby={error ? `${idPrefix}-error` : undefined}
              />
              <span>I confirm that I am 18 years or older and will operate this account.</span>
            </label>
            <label className="flex items-start gap-3 text-sm leading-6 text-[var(--color-ink)]">
              <input
                checked={rulesAccepted}
                className="mt-1 size-4 accent-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]"
                onChange={(event) => setRulesAccepted(event.target.checked)}
                required
                type="checkbox"
                aria-describedby={error ? `${idPrefix}-error` : undefined}
              />
              <span>I accept the current community guidelines, version {COMMUNITY_RULES_VERSION}.</span>
            </label>
            <p className="text-xs leading-5 text-[var(--color-muted)]">Your artwork stays private until approved. No date of birth or marketing consent is requested.</p>
            <div className="flex flex-wrap items-center gap-4">
              <Button disabled={busy} type="submit">{busy ? "Joining…" : "Join the Coloring Club"}</Button>
              <Link className="text-sm font-medium text-[var(--color-ink)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]" href={guidelinesHref}>
                Read the guidelines
              </Link>
            </div>
          </form>
        ) : null}

        {enabled && emailVerified && active ? (
          <>
            <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" onSubmit={submitUsername}>
              <div className="grid gap-2">
                <Label htmlFor={`${idPrefix}-rename`}>Change public username</Label>
                <Input
                  id={`${idPrefix}-rename`}
                  ref={usernameRef}
                  autoComplete="nickname"
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? `${idPrefix}-error` : `${idPrefix}-rename-help`}
                  maxLength={24}
                  minLength={3}
                  onChange={(event) => setUsername(event.target.value)}
                  pattern="[A-Za-z0-9_]{3,24}"
                  required
                  value={username}
                />
                <p id={`${idPrefix}-rename-help`} className="text-xs leading-5 text-[var(--color-muted)]">Username changes are limited to three per hour.</p>
              </div>
              <Button disabled={busy || username.trim().toLowerCase() === profile?.username} type="submit" variant="outline">
                {busy ? "Saving…" : "Save username"}
              </Button>
            </form>
            <p className="text-sm text-[var(--color-muted)]">
              Guidelines accepted: version {profile?.rulesVersion}.
              {" "}
              <Link className="font-medium text-[var(--color-ink)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]" href={guidelinesHref}>Read the current guidelines</Link>
            </p>
          </>
        ) : null}

        {!enabled && !profile ? (
          <p className="rounded-md bg-[var(--color-bg-alt)] p-4 text-sm leading-6 text-[var(--color-muted)]">
            Club participation is currently unavailable. You can still read the <Link className="font-medium text-[var(--color-ink)] underline underline-offset-4" href={guidelinesHref}>community guidelines</Link>.
          </p>
        ) : null}

        {profile && !profile.participationRevokedAt ? (
          <div className="border-t border-[var(--color-border)] pt-4">
            {confirmLeave ? (
              <div className="grid gap-3 rounded-md bg-[var(--color-bg-alt)] p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                <p className="text-sm leading-6 text-[var(--color-muted)]">Leaving immediately hides your public profile and work. You can join again later.</p>
                <Button disabled={busy} onClick={() => setConfirmLeave(false)} type="button" variant="outline">Keep membership</Button>
                <Button disabled={busy} onClick={leaveClub} type="button" variant="outline">{busy ? "Leaving…" : "Confirm leave"}</Button>
              </div>
            ) : (
              <Button disabled={busy} onClick={() => setConfirmLeave(true)} type="button" variant="ghost">Leave the Coloring Club</Button>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

async function sendCommunityRequest(path: string, method: "POST" | "PATCH" | "DELETE", body?: Record<string, unknown>) {
  const response = await fetch(path, {
    method,
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    credentials: "same-origin",
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Community settings are temporarily unavailable.");
  }
  if (!response.ok || !isSuccessPayload(payload)) {
    const message = payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
      ? payload.message
      : "Community settings are temporarily unavailable.";
    throw new Error(message);
  }
  return payload;
}

function isSuccessPayload(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && "ok" in value && value.ok === true);
}

function toMessage(error: unknown) {
  return error instanceof Error ? error.message : "Community settings are temporarily unavailable.";
}
