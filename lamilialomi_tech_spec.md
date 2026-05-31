# LamiliaLomi — Specyfikacja Techniczna (Uzgodniona)

## Stack Technologiczny
- **Frontend + Backend:** Next.js (App Router)
- **Hosting:** Vercel
- **Baza danych + Auth + Storage:** Supabase
- **Email:** Resend
- **Analityka:** Google Analytics 4 + custom events
- **i18n:** next-intl

---

## Role Użytkowników

### Gość
- Przegląda produkty, kategorie, wyszukuje
- Ogląda wideo flipthrough (dostępne dla wszystkich)
- Klika w link afiliacyjny na Amazon
- Nie może pobierać materiałów ani uzyskać dostępu do galerii

### Zalogowany Użytkownik
- Rejestracja: email + hasło
- Obowiązkowy checkbox zgody marketingowej (RODO)
- Pełna standardowa galeria
- Podstawowe materiały do pobrania

### Użytkownik Premium
- Odblokowanie przez kod / QR z wnętrza produktu
- Jeden kod per produkt, współdzielony (wiele osób może użyć tego samego kodu)
- Kod drukowany = niezmienny, brak mechanizmu unieważniania
- Odblokowanie zapisywane na koncie użytkownika (trwały dostęp)
- Dostęp do ekskluzywnych PDF-ów i bonusowych kolorowanek

### Administrator
- Jeden admin, bez podziału na role
- Panel pod `/admin` w tej samej aplikacji Next.js
- Zarządza produktami, kategoriami, tagami, kodami, użytkownikami
- Eksport listy maili
- Konfiguracja opóźnienia przypomnień per produkt

---

## Flow Odblokowywania Premium
1. Użytkownik skanuje QR z książki
2. Trafia na stronę produktu
3. Przy próbie odblokowania — prośba o rejestrację/logowanie
4. Po zalogowaniu — wpisuje kod lub kod z QR jest prefillowany
5. Dostęp premium zapisany na koncie

---

## Katalog Produktów
- Start: ~100 produktów, skalowalny
- Paginacja i filtrowanie od pierwszego dnia
- Produkt może należeć do wielu kategorii i mieć wiele tagów
- Kategorie i tagi zarządzane dynamicznie przez admina (nie hardcoded)
- Trzy główne kategorie: Książki, Kolorowanki, Audiobooki
- Amazon Associates: linki afiliacyjne per produkt per rynek (amazon.com, amazon.de)

---

## Wyszukiwarka
- Zakres: tytuł + tagi + kategorie
- Silnik: PostgreSQL full-text search

---

## Galeria i Media
- **Galeria:** zdjęcia JPG/PNG/WebP (pokolorowane strony, przykłady z książek)
- **Wideo flipthrough:** hostowane na Supabase Storage, widoczne dla wszystkich (w tym gości)
- **PDF-y:** tylko jako materiały do pobrania (nie w galerii)
- Dostęp do plików przez podpisane URL-e z krótkim TTL (Supabase Storage)
- Bez limitu liczby pobrań per użytkownik
- Premium content przypisany per produkt

---

## System Przypomnień o Opinii
- Jedno przypomnienie per użytkownik per produkt
- Opóźnienie konfigurowane przez admina per produkt (rekomendacja: 14 dni)
- Wysyłka przez Resend
- Komunikacja przyjazna i nienachalna

---

## Wielojęzyczność (i18n)
- **Główny język:** angielski (klienci z USA)
- **Drugi język:** polski
- Możliwość dodania kolejnych języków przez admina (np. niemiecki)
- Cały interfejs wielojęzyczny (nie tylko treści produktów)
- Treści produktów tłumaczone ręcznie przez admina per język
- Auto-detect języka na podstawie przeglądarki
- Ręczny selektor języka w headerze
- Preferowany język zapisywany w ciasteczku

---

## SEO
- Meta tagi, Open Graph, structured data od pierwszego dnia
- SSR przez Next.js App Router

---

## Zbieranie Maili i RODO
- Checkbox zgody marketingowej obowiązkowy przy rejestracji (nie zaznaczony domyślnie)
- Pole `marketing_consent` w tabeli użytkowników
- Tylko admin widzi i eksportuje listę maili
- Strony `/privacy` i `/terms` zarządzane przez admina (treść przygotowuje właściciel)

---

## Kierunek Wizualny
- Spokojny, kobiecy, premium, kreatywny
- Pastelowe kolory, zaokrąglony UI, duże odstępy, delikatne cienie
- Elegancka typografia
- Mobile-first, w pełni responsywny
- Brak agresywnych blokad i nachalnych popupów
