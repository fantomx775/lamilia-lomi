"use client";

import { useEffect, useState } from "react";
import Script from "next/script";

import { shouldLoadGa4, type CookieConsent } from "@/lib/analytics";

import { Button } from "./ui/button";

const consentKey = "ll_cookie_consent";

export function CookieConsentBanner({ ga4Id }: { ga4Id?: string }) {
  const [consent, setConsent] = useState<CookieConsent | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = window.localStorage.getItem(consentKey);
      setConsent(stored ? JSON.parse(stored) : null);
      setLoaded(true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  function save(nextConsent: CookieConsent) {
    window.localStorage.setItem(consentKey, JSON.stringify(nextConsent));
    setConsent(nextConsent);
  }

  const showGa4 = shouldLoadGa4(consent, ga4Id);

  return (
    <>
      {showGa4 ? (
        <>
          <Script async src={`https://www.googletagmanager.com/gtag/js?id=${ga4Id}`} />
          <Script id="ga4-consented">
            {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${ga4Id}', { anonymize_ip: true });`}
          </Script>
        </>
      ) : null}
      {loaded && !consent ? (
        <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-2xl rounded-lg border border-[var(--color-border)] bg-white p-4 shadow-[0_18px_60px_rgba(62,52,47,0.18)]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-6 text-[var(--color-muted)]">
              We use essential cookies for the app. Analytics loads only if you
              allow it.
            </p>
            <div className="flex shrink-0 gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => save({ essential: true, analytics: false })}
              >
                Essential
              </Button>
              <Button
                type="button"
                onClick={() => save({ essential: true, analytics: true })}
              >
                Allow analytics
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
