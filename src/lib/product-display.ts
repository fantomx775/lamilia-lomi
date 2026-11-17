/** Public labels must describe the book, rather than its upload filename. */
export function productTypeLabel(value: string): string {
  return value.split(/[-_\s]+/).filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

export function publicImageAlt(value: string | null | undefined, fallback: string): string {
  const title = value?.trim();
  return title && !/(?:^|[\\/])[^\\/]+\.[a-z0-9]{2,5}$/i.test(title) ? title : fallback;
}
