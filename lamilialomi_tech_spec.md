# LamiliaLomi - Specyfikacja Techniczna (Uzgodniona) ver. 1.1

Status: aktualna po audycie pełnego czatu PM z `Pelny_Zapis_Projektu_LamiliaLomi.md`.

## Stack technologiczny

- **Frontend + Backend:** Next.js (App Router)
- **Hosting:** Vercel
- **Baza danych + Auth + Storage:** Supabase
- **Email:** Resend
- **Analityka:** Google Analytics 4 + custom events
- **i18n:** next-intl

---

## Role użytkowników

### Gość

- Przegląda produkty, kategorie i wyszukuje.
- Ogląda wideo flipthrough dostępne dla wszystkich.
- Ma dostęp do pełnej publicznej galerii produktu.
- Klika w link afiliacyjny na Amazon.
- Nie może pobierać materiałów premium.

### Zweryfikowany klient / konto klienta

- Konto jest tworzone w kontekście odblokowania produktu kodem lub QR, nie jako osobny poziom dla zwykłego przeglądania.
- Rejestracja: email + hasło.
- Wymagana akceptacja regulaminu i polityki prywatności.
- Zgoda marketingowa pozostaje osobnym checkboxem do decyzji prawnej/biznesowej przed wymuszeniem.
- Odblokowanie przez kod / QR z wnętrza produktu.
- Jeden kod per produkt, współdzielony przez wielu klientów.
- Kod drukowany jest docelowo stały; system nadal może mieć flagę awaryjnej dezaktywacji.
- Odblokowanie jest zapisywane na koncie użytkownika jako trwały dostęp do danego produktu.
- Klient ma dostęp do ekskluzywnych PDF-ów i bonusowych kolorowanek przypisanych do odblokowanego produktu.

### Administrator

- Jeden admin w pierwszej wersji; system może wspierać kolejnych adminów przez pole `role`.
- Panel pod `/admin` w tej samej aplikacji Next.js.
- Interfejs admina po polsku.
- Zarządza produktami, kategoriami, tagami, kodami, użytkownikami i plikami.
- Eksportuje listę maili.
- Konfiguruje opóźnienie przypomnień per produkt.

---

## Flow odblokowywania premium

1. Użytkownik skanuje QR z książki.
2. Trafia na stronę produktu.
3. Przy próbie odblokowania widzi prośbę o logowanie albo rejestrację w tym kontekście.
4. Po zalogowaniu wpisuje kod albo kod z QR jest prefillowany.
5. Dostęp premium zapisuje się na koncie.

---

## Katalog produktów

- Start: około 100 produktów, skalowalny.
- Paginacja i filtrowanie od pierwszego dnia.
- Produkt może należeć do wielu kategorii i mieć wiele tagów.
- Kategorie i tagi zarządzane dynamicznie przez admina, nie hardcoded.
- Trzy główne kategorie: książki, kolorowanki, audiobooki.
- Amazon Associates: linki afiliacyjne per produkt per rynek, np. `amazon.com`, `amazon.de`.

---

## Wyszukiwarka

- Zakres: tytuł + opis + tagi + kategorie.
- Silnik: PostgreSQL full-text search.

---

## Galeria i media

- **Galeria:** zdjęcia JPG/PNG/WebP, pokolorowane strony i przykłady z książek, widoczne publicznie dla wszystkich odwiedzających.
- **Wideo flipthrough:** hostowane na Supabase Storage, widoczne dla wszystkich, w tym gości.
- **PDF-y:** tylko jako materiały do pobrania, nie jako galeria.
- **Pliki do pobrania:** zakłódkowane i dostępne po odblokowaniu produktu kodem.
- **Wygoda mobilna:** zweryfikowany klient z odblokowanym produktem może wysłać link do pobrania/biblioteki na własny e-mail, bez ujawniania stałego publicznego URL-a do pliku.
- Dostęp do prywatnych plików przez podpisane URL-e z krótkim TTL.
- Bez limitu liczby pobrań per użytkownik.
- Premium content przypisany per produkt.

---

## System przypomnień o opinii

- Jedno przypomnienie per użytkownik per produkt.
- Opóźnienie konfigurowane przez admina per produkt, rekomendacja: 14 dni.
- Uwaga z audytu PM: pełny czat rekomendował 7 dni; obecny kanoniczny default 14 dni wymaga potwierdzenia z właścicielką przed produkcją, jeśli ma zostać zmieniony.
- Wysyłka przez Resend.
- Komunikacja przyjazna i nienachalna.

---

## Wielojęzyczność (i18n)

- **Główny język:** angielski, dla klientów z USA.
- **Drugi język:** polski.
- **Trzeci język:** niemiecki.
- **Czwarty język:** hiszpański.
- Możliwość dodania kolejnych języków przez admina w przyszłości.
- Cały interfejs wielojęzyczny, nie tylko treści produktów.
- Treści produktów tłumaczone ręcznie przez admina per język.
- Auto-detect języka na podstawie przeglądarki.
- Ręczny selektor języka w headerze.
- Preferowany język zapisywany w ciasteczku.
- Interfejs admina po polsku.

---

## SEO

- Meta tagi, Open Graph i structured data od pierwszego dnia.
- SSR przez Next.js App Router.

---

## Zbieranie maili i RODO

- Konto wymaga akceptacji regulaminu i polityki prywatności.
- Pole `marketing_consent` w tabeli użytkowników.
- Zgoda marketingowa nie jest zaznaczona domyślnie.
- Wymuszenie zgody marketingowej jako warunku konta wymaga osobnej decyzji prawnej/biznesowej.
- Tylko admin widzi i eksportuje listę maili.
- Strony `/privacy` i `/terms` zarządzane przez admina; treść przygotowuje właściciel.

---

## Kierunek wizualny

- Spokojny, kobiecy, premium, kreatywny.
- Pastelowe kolory, zaokrąglony UI, duże odstępy, delikatne cienie.
- Elegancka typografia.
- Mobile-first, w pełni responsywny.
- Brak agresywnych blokad i nachalnych popupów.
 
---

## Aktualizacja implementacyjna: CRUD admina (2026-05-31)

- Panel admina ma teraz operacyjny CRUD produktow w lokalnym trybie demo/content-store.
- Produkt mozna utworzyc, edytowac, archiwizowac i usunac.
- Edycja produktu obejmuje tlumaczenia EN/PL/DE/ES, SEO, kategorie, tagi, linki Amazon, kody premium oraz assety.
- Zasada widocznosci assetow jest jawna:
  - `cover`, `gallery`, `video`, `public_download` sa publiczne dla gosci.
  - `premium_download` jest prywatny i przeznaczony dla odblokowanego produktu.
- Kategorie i tagi maja create/update/delete oraz tlumaczenia.
- Privacy/Terms sa edytowalne per locale.
- Lokalny content store zapisuje zmiany w `data/lamilialomi-content.local.json`; plik jest ignorowany przez git.
- Lokalny Supabase config definiuje buckety: `public-media`, `public-videos`, `premium-files`.
- Produkcyjna aktywacja Supabase wymaga zastosowania migracji na docelowym projekcie i przepiecia content-store na Supabase Auth/Database/Storage.
