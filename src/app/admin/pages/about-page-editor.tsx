"use client";

import { ChevronDown, ChevronUp, Save, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useFormStatus } from "react-dom";

import { AdminEditorHeader, AdminEditorSection } from "@/components/admin/admin-editor-foundation";
import { RichTextEditor } from "@/components/admin/rich-text-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AboutPageSettings } from "@/lib/types";

type AboutProductOption = {
  id: string;
  title: string;
  subtitle?: string;
  productType: string;
  status: string;
  coverUrl?: string;
  amazonUrl?: string;
};

type SlotGroup = "favoriteColoringBookIds" | "favoritePictureBookIds";
type ProductIdSlots = AboutPageSettings[SlotGroup];
type AboutEditorState = AboutPageSettings;
type AboutNavigateEvent = Event & { destination?: { url?: string } };
type AboutNavigation = {
  addEventListener(type: "navigate", listener: (event: AboutNavigateEvent) => void): void;
  removeEventListener(type: "navigate", listener: (event: AboutNavigateEvent) => void): void;
};
type AboutEditorWindow = Window & { navigation?: AboutNavigation };

const GROUPS: Array<{
  key: SlotGroup;
  title: string;
  productType: "coloring-book" | "picture-book";
  shortName: string;
}> = [
  {
    key: "favoriteColoringBookIds",
    title: "Favorite Coloring Books",
    productType: "coloring-book",
    shortName: "Coloring Books",
  },
  {
    key: "favoritePictureBookIds",
    title: "Favorite Picture Books",
    productType: "picture-book",
    shortName: "Picture Books",
  },
];

