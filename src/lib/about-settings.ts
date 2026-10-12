import { sanitizeRichTextValue } from "./rich-text";
import type { AboutPageSettings } from "./types";

export const DEFAULT_ABOUT_PAGE_SETTINGS: AboutPageSettings = {
  intro: "",
  favoriteColoringBookIds: ["", "", ""],
  favoritePictureBookIds: ["", "", ""],
};

export function normalizeAboutPageSettings(value: unknown): AboutPageSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return structuredClone(DEFAULT_ABOUT_PAGE_SETTINGS);
  }

  const settings = value as Partial<AboutPageSettings>;

  return {
    intro: typeof settings.intro === "string"
      ? sanitizeRichTextValue(settings.intro)
      : DEFAULT_ABOUT_PAGE_SETTINGS.intro,
    favoriteColoringBookIds: normalizeProductIds(settings.favoriteColoringBookIds),
    favoritePictureBookIds: normalizeProductIds(settings.favoritePictureBookIds),
  };
}

export function parseAboutPageSettingsFormData(
  formData: FormData,
): AboutPageSettings | null {
  const intro = formData.get("aboutIntro");
  const coloringIds = formData.getAll("favoriteColoringBookIds");
  const pictureIds = formData.getAll("favoritePictureBookIds");

  if (
    typeof intro !== "string" ||
    coloringIds.length !== 3 ||
    pictureIds.length !== 3 ||
    [...coloringIds, ...pictureIds].some((id) => typeof id !== "string")
  ) {
    return null;
  }

  return normalizeAboutPageSettings({
    intro,
    favoriteColoringBookIds: coloringIds,
    favoritePictureBookIds: pictureIds,
  });
}

export function hasDuplicateAboutProductIds(settings: AboutPageSettings) {
  const selectedIds = [
    ...settings.favoriteColoringBookIds,
    ...settings.favoritePictureBookIds,
  ].filter(Boolean).map(normalizeProductIdForDuplicateCheck);

  return new Set(selectedIds).size !== selectedIds.length;
}

function normalizeProductIdForDuplicateCheck(id: string) {
  const uuidInput = id.startsWith("{") && id.endsWith("}")
    ? id.slice(1, -1)
    : id;
  const compactUuid = uuidInput.replace(/-/g, "");

  return /^[0-9a-f]{32}$/i.test(compactUuid)
    ? `${compactUuid.slice(0, 8)}-${compactUuid.slice(8, 12)}-${compactUuid.slice(12, 16)}-${compactUuid.slice(16, 20)}-${compactUuid.slice(20)}`.toLowerCase()
    : id;
}

function normalizeProductIds(value: unknown): AboutPageSettings["favoriteColoringBookIds"] {
  const ids = Array.isArray(value)
    ? value.slice(0, 3).map((id) => typeof id === "string" ? id.trim() : "")
    : [];

  while (ids.length < 3) ids.push("");
  return ids as AboutPageSettings["favoriteColoringBookIds"];
}
