import type { Locale } from "@/i18n/routing";

export const ADMIN_ERROR_CODES = {
  INTERNAL: "admin.internal",
  AUTHORIZATION_DENIED: "admin.authorization.denied",
  NOT_FOUND_PRODUCT: "admin.not_found.product",
  NOT_FOUND_RESOURCE: "admin.not_found.resource",
  NOT_FOUND_ASSET_UPLOAD: "admin.not_found.asset_upload",
  VALIDATION_INVALID_INPUT: "admin.validation.invalid_input",
  VALIDATION_PRODUCT_TITLE_REQUIRED: "admin.validation.product_title_required",
  VALIDATION_PUBLISH_REQUIREMENTS: "admin.validation.publish_requirements",
  VALIDATION_SLUG_REQUIRED: "admin.validation.slug_required",
  VALIDATION_CATEGORY_NAME_REQUIRED: "admin.validation.category_name_required",
  VALIDATION_TAG_NAME_REQUIRED: "admin.validation.tag_name_required",
  VALIDATION_PAGE_SLUG: "admin.validation.page_slug",
  VALIDATION_MEDIA_UPLOAD_ACTIVE: "admin.validation.media_upload_active",
  VALIDATION_MEDIA_UPLOAD_STATE: "admin.validation.media_upload_state",
  VALIDATION_ASSET_UPLOAD_INCOMPLETE: "admin.validation.asset_upload_incomplete",
  VALIDATION_ASSET_PATH: "admin.validation.asset_path",
  VALIDATION_ASSET_FILE: "admin.validation.asset_file",
  VALIDATION_ASSET_VISIBILITY: "admin.validation.asset_visibility",
  VALIDATION_COVER_DUPLICATE: "admin.validation.cover_duplicate",
  VALIDATION_VIDEO_DUPLICATE: "admin.validation.video_duplicate",
  VALIDATION_GALLERY_LIMIT: "admin.validation.gallery_limit",
  VALIDATION_PREMIUM_CODE_REQUIRED: "admin.validation.premium_code_required",
  CONFLICT_PREMIUM_CODE_DUPLICATE: "admin.conflict.premium_code_duplicate",
  CONFLICT_PREMIUM_CODE_EXISTING: "admin.conflict.premium_code_existing",
  CONFLICT_AMAZON_MARKET_DUPLICATE: "admin.conflict.amazon_market_duplicate",
  CONFLICT_SLUG: "admin.conflict.slug",
  CONFLICT_DATA: "admin.conflict.data",
} as const;

export type AdminErrorCode = (typeof ADMIN_ERROR_CODES)[keyof typeof ADMIN_ERROR_CODES];

export type AdminMutationResult =
  | { ok: true; id: string }
  | { ok: false; errors: AdminErrorCode[] };

export type DatabaseErrorLike = {
  code?: string | null;
  constraint?: string | null;
  details?: string | null;
  hint?: string | null;
  message?: string | null;
  status?: number | null;
  statusCode?: number | string | null;
};

export class AdminApplicationError extends Error {
  readonly code: AdminErrorCode;

  constructor(code: AdminErrorCode) {
    super(code);
    this.name = "AdminApplicationError";
    this.code = code;
  }
}

export class AdminDatabaseError extends Error {
  readonly operation: string;
  readonly databaseError: DatabaseErrorLike;

  constructor(operation: string, databaseError: DatabaseErrorLike) {
    super(`Supabase ${operation} failed.`);
    this.name = "AdminDatabaseError";
    this.operation = operation;
    this.databaseError = databaseError;
  }
}