export function AboutPageEditor({
  config,
  products,
  feedback,
  saved = false,
  saveAction,
}: {
  config: AboutPageSettings;
  products: AboutProductOption[];
  feedback?: string;
  saved?: boolean;
  saveAction?: (formData: FormData) => void | Promise<void>;
}) {
  const savedValue = useMemo(() => normalizeConfig(config), [config]);
  const savedValueSignature = JSON.stringify(savedValue);
  const [baselineValue, setBaselineValue] = useState<AboutEditorState>(() => savedValue);
  const baselineSignatureRef = useRef(savedValueSignature);
  const isDirtyRef = useRef(false);
  const [value, setValue] = useState<AboutEditorState>(() => savedValue);
  const [hasUnappliedHtmlDraft, setHasUnappliedHtmlDraft] = useState(false);
  const [showDuplicateError, setShowDuplicateError] = useState(false);
  const selectedIdCounts = useMemo(() => countSelectedIds(value), [value]);
  const duplicateIds = Array.from(selectedIdCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
  const isDirty = hasUnappliedHtmlDraft || JSON.stringify(value) !== JSON.stringify(baselineValue);

  useEffect(() => {
    if (!saved || savedValueSignature === baselineSignatureRef.current) return;
    baselineSignatureRef.current = savedValueSignature;
    setBaselineValue(savedValue);
    setValue(savedValue);
    setHasUnappliedHtmlDraft(false);
    isDirtyRef.current = false;
  }, [saved, savedValue, savedValueSignature]);

  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  useEffect(() => {
    const owner = window.location.href;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };

    const confirmNavigation = () => {
      if (!isDirtyRef.current) return true;
      const confirmed = window.confirm("Masz niezapisane zmiany. Opuścić edytor i je odrzucić?");
      if (confirmed) isDirtyRef.current = false;
      return confirmed;
    };

    const handleInternalClick = (event: globalThis.MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target || link.hasAttribute("download")) return;
      const destination = new URL(link.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.href === owner) return;
      if (confirmNavigation()) return;
      event.preventDefault();
      event.stopPropagation();
      if ("stopImmediatePropagation" in event) event.stopImmediatePropagation();
    };

    const navigation = (window as AboutEditorWindow).navigation;
    const handleNavigate = (event: AboutNavigateEvent) => {
      const destination = event.destination?.url;
      if (!destination || new URL(destination, window.location.href).href === owner) return;
      if (!confirmNavigation()) event.preventDefault();
    };
    const handlePopState = () => {
      if (!confirmNavigation()) window.history.forward();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleInternalClick, true);
    if (navigation) navigation.addEventListener("navigate", handleNavigate);
    else window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleInternalClick, true);
      if (navigation) navigation.removeEventListener("navigate", handleNavigate);
      else window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  const updateIntro = (intro: string) => {
    setValue((current) => ({ ...current, intro }));
    setShowDuplicateError(false);
  };

  const updateSlot = (group: SlotGroup, slotIndex: number, productId: string) => {
    setValue((current) => ({
      ...current,
      [group]: current[group].map((currentId, index) => index === slotIndex ? productId : currentId) as ProductIdSlots,
    }));
    setShowDuplicateError(false);
  };

  const moveSlot = (group: SlotGroup, slotIndex: number, direction: -1 | 1) => {
    setValue((current) => ({
      ...current,
      [group]: moveSelectedProduct(current[group], slotIndex, direction),
    }));
    setShowDuplicateError(false);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (duplicateIds.length === 0) {
      setShowDuplicateError(false);
      isDirtyRef.current = false;
      return;
    }

    event.preventDefault();
    setShowDuplicateError(true);
  };

  const updateHtmlDraftState = (hasDraft: boolean) => {
    setHasUnappliedHtmlDraft(hasDraft);
    isDirtyRef.current = hasDraft || JSON.stringify(value) !== JSON.stringify(baselineValue);
  };

  return (
    <form id="about-page-editor-form" action={saveAction} onSubmit={handleSubmit} className="grid gap-6">
      <AdminEditorHeader
        backHref="/admin/pages"
        backLabel="Strony"
        title="About Lamilia Lomi"
        subtitle="Ustawienia strony About"
        actions={<AboutSubmitButton />}
      />

      {feedback ? (
        <div role="status" className="rounded-md border border-[var(--color-border)] bg-white px-4 py-3 text-sm text-[var(--color-terracotta)]">
          {feedback}
        </div>
      ) : null}

      {showDuplicateError && duplicateIds.length > 0 ? (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          Ten sam produkt jest wybrany w kilku pozycjach. Zmień wybór przed zapisaniem.
        </div>
      ) : null}

      <AdminEditorSection title="About Lamilia Lomi">
        <div className="grid gap-2">
          <Label htmlFor="about-intro">Wprowadzenie</Label>
          <RichTextEditor
            id="about-intro"
            name="aboutIntro"
            label="Wprowadzenie"
            value={value.intro}
            onChange={updateIntro}
            onSourceDraftChange={updateHtmlDraftState}
          />
        </div>
      </AdminEditorSection>

      {GROUPS.map((group) => (
        <AdminEditorSection key={group.key} title={group.title}>
          <div className="grid gap-4">
            {value[group.key].map((productId, slotIndex) => {
              const product = products.find((candidate) => candidate.id === productId);
              const duplicate = Boolean(productId && (selectedIdCounts.get(productId) ?? 0) > 1);
              const availabilityMessage = productId
                ? getAvailabilityMessage(product, group.productType)
                : null;
              const unavailable = Boolean(availabilityMessage);
              const canMoveUp = canMoveSelectedProduct(value[group.key], slotIndex, -1);
              const canMoveDown = canMoveSelectedProduct(value[group.key], slotIndex, 1);

              return (
                <div key={`${group.key}-${slotIndex}`} className="grid min-w-0 gap-2 rounded-lg border border-[var(--color-border)] bg-white p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <div className="grid min-w-0 gap-2">
                    <Label htmlFor={`${group.key}-${slotIndex + 1}`}>Pozycja {slotIndex + 1}</Label>
                    <ProductCombobox
                      id={`${group.key}-${slotIndex + 1}`}
                      label={`${group.title}, pozycja ${slotIndex + 1}`}
                      selectedId={productId}
                      selectedTitle={product ? displayProductTitle(product) : productId ? "Produkt niedostępny" : ""}
                      products={products}
                      productType={group.productType}
                      excludedIds={getSelectedIdsExcept(value, group.key, slotIndex)}
                      unavailable={unavailable}
                      duplicate={duplicate}
                      onSelect={(nextProductId) => updateSlot(group.key, slotIndex, nextProductId)}
                    />
                    {availabilityMessage ? (
                      <p className="text-sm text-amber-800" role="status">{availabilityMessage}</p>
                    ) : null}
                    {duplicate ? (
                      <p className="text-sm text-red-800" role="status">Ten produkt jest już wybrany w innej pozycji.</p>
                    ) : null}
                    <input type="hidden" name={group.key} value={productId} />
                  </div>

                  <div className="flex items-center gap-2 sm:justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={`Przesuń produkt ${group.shortName}, pozycja ${slotIndex + 1}, wyżej`}
                      disabled={!canMoveUp}
                      onClick={() => moveSlot(group.key, slotIndex, -1)}
                    >
                      <ChevronUp className="size-4" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={`Przesuń produkt ${group.shortName}, pozycja ${slotIndex + 1}, niżej`}
                      disabled={!canMoveDown}
                      onClick={() => moveSlot(group.key, slotIndex, 1)}
                    >
                      <ChevronDown className="size-4" aria-hidden />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </AdminEditorSection>
      ))}

      {isDirty ? <p className="text-sm text-[var(--color-terracotta)]" role="status" aria-live="polite">Masz niezapisane zmiany.</p> : null}

      <div className="flex justify-end"><AboutSubmitButton /></div>
    </form>
  );
}

function ProductCombobox({
  id,
  label,
  selectedId,
  selectedTitle,
  products,
  productType,
  excludedIds,
  unavailable,
  duplicate,
  onSelect,
}: {
  id: string;
  label: string;
  selectedId: string;
  selectedTitle: string;
  products: AboutProductOption[];
  productType: string;
  excludedIds: Set<string>;
  unavailable: boolean;
  duplicate: boolean;
  onSelect: (productId: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = `${id}-options`;

  const options = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return products.filter((product) => {
      if (product.status !== "published" || product.productType !== productType) return false;
      if (excludedIds.has(product.id)) return false;
      if (!normalizedQuery) return true;
      return `${product.title} ${product.subtitle ?? ""}`.toLocaleLowerCase().includes(normalizedQuery);
    });
  }, [excludedIds, productType, products, query]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  const selectOption = (productId: string) => {
    onSelect(productId);
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setQuery("");
        setOpen(true);
      }
      setActiveIndex((current) => options.length ? (current < 0 ? 0 : (current + 1) % options.length) : -1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setQuery("");
        setOpen(true);
      }
      setActiveIndex((current) => options.length ? (current < 0 ? options.length - 1 : (current - 1 + options.length) % options.length) : -1);
      return;
    }

    if (event.key === "Home" && open && options.length) {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }

    if (event.key === "End" && open && options.length) {
      event.preventDefault();
      setActiveIndex(options.length - 1);
      return;
    }

    if (event.key === "Enter" && open) {
      event.preventDefault();
      const activeProduct = options[activeIndex];
      if (activeProduct) selectOption(activeProduct.id);
      return;
    }

    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      setQuery("");
      setActiveIndex(-1);
    }
  };

  return (
    <div
      ref={rootRef}
      className="relative min-w-0"
      onBlur={() => {
        setOpen(false);
        setActiveIndex(-1);
      }}
    >
      <Input
        id={id}
        type="text"
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && options[activeIndex] ? `${listboxId}-option-${activeIndex}` : undefined}
        aria-invalid={duplicate || unavailable}
        autoComplete="off"
        placeholder="Szukaj produktu po nazwie"
        value={open ? query : selectedTitle}
        onFocus={() => {
          setQuery("");
          setActiveIndex(-1);
          setOpen(true);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(-1);
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
      />

      {selectedId ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1 min-h-8 h-8 px-2 text-xs"
          aria-label={`Wyczyść wybór: ${label}`}
          onClick={() => selectOption("")}
        >
          <X className="size-3.5" aria-hidden />
          Wyczyść wybór
        </Button>
      ) : null}

      {open ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label={`Wyniki wyszukiwania: ${label}`}
          className="absolute z-[80] mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-[var(--color-border)] bg-white p-1 shadow-lg"
        >
          {options.length ? options.map((product, optionIndex) => (
            <div
              key={product.id}
              id={`${listboxId}-option-${optionIndex}`}
              role="option"
              aria-selected={product.id === selectedId}
              className={`cursor-pointer rounded px-3 py-2 text-sm outline-none ${optionIndex === activeIndex ? "bg-[var(--color-bg)]" : "hover:bg-[var(--color-bg)]"}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => setActiveIndex(optionIndex)}
              onClick={() => selectOption(product.id)}
            >
              <span className="block font-medium text-[var(--color-ink)]">{displayProductTitle(product)}</span>
              {product.subtitle ? <span className="block truncate text-xs text-[var(--color-muted)]">{product.subtitle}</span> : null}
            </div>
          )) : (
            <p className="px-3 py-2 text-sm text-[var(--color-muted)]" role="status">Brak dostępnych produktów.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function AboutSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      <Save className="size-4" aria-hidden />
      {pending ? "Zapisywanie…" : "Zapisz"}
    </Button>
  );
}

function normalizeConfig(config: AboutPageSettings): AboutEditorState {
  return {
    intro: config.intro ?? "",
    favoriteColoringBookIds: normalizeSlots(config.favoriteColoringBookIds),
    favoritePictureBookIds: normalizeSlots(config.favoritePictureBookIds),
  };
}

function normalizeSlots(values: ProductIdSlots): ProductIdSlots {
  return [values[0] ?? "", values[1] ?? "", values[2] ?? ""];
}

function countSelectedIds(config: AboutEditorState) {
  const counts = new Map<string, number>();
  for (const id of [...config.favoriteColoringBookIds, ...config.favoritePictureBookIds]) {
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

function getSelectedIdsExcept(config: AboutEditorState, currentGroup: SlotGroup, currentIndex: number) {
  const selectedIds = new Set<string>();
  for (const group of GROUPS) {
    config[group.key].forEach((id, index) => {
      if (group.key !== currentGroup || index !== currentIndex) {
        if (id) selectedIds.add(id);
      }
    });
  }
  return selectedIds;
}

function getAvailabilityMessage(product: AboutProductOption | undefined, expectedType: string) {
  if (!product) return "Wybrany produkt nie jest już dostępny. Wybierz inny produkt lub wyczyść tę pozycję.";
  if (product.status !== "published") return "Wybrany produkt nie jest opublikowany i nie będzie widoczny na stronie About. Możesz go zastąpić.";
  if (product.productType !== expectedType) return "Wybrany produkt ma inny typ i nie będzie widoczny w tej sekcji. Możesz go zastąpić.";
  return null;
}

function displayProductTitle(product: AboutProductOption) {
  return product.title.trim() || "Produkt bez nazwy";
}

function moveSelectedProduct(values: ProductIdSlots, slotIndex: number, direction: -1 | 1): ProductIdSlots {
  if (!values[slotIndex]) return values;
  const neighborIndex = findNeighbor(values, slotIndex, direction);
  if (neighborIndex < 0) return values;
  const reordered = [...values] as ProductIdSlots;
  [reordered[slotIndex], reordered[neighborIndex]] = [reordered[neighborIndex], reordered[slotIndex]];
  return reordered;
}

function canMoveSelectedProduct(values: ProductIdSlots, slotIndex: number, direction: -1 | 1) {
  return Boolean(values[slotIndex]) && findNeighbor(values, slotIndex, direction) >= 0;
}

function findNeighbor(values: ProductIdSlots, slotIndex: number, direction: -1 | 1) {
  let index = slotIndex + direction;
  while (index >= 0 && index < values.length) {
    if (values[index]) return index;
    index += direction;
  }
  return -1;
}
