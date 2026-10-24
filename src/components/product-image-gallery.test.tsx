/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: ({ src, alt, loading, className }: { src: string; alt: string; loading?: string; className?: string }) =>
    createElement("img", { src, alt, loading, className }),
}));

import { ProductImageGallery } from "@/components/product-image-gallery";
import { ReaderArtworkGallery } from "@/components/reader-artwork-gallery";

const images = [
  {
    id: "page-one",
    path: "/page-one.svg",
    alt: "Stars and little houses",
    caption: "Stars and little houses",
    unoptimized: false,
  },
  {
    id: "page-two",
    path: "/page-two.svg",
    alt: "Sleepy flower page",
    caption: "Sleepy flower page",
    unoptimized: false,
  },
];

const labels = {
  openImages: ["Open image 1", "Open image 2"],
  previewTitle: "Image preview",
  closePreview: "Close image preview",
  previousImage: "Previous image",
  nextImage: "Next image",
  imagePositions: ["1 of 2", "2 of 2"],
  moreImages: "more",
  viewAllImages: "View all {count} pages",
};

function makeImages(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `page-${index + 1}`,
    path: `/page-${index + 1}.svg`,
    alt: `Page ${index + 1}`,
    caption: null,
    unoptimized: false,
  }));
}

function makeLabels(count: number) {
  return {
    ...labels,
    openImages: Array.from({ length: count }, (_, index) => `Open image ${index + 1}`),
    imagePositions: Array.from({ length: count }, (_, index) => `${index + 1} of ${count}`),
  };
}

let showModalDescriptor: PropertyDescriptor | undefined;
let closeDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  const dialogPrototype = HTMLDialogElement.prototype;
  showModalDescriptor = Object.getOwnPropertyDescriptor(dialogPrototype, "showModal");
  closeDescriptor = Object.getOwnPropertyDescriptor(dialogPrototype, "close");

  Object.defineProperty(dialogPrototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(dialogPrototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    },
  });
});

afterEach(() => {
  cleanup();
  const dialogPrototype = HTMLDialogElement.prototype;
  if (showModalDescriptor) {
    Object.defineProperty(dialogPrototype, "showModal", showModalDescriptor);
  } else {
    Reflect.deleteProperty(dialogPrototype, "showModal");
  }
  if (closeDescriptor) {
    Object.defineProperty(dialogPrototype, "close", closeDescriptor);
  } else {
    Reflect.deleteProperty(dialogPrototype, "close");
  }
});