const translatedMessages = {
  en: {
    [ADMIN_ERROR_CODES.INTERNAL]: "We couldn't save the changes. Try again.",
    [ADMIN_ERROR_CODES.AUTHORIZATION_DENIED]: "Your administrator session is no longer valid. Sign in again.",
    [ADMIN_ERROR_CODES.NOT_FOUND_PRODUCT]: "The product was not found.",
    [ADMIN_ERROR_CODES.NOT_FOUND_RESOURCE]: "The requested item was not found.",
    [ADMIN_ERROR_CODES.NOT_FOUND_ASSET_UPLOAD]: "The uploaded file was not found. Upload it again.",
    [ADMIN_ERROR_CODES.VALIDATION_INVALID_INPUT]: "Check the entered values and try again.",
    [ADMIN_ERROR_CODES.VALIDATION_PRODUCT_TITLE_REQUIRED]: "An English product title is required.",
    [ADMIN_ERROR_CODES.VALIDATION_PUBLISH_REQUIREMENTS]: "A published product needs an English title, short description, cover, and Amazon link.",
    [ADMIN_ERROR_CODES.VALIDATION_SLUG_REQUIRED]: "A slug is required.",
    [ADMIN_ERROR_CODES.VALIDATION_CATEGORY_NAME_REQUIRED]: "An English category name is required.",
    [ADMIN_ERROR_CODES.VALIDATION_TAG_NAME_REQUIRED]: "An English tag name is required.",
    [ADMIN_ERROR_CODES.VALIDATION_PAGE_SLUG]: "Only the privacy and terms pages can be edited.",
    [ADMIN_ERROR_CODES.VALIDATION_MEDIA_UPLOAD_ACTIVE]: "Finish uploading files before saving the product.",
    [ADMIN_ERROR_CODES.VALIDATION_MEDIA_UPLOAD_STATE]: "The file upload state could not be confirmed.",
    [ADMIN_ERROR_CODES.VALIDATION_ASSET_UPLOAD_INCOMPLETE]: "Finish uploading each new file before saving.",
    [ADMIN_ERROR_CODES.VALIDATION_ASSET_PATH]: "One of the uploaded file paths is invalid.",
    [ADMIN_ERROR_CODES.VALIDATION_ASSET_FILE]: "One of the uploaded files is invalid.",
    [ADMIN_ERROR_CODES.VALIDATION_ASSET_VISIBILITY]: "The file visibility does not match its purpose.",
    [ADMIN_ERROR_CODES.VALIDATION_COVER_DUPLICATE]: "Only one cover is allowed.",
    [ADMIN_ERROR_CODES.VALIDATION_VIDEO_DUPLICATE]: "Only one video is allowed.",
    [ADMIN_ERROR_CODES.VALIDATION_GALLERY_LIMIT]: "The gallery can contain at most 20 images.",
    [ADMIN_ERROR_CODES.VALIDATION_PREMIUM_CODE_REQUIRED]: "Enter a premium code or remove the empty row.",
    [ADMIN_ERROR_CODES.CONFLICT_PREMIUM_CODE_DUPLICATE]: "Each premium code can be used only once in this product.",
    [ADMIN_ERROR_CODES.CONFLICT_PREMIUM_CODE_EXISTING]: "This premium code is already assigned to another product.",
    [ADMIN_ERROR_CODES.CONFLICT_AMAZON_MARKET_DUPLICATE]: "Each Amazon market can be listed only once.",
    [ADMIN_ERROR_CODES.CONFLICT_SLUG]: "This slug is already in use.",
    [ADMIN_ERROR_CODES.CONFLICT_DATA]: "These changes conflict with existing data. Refresh and try again.",
  },
  pl: {
    [ADMIN_ERROR_CODES.INTERNAL]: "Nie udało się zapisać zmian. Spróbuj ponownie.",
    [ADMIN_ERROR_CODES.AUTHORIZATION_DENIED]: "Sesja administratora wygasła. Zaloguj się ponownie.",
    [ADMIN_ERROR_CODES.NOT_FOUND_PRODUCT]: "Nie znaleziono produktu.",
    [ADMIN_ERROR_CODES.NOT_FOUND_RESOURCE]: "Nie znaleziono wskazanego elementu.",
    [ADMIN_ERROR_CODES.NOT_FOUND_ASSET_UPLOAD]: "Nie znaleziono przesłanego pliku. Prześlij go ponownie.",
    [ADMIN_ERROR_CODES.VALIDATION_INVALID_INPUT]: "Sprawdź wpisane wartości i spróbuj ponownie.",
    [ADMIN_ERROR_CODES.VALIDATION_PRODUCT_TITLE_REQUIRED]: "Tytuł produktu po angielsku jest wymagany.",
    [ADMIN_ERROR_CODES.VALIDATION_PUBLISH_REQUIREMENTS]: "Opublikowany produkt wymaga tytułu EN, krótkiego opisu, okładki i linku Amazon.",
    [ADMIN_ERROR_CODES.VALIDATION_SLUG_REQUIRED]: "Slug jest wymagany.",
    [ADMIN_ERROR_CODES.VALIDATION_CATEGORY_NAME_REQUIRED]: "Nazwa kategorii po angielsku jest wymagana.",
    [ADMIN_ERROR_CODES.VALIDATION_TAG_NAME_REQUIRED]: "Nazwa tagu po angielsku jest wymagana.",
    [ADMIN_ERROR_CODES.VALIDATION_PAGE_SLUG]: "Można edytować tylko strony privacy i terms.",
    [ADMIN_ERROR_CODES.VALIDATION_MEDIA_UPLOAD_ACTIVE]: "Zakończ przesyłanie plików przed zapisaniem produktu.",
    [ADMIN_ERROR_CODES.VALIDATION_MEDIA_UPLOAD_STATE]: "Nie udało się potwierdzić stanu przesyłania plików.",
    [ADMIN_ERROR_CODES.VALIDATION_ASSET_UPLOAD_INCOMPLETE]: "Zakończ przesyłanie każdego nowego pliku przed zapisem.",
    [ADMIN_ERROR_CODES.VALIDATION_ASSET_PATH]: "Jedna ze ścieżek przesłanych plików jest nieprawidłowa.",
    [ADMIN_ERROR_CODES.VALIDATION_ASSET_FILE]: "Jeden z przesłanych plików jest nieprawidłowy.",
    [ADMIN_ERROR_CODES.VALIDATION_ASSET_VISIBILITY]: "Widoczność pliku nie pasuje do jego przeznaczenia.",
    [ADMIN_ERROR_CODES.VALIDATION_COVER_DUPLICATE]: "Może istnieć tylko jedna okładka.",
    [ADMIN_ERROR_CODES.VALIDATION_VIDEO_DUPLICATE]: "Może istnieć tylko jedno wideo.",
    [ADMIN_ERROR_CODES.VALIDATION_GALLERY_LIMIT]: "Galeria może zawierać maksymalnie 20 obrazów.",
    [ADMIN_ERROR_CODES.VALIDATION_PREMIUM_CODE_REQUIRED]: "Wpisz kod premium albo usuń pusty wiersz.",
    [ADMIN_ERROR_CODES.CONFLICT_PREMIUM_CODE_DUPLICATE]: "Każdy kod premium może wystąpić w tym produkcie tylko raz.",
    [ADMIN_ERROR_CODES.CONFLICT_PREMIUM_CODE_EXISTING]: "Ten kod premium jest już przypisany do innego produktu.",
    [ADMIN_ERROR_CODES.CONFLICT_AMAZON_MARKET_DUPLICATE]: "Każdy rynek Amazon może wystąpić tylko raz.",
    [ADMIN_ERROR_CODES.CONFLICT_SLUG]: "Ten slug jest już używany.",
    [ADMIN_ERROR_CODES.CONFLICT_DATA]: "Zmiany kolidują z istniejącymi danymi. Odśwież stronę i spróbuj ponownie.",
  },
  de: {
    [ADMIN_ERROR_CODES.INTERNAL]: "Die Änderungen konnten nicht gespeichert werden. Bitte versuche es erneut.",
    [ADMIN_ERROR_CODES.AUTHORIZATION_DENIED]: "Deine Administratorsitzung ist abgelaufen. Bitte melde dich erneut an.",
    [ADMIN_ERROR_CODES.NOT_FOUND_PRODUCT]: "Das Produkt wurde nicht gefunden.",
    [ADMIN_ERROR_CODES.NOT_FOUND_RESOURCE]: "Das angeforderte Element wurde nicht gefunden.",
    [ADMIN_ERROR_CODES.NOT_FOUND_ASSET_UPLOAD]: "Die hochgeladene Datei wurde nicht gefunden. Lade sie erneut hoch.",
    [ADMIN_ERROR_CODES.VALIDATION_INVALID_INPUT]: "Prüfe die eingegebenen Werte und versuche es erneut.",
    [ADMIN_ERROR_CODES.VALIDATION_PRODUCT_TITLE_REQUIRED]: "Ein englischer Produkttitel ist erforderlich.",
    [ADMIN_ERROR_CODES.VALIDATION_PUBLISH_REQUIREMENTS]: "Ein veröffentlichtes Produkt benötigt englischen Titel, Kurzbeschreibung, Cover und Amazon-Link.",
    [ADMIN_ERROR_CODES.VALIDATION_SLUG_REQUIRED]: "Ein Slug ist erforderlich.",
    [ADMIN_ERROR_CODES.VALIDATION_CATEGORY_NAME_REQUIRED]: "Ein englischer Kategoriename ist erforderlich.",
    [ADMIN_ERROR_CODES.VALIDATION_TAG_NAME_REQUIRED]: "Ein englischer Tagname ist erforderlich.",
    [ADMIN_ERROR_CODES.VALIDATION_PAGE_SLUG]: "Nur die Seiten privacy und terms können bearbeitet werden.",
    [ADMIN_ERROR_CODES.VALIDATION_MEDIA_UPLOAD_ACTIVE]: "Schließe die Dateiübertragung ab, bevor du das Produkt speicherst.",
    [ADMIN_ERROR_CODES.VALIDATION_MEDIA_UPLOAD_STATE]: "Der Status der Dateiübertragung konnte nicht bestätigt werden.",
    [ADMIN_ERROR_CODES.VALIDATION_ASSET_UPLOAD_INCOMPLETE]: "Schließe jede neue Dateiübertragung vor dem Speichern ab.",
    [ADMIN_ERROR_CODES.VALIDATION_ASSET_PATH]: "Einer der hochgeladenen Dateipfade ist ungültig.",
    [ADMIN_ERROR_CODES.VALIDATION_ASSET_FILE]: "Eine der hochgeladenen Dateien ist ungültig.",
    [ADMIN_ERROR_CODES.VALIDATION_ASSET_VISIBILITY]: "Die Dateisichtbarkeit passt nicht zum Verwendungszweck.",
    [ADMIN_ERROR_CODES.VALIDATION_COVER_DUPLICATE]: "Es ist nur ein Cover erlaubt.",
    [ADMIN_ERROR_CODES.VALIDATION_VIDEO_DUPLICATE]: "Es ist nur ein Video erlaubt.",
    [ADMIN_ERROR_CODES.VALIDATION_GALLERY_LIMIT]: "Die Galerie darf höchstens 20 Bilder enthalten.",
    [ADMIN_ERROR_CODES.VALIDATION_PREMIUM_CODE_REQUIRED]: "Gib einen Premium-Code ein oder entferne die leere Zeile.",
    [ADMIN_ERROR_CODES.CONFLICT_PREMIUM_CODE_DUPLICATE]: "Jeder Premium-Code darf in diesem Produkt nur einmal verwendet werden.",
    [ADMIN_ERROR_CODES.CONFLICT_PREMIUM_CODE_EXISTING]: "Dieser Premium-Code ist bereits einem anderen Produkt zugewiesen.",
    [ADMIN_ERROR_CODES.CONFLICT_AMAZON_MARKET_DUPLICATE]: "Jeder Amazon-Markt darf nur einmal aufgeführt werden.",
    [ADMIN_ERROR_CODES.CONFLICT_SLUG]: "Dieser Slug wird bereits verwendet.",
    [ADMIN_ERROR_CODES.CONFLICT_DATA]: "Die Änderungen stehen im Konflikt mit vorhandenen Daten. Aktualisiere die Seite und versuche es erneut.",
  },
  es: {
    [ADMIN_ERROR_CODES.INTERNAL]: "No se pudieron guardar los cambios. Inténtalo de nuevo.",
    [ADMIN_ERROR_CODES.AUTHORIZATION_DENIED]: "La sesión de administrador ha caducado. Inicia sesión de nuevo.",
    [ADMIN_ERROR_CODES.NOT_FOUND_PRODUCT]: "No se encontró el producto.",
    [ADMIN_ERROR_CODES.NOT_FOUND_RESOURCE]: "No se encontró el elemento solicitado.",
    [ADMIN_ERROR_CODES.NOT_FOUND_ASSET_UPLOAD]: "No se encontró el archivo subido. Vuelve a subirlo.",
    [ADMIN_ERROR_CODES.VALIDATION_INVALID_INPUT]: "Comprueba los valores introducidos e inténtalo de nuevo.",
    [ADMIN_ERROR_CODES.VALIDATION_PRODUCT_TITLE_REQUIRED]: "Se necesita un título de producto en inglés.",
    [ADMIN_ERROR_CODES.VALIDATION_PUBLISH_REQUIREMENTS]: "Un producto publicado necesita título en inglés, descripción corta, portada y enlace de Amazon.",
    [ADMIN_ERROR_CODES.VALIDATION_SLUG_REQUIRED]: "Se necesita un slug.",
    [ADMIN_ERROR_CODES.VALIDATION_CATEGORY_NAME_REQUIRED]: "Se necesita un nombre de categoría en inglés.",
    [ADMIN_ERROR_CODES.VALIDATION_TAG_NAME_REQUIRED]: "Se necesita un nombre de etiqueta en inglés.",
    [ADMIN_ERROR_CODES.VALIDATION_PAGE_SLUG]: "Solo se pueden editar las páginas privacy y terms.",
    [ADMIN_ERROR_CODES.VALIDATION_MEDIA_UPLOAD_ACTIVE]: "Termina de subir los archivos antes de guardar el producto.",
    [ADMIN_ERROR_CODES.VALIDATION_MEDIA_UPLOAD_STATE]: "No se pudo confirmar el estado de la subida.",
    [ADMIN_ERROR_CODES.VALIDATION_ASSET_UPLOAD_INCOMPLETE]: "Termina de subir cada archivo nuevo antes de guardar.",
    [ADMIN_ERROR_CODES.VALIDATION_ASSET_PATH]: "Una de las rutas de archivo subidas no es válida.",
    [ADMIN_ERROR_CODES.VALIDATION_ASSET_FILE]: "Uno de los archivos subidos no es válido.",
    [ADMIN_ERROR_CODES.VALIDATION_ASSET_VISIBILITY]: "La visibilidad del archivo no coincide con su uso.",
    [ADMIN_ERROR_CODES.VALIDATION_COVER_DUPLICATE]: "Solo se permite una portada.",
    [ADMIN_ERROR_CODES.VALIDATION_VIDEO_DUPLICATE]: "Solo se permite un vídeo.",
    [ADMIN_ERROR_CODES.VALIDATION_GALLERY_LIMIT]: "La galería puede contener como máximo 20 imágenes.",
    [ADMIN_ERROR_CODES.VALIDATION_PREMIUM_CODE_REQUIRED]: "Introduce un código premium o elimina la fila vacía.",
    [ADMIN_ERROR_CODES.CONFLICT_PREMIUM_CODE_DUPLICATE]: "Cada código premium solo puede usarse una vez en este producto.",
    [ADMIN_ERROR_CODES.CONFLICT_PREMIUM_CODE_EXISTING]: "Este código premium ya está asignado a otro producto.",
    [ADMIN_ERROR_CODES.CONFLICT_AMAZON_MARKET_DUPLICATE]: "Cada mercado de Amazon solo puede aparecer una vez.",
    [ADMIN_ERROR_CODES.CONFLICT_SLUG]: "Este slug ya está en uso.",
    [ADMIN_ERROR_CODES.CONFLICT_DATA]: "Los cambios entran en conflicto con datos existentes. Actualiza e inténtalo de nuevo.",
  },
} satisfies Record<Locale, Record<AdminErrorCode, string>>;

