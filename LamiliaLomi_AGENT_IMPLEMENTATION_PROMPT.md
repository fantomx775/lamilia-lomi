# Prompt dla agenta implementującego LamiliaLomi

Jesteś agentem implementacyjnym odpowiedzialnym za zbudowanie pełnego produktu LamiliaLomi. Pracujesz w repozytorium projektu i masz działać konsekwentnie według dokumentacji znajdującej się w tym folderze.

## Dokumenty obowiązkowe

Najpierw przeczytaj w całości:

1. `LamiliaLomi_SOURCE_OF_TRUTH.md`
2. `LamiliaLomi_IMPLEMENTATION_PLAN.md`

Te dwa dokumenty są nadrzędne. Jeśli starsze dokumenty w repozytorium mówią coś innego, traktuj je tylko jako kontekst historyczny.

## Cel

Zaimplementuj pełny produkt LamiliaLomi zgodnie z `LamiliaLomi_SOURCE_OF_TRUTH.md`, realizując pracę według vertical slices z `LamiliaLomi_IMPLEMENTATION_PLAN.md`.

Produkt ma umożliwiać:

- publiczne przeglądanie katalogu produktów,
- wejście ze świata Kids/Adults,
- stronę produktu z galerią, wideo, linkami Amazon i CTA premium,
- rejestrację/logowanie/weryfikację e-mail/reset hasła,
- odblokowanie premium contentu kodem lub QR,
- bezpieczne pobieranie premium plików przez signed URLs,
- bibliotekę użytkownika,
- panel admina po polsku,
- zarządzanie produktami, tłumaczeniami, kategoriami, tagami, mediami, kodami, użytkownikami i eksportem maili,
- Privacy/Terms, cookie consent, contact form,
- Resend emails,
- GA4 po zgodzie analytics,
- SEO, sitemap, robots i metadata.

## Tryb pracy

Pracuj slice po slice, dokładnie według `LamiliaLomi_IMPLEMENTATION_PLAN.md`.

Nie buduj całych warstw poziomo. Każda iteracja ma dostarczać działający pionowy fragment produktu:

- UI,
- logika aplikacji,
- baza/storage/auth, jeśli dotyczy,
- testy,
- E2E/manual verification,
- dowód działania.

Slice jest zamknięty dopiero wtedy, gdy:

1. unit tests przechodzą,
2. integration tests przechodzą, jeśli slice dotyka bazy/auth/storage,
3. E2E lub manual browser verification potwierdza zachowanie,
4. masz dowód: screenshot, wynik testów, database check, storage check lub podobny artefakt,
5. aplikacja nadal się uruchamia.

## TDD

Implementuj TDD.

Dla każdego slice'a:

1. Zdefiniuj publiczne zachowanie.
2. Napisz jeden failing unit/behavior test.
3. Dopisz minimalną implementację.
4. Doprowadź test do green.
5. Powtarzaj dla kolejnego zachowania.
6. Refactor rób tylko na green.
7. Na końcu dodaj integracyjne/E2E testy dla całego slice'a.

Testy mają sprawdzać zachowanie przez publiczne interfejsy, nie prywatną implementację.

Preferuj testy typu:

- `validatePremiumCode(...)`,
- `getLocalizedProductView(...)`,
- `canDownloadPremiumAsset(...)`,
- `scheduleReviewReminder(...)`,
- server actions,
- route handlers,
- publiczne service functions,
- widoczne zachowania UI.

Unikaj testów przyklejonych do prywatnych helperów i szczegółów implementacyjnych.

## Dokumentacja i aktualność bibliotek

Używaj aktualnych wersji bibliotek i frameworków. Przed większą decyzją techniczną czytaj aktualną dokumentację 3rd party.

Szczególnie sprawdzaj dokumentację dla:

- Next.js App Router,
- React,
- TypeScript,
- Tailwind CSS,
- shadcn/ui,
- Supabase Auth,
- Supabase Database,
- Supabase Storage,
- Supabase RLS,
- `@supabase/ssr`,
- Vercel,
- Vercel CLI,
- Vercel Cron,
- Resend,
- React Email, jeśli użyjesz,
- next-intl,
- Playwright,
- Vitest,
- Testing Library,
- GA4 / gtag consent behavior.

Jeśli dokumentacja zmieniła rekomendowany sposób integracji, zastosuj aktualną praktykę, ale nie zmieniaj decyzji produktowych bez aktualizacji source of truth.

## Stack rekomendowany

Użyj:

- Next.js App Router,
- TypeScript,
- Tailwind CSS,
- shadcn/ui,
- Supabase,
- Resend,
- next-intl,
- Vitest,
- React Testing Library,
- Playwright,
- Vercel.

Jeśli wybierasz dodatkową bibliotekę, uzasadnij ją w notatce implementacyjnej i upewnij się, że nie komplikuje produktu.

## Vercel

Do tworzenia, linkowania, konfigurowania i wdrażania projektu Vercel używaj Vercel CLI.

Nie zakładaj projektu ręcznie przez dashboard, jeśli można to zrobić przez CLI.

W szczególności:

- używaj `vercel login`, jeśli potrzebne,
- używaj `vercel link`,
- używaj `vercel env`,
- używaj `vercel deploy`,
- używaj `vercel --prod` dla deploymentu produkcyjnego dopiero gdy produkt jest gotowy,
- konfiguruj cron przez repozytorium, np. `vercel.json`, jeśli pasuje do aktualnych zaleceń Vercel.

Przed komendami wdrożeniowymi upewnij się, że lokalne testy przechodzą.

## Supabase

Do wszystkich akcji związanych z bazą danych, auth, storage, RLS, migracjami, seedami i konfiguracją Supabase używaj narzędzia/projektu:

`lamilia-lomi-supabase`

To obejmuje:

- setup bazy,
- listowanie tabel,
- tworzenie migracji,
- uruchamianie migracji,
- zmiany schema,
- RLS policies,
- seed data,
- storage buckets,
- database checks,
- testowe odczyty/zapisy,
- weryfikację rekordów po E2E,
- debugowanie problemów bazodanowych.

Nie wykonuj ręcznych zmian w bazie poza `lamilia-lomi-supabase`, chyba że użytkownik wyraźnie to zaakceptuje.

Przed zmianami schematu:

1. sprawdź aktualny stan bazy,
2. przygotuj migrację,
3. zastosuj migrację,
4. zweryfikuj wynik,
5. zaktualizuj typy/klienty, jeśli potrzebne.

RLS traktuj jako część implementacji, nie jako dodatek na końcu.

## Kolejność pracy

Realizuj slice'y w tej kolejności:

1. Slice 0 - Project bootstrap and quality gates.
2. Slice 1 - Database foundation with seed product.
3. Slice 2 - Public home page and brand segmentation.
4. Slice 3 - Public catalog with filtering, sorting, and search.
5. Slice 4 - Product detail page with SEO and Amazon link tracking.
6. Slice 5 - Auth: register, login, logout, reset password.
7. Slice 6 - Email verification gate.
8. Slice 7 - Manual premium code unlock.
9. Slice 8 - QR code unlock flow through auth.
10. Slice 9 - Premium downloads with signed URLs.
11. Slice 10 - My Library.
12. Slice 11 - Admin access guard and dashboard shell.
13. Slice 12 - Admin product CRUD, translations, and publish flow.
14. Slice 13 - Admin taxonomy and Amazon links.
15. Slice 14 - Admin media and premium file upload.
16. Slice 15 - Admin users and email export.
17. Slice 16 - Static pages, contact form, and legal consent.
18. Slice 17 - Review reminder system.
19. Slice 18 - Analytics and business events.
20. Slice 19 - SEO, sitemap, robots, and production metadata.
21. Slice 20 - Responsive UI polish and production readiness.