describe("ProductImageGallery", () => {
  it("opens a large preview and navigates with controls and arrow keys", async () => {
    const user = userEvent.setup();
    render(<ProductImageGallery images={images} labels={labels} />);

    await user.click(screen.getByRole("button", { name: "Open image 1" }));

    const dialog = screen.getByRole("dialog", { name: "Image preview" });
    expect(dialog).toHaveAttribute("open");
    expect(within(dialog).getByRole("img", { name: "Stars and little houses" })).toBeVisible();
    expect(within(dialog).getByText("1 of 2")).toBeVisible();

    await user.click(within(dialog).getByRole("button", { name: "Next image" }));
    expect(within(dialog).getByRole("img", { name: "Sleepy flower page" })).toBeVisible();
    expect(within(dialog).getByText("2 of 2")).toBeVisible();

    await user.keyboard("{ArrowLeft}");
    expect(within(dialog).getByRole("img", { name: "Stars and little houses" })).toBeVisible();
    expect(within(dialog).getByText("1 of 2")).toBeVisible();

    await user.click(within(dialog).getByRole("button", { name: "Close image preview" }));
    await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
  });

  it("supports touch swiping and wraps around the image sequence", async () => {
    const user = userEvent.setup();
    render(<ProductImageGallery images={images} labels={labels} />);

    await user.click(screen.getByRole("button", { name: "Open image 1" }));

    const dialog = screen.getByRole("dialog", { name: "Image preview" });
    const frame = within(dialog).getByTestId("product-gallery-preview-frame");
    fireEvent.pointerDown(frame, { pointerType: "touch", clientX: 280 });
    fireEvent.pointerUp(frame, { pointerType: "touch", clientX: 80 });

    expect(within(dialog).getByRole("img", { name: "Sleepy flower page" })).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Next image" }));
    expect(within(dialog).getByRole("img", { name: "Stars and little houses" })).toBeVisible();
  });

  it("renders no gallery for an empty image list", () => {
    const { container } = render(<ProductImageGallery images={[]} labels={makeLabels(0)} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows each reader credit once in a full-width collection layout and keeps all images in the viewer", async () => {
    const user = userEvent.setup();
    const artworks = ["Mira", "Jo", "Lee"].map((displayName, index) => ({
      id: `work-${index + 1}`,
      displayName,
      description: `Colorful page ${index + 1}`,
      sortOrder: index,
      src: `/api/reader-artworks/public-${index + 1}`,
    }));
    const { container } = render(<ReaderArtworkGallery artworks={artworks} />);

    expect(screen.getByRole("heading", { name: "Colored by Our Readers" })).toBeVisible();
    expect(screen.getByText("Colored by Mira")).toBeVisible();
    expect(screen.getAllByText("Colored by Mira")).toHaveLength(1);
    const grid = screen.getByTestId("reader-artwork-grid");
    expect(grid).toHaveClass("grid-cols-2", "lg:grid-cols-4");
    expect(container.textContent).not.toContain("storagePath");

    await user.click(screen.getByRole("button", { name: "Open artwork 1 by Mira" }));
    const dialog = screen.getByRole("dialog", { name: "Reader artwork preview" });
    expect(within(dialog).getByText("Colored by Mira")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Next artwork" }));
    expect(within(dialog).getByRole("img", { name: "Colorful page 2" })).toBeVisible();
    expect(within(dialog).getByText("2 of 3")).toBeVisible();
  });

  it("keeps a single image usable without carousel controls", async () => {
    const user = userEvent.setup();
    render(<ProductImageGallery images={makeImages(1)} labels={makeLabels(1)} />);

    const thumbnail = screen.getByRole("button", { name: "Open image 1" });
    expect(thumbnail.querySelector("img")).toHaveAttribute("loading", "lazy");
    expect(thumbnail.firstElementChild).toHaveClass("aspect-[8.5/11]");
    await user.click(thumbnail);

    const dialog = screen.getByRole("dialog", { name: "Image preview" });
    expect(within(dialog).getByRole("img", { name: "Page 1" })).toBeVisible();
    expect(within(dialog).getByTestId("product-gallery-preview-frame"))
      .toHaveClass("aspect-[8.5/11]");
    expect(within(dialog).getByRole("button", { name: "Close image preview" }))
      .toHaveClass("size-11");
    expect(within(dialog).queryByRole("button", { name: "Next image" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Previous image" })).not.toBeInTheDocument();
  });

  it("shows up to four portrait thumbnails and indicates the remaining images", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ProductImageGallery images={makeImages(4)} labels={makeLabels(4)} />,
    );

    expect(screen.getAllByRole("button", { name: /^Open image/ })).toHaveLength(4);
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();

    rerender(<ProductImageGallery images={makeImages(6)} labels={makeLabels(6)} />);

    expect(screen.getAllByRole("button", { name: /^Open image/ })).toHaveLength(4);
    expect(screen.getAllByRole("img")).toHaveLength(4);
    expect(screen.getByText("+2 more")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open image 2" }).querySelector("img"))
      .toHaveAttribute("loading", "lazy");
    const lastThumbnail = screen.getByRole("button", { name: "Open image 4, View all 6 pages" });
    expect(lastThumbnail.firstElementChild)
      .toHaveClass("aspect-[8.5/11]");

    await user.click(lastThumbnail);
    const dialog = screen.getByRole("dialog", { name: "Image preview" });
    expect(within(dialog).getByRole("img", { name: "Page 4" })).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Next image" }));
    expect(within(dialog).getByRole("img", { name: "Page 5" })).toBeVisible();
  });

  it("restores focus to the thumbnail that opened the viewer", async () => {
    const user = userEvent.setup();
    render(<ProductImageGallery images={images} labels={labels} />);

    const opener = screen.getByRole("button", { name: "Open image 2" });
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Image preview" });
    expect(within(dialog).getByRole("button", { name: "Close image preview" })).toHaveFocus();

    await user.click(within(dialog).getByRole("button", { name: "Close image preview" }));
    expect(opener).toHaveFocus();
  });

  it("wraps Tab focus inside the open dialog in both directions", async () => {
    const user = userEvent.setup();
    render(<ProductImageGallery images={images} labels={labels} />);
    await user.click(screen.getByRole("button", { name: "Open image 1" }));

    const dialog = screen.getByRole("dialog", { name: "Image preview" });
    expect(dialog).toHaveClass("w-[min(94vw,calc(52.5dvh_+_2.5rem))]");
    const closeButton = within(dialog).getByRole("button", { name: "Close image preview" });
    const nextButton = within(dialog).getByRole("button", { name: "Next image" });

    await user.click(nextButton);
    expect(nextButton).toHaveFocus();
    await user.tab();
    expect(closeButton).toHaveFocus();

    await user.tab({ shift: true });
    expect(nextButton).toHaveFocus();
  });
});
