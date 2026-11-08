export type ImageUse = "cover" | "gallery" | "category";

export type ImageDimensions = { width: number; height: number };

export type ImageDimensionValidation =
  | { ok: true }
  | { ok: false; error: string };

const SQUARE_RATIO = 1;
const PORTRAIT_RATIO = 8.5 / 11;
const RATIO_TOLERANCE = 0.02;
const GALLERY_TRIM_SIZES = [[8.5, 11], [8.5, 8.5], [6, 9], [8, 10]] as const;

export function getGalleryTrimRatio({ width, height }: ImageDimensions): number | undefined {
  const ratio = width / height;
  let closest: number | undefined;
  let closestDifference = Infinity;
  for (const [trimWidth, trimHeight] of GALLERY_TRIM_SIZES) {
    const possibleRatios = [
      trimWidth / trimHeight,
      (trimWidth + 0.125) / (trimHeight + 0.25),
      (trimWidth + 0.25) / (trimHeight + 0.25),
    ];
    for (const candidate of possibleRatios) {
      const difference = Math.abs(ratio - candidate) / candidate;
      if (difference <= RATIO_TOLERANCE && difference < closestDifference) {
        closest = trimWidth / trimHeight;
        closestDifference = difference;
      }
    }
  }
  return closest;
}

const IMAGE_REQUIREMENTS: Record<ImageUse, string> = {
  cover: "Okładka: format 1:1 lub pionowy 8.5:11; minimum 600 px, a dla pionowego minimum 600 × 776 px.",
  gallery: "Galeria: format 8.5:11, 8.5:8.5, 6:9 lub 8:10 (ze spadem lub bez); krótszy bok minimum 500 px.",
  category: "Kategoria: kwadrat 1:1, minimum 480 × 480 px.",
};

export function imageRatioRequirement(use: ImageUse) {
  return IMAGE_REQUIREMENTS[use];
}

export function validateImageDimensions(
  use: ImageUse,
  { width, height }: ImageDimensions,
): ImageDimensionValidation {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    return { ok: false, error: "Nie udało się odczytać wymiarów obrazu. Wybierz prawidłowy plik PNG, JPG lub WEBP." };
  }

  const ratio = width / height;
  const matchesSquare = isCloseToRatio(ratio, SQUARE_RATIO);
  const matchesPortrait = isCloseToRatio(ratio, PORTRAIT_RATIO);

  if (use === "cover" && !matchesSquare && !matchesPortrait) {
    return { ok: false, error: `${IMAGE_REQUIREMENTS.cover} Wybrany obraz ma proporcje ${width}:${height}.` };
  }

  if (use === "category" && !matchesSquare) {
    return { ok: false, error: `${IMAGE_REQUIREMENTS.category} Wybrany obraz ma proporcje ${width}:${height}.` };
  }

  if (use === "gallery" && !getGalleryTrimRatio({ width, height })) {
    return { ok: false, error: `${IMAGE_REQUIREMENTS.gallery} Wybrany obraz ma proporcje ${width}:${height}.` };
  }

  if (use === "cover" && (width < 600 || (matchesPortrait && height < 776) || (matchesSquare && height < 600))) {
    return { ok: false, error: `${IMAGE_REQUIREMENTS.cover} Wybrany obraz jest za mały.` };
  }

  if (use === "category" && (width < 480 || height < 480)) {
    return { ok: false, error: `${IMAGE_REQUIREMENTS.category} Wybrany obraz jest za mały.` };
  }

  if (use === "gallery" && Math.min(width, height) < 500) {
    return { ok: false, error: `${IMAGE_REQUIREMENTS.gallery} Wybrany obraz jest za mały.` };
  }

  return { ok: true };
}

export function readImageDimensions(file: File): Promise<ImageDimensions> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    const cleanUp = () => URL.revokeObjectURL(objectUrl);
    image.onload = () => {
      const dimensions = { width: image.naturalWidth, height: image.naturalHeight };
      cleanUp();
      resolve(dimensions);
    };
    image.onerror = () => {
      cleanUp();
      reject(new Error("Nie udało się odczytać obrazu. Wybierz prawidłowy plik PNG, JPG lub WEBP."));
    };
    image.src = objectUrl;
  });
}

function isCloseToRatio(actual: number, expected: number) {
  return Math.abs(actual - expected) / expected <= RATIO_TOLERANCE;
}
