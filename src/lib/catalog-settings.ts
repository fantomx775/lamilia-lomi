import type { CatalogDesktopColumns, CatalogSettings } from "./types";

export const CATALOG_DESKTOP_COLUMN_OPTIONS: readonly CatalogDesktopColumns[] = [
  3,
  4,
  5,
];

export const DEFAULT_CATALOG_SETTINGS: CatalogSettings = {
  desktopColumns: 4,
};

export function parseCatalogDesktopColumns(
  value: unknown,
): CatalogDesktopColumns | null {
  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!/^(3|4|5)$/.test(trimmed)) {
      return null;
    }

    return Number(trimmed) as CatalogDesktopColumns;
  }

  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    CATALOG_DESKTOP_COLUMN_OPTIONS.includes(value as CatalogDesktopColumns)
  ) {
    return value as CatalogDesktopColumns;
  }

  return null;
}

export function normalizeCatalogSettings(value: unknown): CatalogSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ...DEFAULT_CATALOG_SETTINGS };
  }

  const desktopColumns = parseCatalogDesktopColumns(
    (value as { desktopColumns?: unknown }).desktopColumns,
  );

  return {
    desktopColumns: desktopColumns ?? DEFAULT_CATALOG_SETTINGS.desktopColumns,
  };
}
