import { describe, expect, it } from "vitest";

import {
  CATALOG_DESKTOP_COLUMN_OPTIONS,
  DEFAULT_CATALOG_SETTINGS,
  normalizeCatalogSettings,
  parseCatalogDesktopColumns,
} from "./catalog-settings";

describe("catalog settings", () => {
  it.each(CATALOG_DESKTOP_COLUMN_OPTIONS)(
    "accepts %i desktop columns from form data and storage",
    (columns) => {
      expect(parseCatalogDesktopColumns(String(columns))).toBe(columns);
      expect(parseCatalogDesktopColumns(columns)).toBe(columns);
      expect(normalizeCatalogSettings({ desktopColumns: columns })).toEqual({
        desktopColumns: columns,
      });
    },
  );

  it.each([undefined, null, 0, 2, 6, 4.5, "3.0", "6", {}, []])(
    "falls back to the default for invalid stored value %j",
    (columns) => {
      expect(normalizeCatalogSettings({ desktopColumns: columns })).toEqual(
        DEFAULT_CATALOG_SETTINGS,
      );
    },
  );

  it("falls back when the settings object is missing or malformed", () => {
    expect(normalizeCatalogSettings(undefined)).toEqual(DEFAULT_CATALOG_SETTINGS);
    expect(normalizeCatalogSettings(null)).toEqual(DEFAULT_CATALOG_SETTINGS);
    expect(normalizeCatalogSettings("5")).toEqual(DEFAULT_CATALOG_SETTINGS);
  });

  it("rejects unsupported values submitted from the admin form", () => {
    expect(parseCatalogDesktopColumns("2")).toBeNull();
    expect(parseCatalogDesktopColumns("5.0")).toBeNull();
    expect(parseCatalogDesktopColumns("")).toBeNull();
  });
});
