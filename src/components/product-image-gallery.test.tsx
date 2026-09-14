/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => createElement("img", { src, alt }),
}));

import { ProductImageGallery } from "@/components/product-image-gallery";

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
};

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
});
