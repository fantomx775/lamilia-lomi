"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Script from "next/script";
import { consentKey, ga4Id, readConsent, startAnalytics, stopAnalytics, trackEvent, trackPage, writeConsent } from "@/lib/analytics-client";
import type { CookieConsent } from "@/lib/analytics";
import { Button } from "./ui/button";

const copy = {
  en: ["We use essential cookies to run the site. With your permission, Google Analytics measures visits, Amazon clicks, form submissions and video playback. You can change your choice at any time.", "Essential only", "Allow analytics", "Cookie settings"],
  pl: ["Używamy niezbędnych cookies do działania strony. Za Twoją zgodą Google Analytics mierzy wizyty, kliknięcia Amazon, wysyłanie formularzy i odtwarzanie filmów. Wybór możesz zmienić w każdej chwili.", "Tylko niezbędne", "Zezwól na analitykę", "Ustawienia cookies"],
  de: ["Wir verwenden notwendige Cookies. Mit Ihrer Zustimmung misst Google Analytics Besuche, Amazon-Klicks, Formularübermittlungen und Videos. Sie können Ihre Wahl jederzeit ändern.", "Nur notwendige", "Analyse erlauben", "Cookie-Einstellungen"],
  es: ["Usamos cookies necesarias. Con tu permiso, Google Analytics mide visitas, clics en Amazon, envíos de formularios y vídeos. Puedes cambiar tu elección cuando quieras.", "Solo necesarias", "Permitir analítica", "Configurar cookies"],
};

export function CookieConsentBanner() {
  const pathname = usePathname();
  const text = copy[pathname.split("/")[1] as keyof typeof copy] ?? copy.en;
  const [consent, setConsent] = useState<CookieConsent | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => { setConsent(readConsent()); setLoaded(true); }, 0);
    const sync = (event: StorageEvent) => {
      if (event.key === consentKey || event.key === null) {
        if (readConsent()?.analytics !== true) { stopAnalytics(); location.reload(); }
        else setConsent(readConsent());
      }
    };
    const focus = () => {
      if (readConsent()?.analytics !== true) { stopAnalytics(); setConsent(readConsent()); }
    };
    window.addEventListener("storage", sync);
    window.addEventListener("focus", focus);
    return () => { clearTimeout(timer); window.removeEventListener("storage", sync); window.removeEventListener("focus", focus); };
  }, []);

  useEffect(() => {
    if (!consent?.analytics) return;
    startAnalytics();
    trackPage(pathname);
    const submit = (event: Event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !form.dataset.analyticsForm) return;
      trackEvent("form_submit", { form_name: form.dataset.analyticsForm });
    };
    const play = (event: Event) => {
      const video = event.target;
      if (!(video instanceof HTMLVideoElement) || !video.hasAttribute("data-flipthrough")) return;
      trackEvent(event.type === "ended" ? "video_complete" : "video_play", { video_type: "flipthrough", page_path: pathname });
    };
    document.addEventListener("submit", submit, true);
    document.addEventListener("play", play, true);
    document.addEventListener("ended", play, true);
    return () => {
      document.removeEventListener("submit", submit, true);
      document.removeEventListener("play", play, true);
      document.removeEventListener("ended", play, true);
    };
  }, [consent, pathname]);

  function save(analytics: boolean) {
    const persisted = writeConsent(analytics);
    if (!analytics) stopAnalytics();
    setConsent(readConsent() ?? { essential: true, analytics: false });
    setEditing(false);
    // Unload Google automatic listeners after consent withdrawal.
    if (!analytics && consent?.analytics && persisted) location.reload();
  }

  return <>
    {consent?.analytics ? <Script id="ga4-library" src={`https://www.googletagmanager.com/gtag/js?id=${ga4Id}`} /> : null}
    {loaded && (editing || !consent) ? <section aria-label={text[3]} className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-2xl rounded-lg border border-[var(--color-border)] bg-white p-4 shadow-lg">
      <p className="text-sm leading-6">{text[0]}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => save(false)}>{text[1]}</Button>
        <Button type="button" variant="outline" onClick={() => save(true)}>{text[2]}</Button>
      </div>
    </section> : null}
    {loaded && consent && !editing ? <div className="px-4 py-2 text-center"><button type="button" className="text-sm underline" onClick={() => setEditing(true)}>{text[3]}</button></div> : null}
  </>;
}