export function getAdminErrorMessage(code: string, locale: Locale = "pl") {
  return isAdminErrorCode(code)
    ? translatedMessages[locale][code]
    : translatedMessages[locale][ADMIN_ERROR_CODES.INTERNAL];
}

export function formatAdminErrors(value: string | string[] | undefined, locale: Locale = "pl") {
  const codes = parseAdminErrorCodes(value);
  return codes.map((code) => getAdminErrorMessage(code, locale)).join(" ");
}

export function parseAdminErrorCodes(value: string | string[] | undefined): AdminErrorCode[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const codes = values
    .flatMap((item) => item.split(/[|,\s]+/))
    .filter(isAdminErrorCode);

  return Array.from(new Set(codes.length ? codes : [ADMIN_ERROR_CODES.INTERNAL]));
}

export function isAdminErrorCode(value: string): value is AdminErrorCode {
  return (Object.values(ADMIN_ERROR_CODES) as string[]).includes(value);
}

export function classifyAdminDatabaseError(
  error: DatabaseErrorLike,
  fallback: AdminErrorCode = ADMIN_ERROR_CODES.INTERNAL,
): AdminErrorCode {
  const code = error.code ?? "";
  const constraint = (error.constraint ?? "").toLowerCase();
  const diagnosticText = [constraint, error.details, error.message]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const status = String(error.status ?? error.statusCode ?? "");

  if (code === "42501" || status === "401" || status === "403") {
    return ADMIN_ERROR_CODES.AUTHORIZATION_DENIED;
  }

  if (code === "23505") {
    if (diagnosticText.includes("premium_codes") || diagnosticText.includes("premium code")) {
      return ADMIN_ERROR_CODES.CONFLICT_PREMIUM_CODE_DUPLICATE;
    }

    if (diagnosticText.includes("amazon") && diagnosticText.includes("market")) {
      return ADMIN_ERROR_CODES.CONFLICT_AMAZON_MARKET_DUPLICATE;
    }

    if (diagnosticText.includes("products_slug") || diagnosticText.includes("slug")) {
      return ADMIN_ERROR_CODES.CONFLICT_SLUG;
    }

    return ADMIN_ERROR_CODES.CONFLICT_DATA;
  }

  if (code === "23503") {
    return ADMIN_ERROR_CODES.CONFLICT_DATA;
  }

  if (
    code === "22001" ||
    code === "22003" ||
    code === "22004" ||
    code === "22007" ||
    code === "22008" ||
    code === "22023" ||
    code === "22P02" ||
    code === "23502" ||
    code === "P0001"
  ) {
    return ADMIN_ERROR_CODES.VALIDATION_INVALID_INPUT;
  }

  return fallback;
}