Nie przechodź do kolejnego slice'a, jeśli bieżący nie ma potwierdzonego działania, chyba że zapiszesz wyraźny blocker i powód.

## Raportowanie postępu

Po każdym slice zapisz krótką notatkę statusową, najlepiej w osobnym pliku typu `LamiliaLomi_IMPLEMENTATION_PROGRESS.md`.

Format:

```md
## Slice X - Name

Status: done / blocked

Built:
- ...

Automated tests:
- Unit: pass/fail, command
- Integration: pass/fail, command
- E2E: pass/fail, command

Manual evidence:
- Screenshot: path
- Database check: table/row verified
- Storage check: bucket/path verified

Notes:
- ...
```

## Zasady jakości

- Nie dodawaj funkcji spoza source of truth bez potrzeby.
- Nie refaktoruj szeroko bez powodu.
- Nie twórz abstrakcji przed realnym drugim/trzecim użyciem.
- Nie pomijaj negatywnych testów dla auth, RLS i premium downloads.
- Nie zostawiaj premium plików publicznie dostępnych.
- Nie ładuj GA4 przed zgodą analytics.
- Nie zakładaj, że marketing consent jest obowiązkowy.
- Nie kończ slice'a bez E2E/manual verification.
- Nie kończ pracy, jeśli dev server/testy są w trakcie.

## Weryfikacja UI

Po każdej większej zmianie frontendowej uruchom aplikację lokalnie i sprawdź ją w przeglądarce.

Weryfikuj:

- desktop,
- mobile,
- brak nachodzenia tekstów,
- widoczność CTA,
- poprawne stany loading/empty/error,
- dostępność formularzy,
- czy użytkownik rozumie następny krok.

Dla kluczowych slice'ów zapisuj screenshoty.

## Minimalne wymagane testy bezpieczeństwa

Muszą istnieć testy lub sprawdzenia dla:

- guest nie może pobrać premium pliku,
- zalogowany bez unlocka nie może pobrać premium pliku,
- unverified user nie może pobrać premium pliku,
- user nie widzi unlocków innego usera,
- regular user nie może wejść do admina,
- draft product nie jest publiczny,
- invalid premium code nie tworzy unlocka,
- signed URL powstaje dopiero po access checku.

## Env i sekrety

Przygotuj `.env.example`, ale nie commituj prawdziwych sekretów.

Oczekiwane env vars:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `NEXT_PUBLIC_GA4_ID`
- `NEXT_PUBLIC_APP_URL`
- `CRON_SECRET`
- `ADMIN_SEED_EMAIL`
- `AMAZON_TRACKING_ID_US`
- `AMAZON_TRACKING_ID_DE`

Jeśli aktualna dokumentacja bibliotek wymaga innych nazw, możesz je dostosować, ale zaktualizuj dokumentację projektu.

## Finalny rezultat

Na końcu implementacji produkt ma być możliwy do przejścia end-to-end:

1. Guest otwiera stronę.
2. Guest przegląda katalog.
3. Guest otwiera produkt.
4. Guest skanuje/otwiera QR URL z kodem.
5. User rejestruje się lub loguje.
6. User weryfikuje e-mail.
7. User odblokowuje produkt.
8. User pobiera premium PDF.
9. User widzi produkt w My Library.
10. Admin tworzy/publikuje produkt.
11. Admin uploaduje media i premium file.
12. Admin eksportuje listę maili.
13. System wysyła albo symuluje wymagane e-maile.
14. GA4 działa tylko po zgodzie analytics.
15. SEO i sitemap są dostępne.

Jeśli jakiś element nie może zostać zrealizowany przez brak zewnętrznych dostępów, zaimplementuj go za flagą/placeholderem, udokumentuj blocker i zostaw jasne instrukcje aktywacji.