export function mapAdminError(error: unknown, operation: string): AdminErrorCode {
  if (error instanceof AdminApplicationError) {
    return error.code;
  }

  if (error instanceof AdminDatabaseError) {
    const mapped = classifyAdminDatabaseError(error.databaseError);
    logAdminDatabaseFailure(operation, error.databaseError, mapped);
    return mapped;
  }

  if (isDatabaseErrorLike(error)) {
    const mapped = classifyAdminDatabaseError(error);
    logAdminDatabaseFailure(operation, error, mapped);
    return mapped;
  }

  console.error(`[admin-mutation] ${operation} failed unexpectedly.`, error);
  return ADMIN_ERROR_CODES.INTERNAL;
}

function isDatabaseErrorLike(error: unknown): error is DatabaseErrorLike {
  return Boolean(error && typeof error === "object" && (
    "code" in error ||
    "constraint" in error ||
    "details" in error ||
    "statusCode" in error
  ));
}

function logAdminDatabaseFailure(
  operation: string,
  error: DatabaseErrorLike,
  mapped: AdminErrorCode,
) {
  console.error(`[admin-mutation] ${operation} returned a database error.`, {
    code: error.code ?? null,
    constraint: error.constraint ?? null,
    details: error.details ?? null,
    hint: error.hint ?? null,
    message: error.message ?? null,
    mapped,
  });
}
