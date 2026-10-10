/** @vitest-environment jsdom */

import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/admin/actions", () => ({ saveStaticPagesAction: vi.fn() }));

import { PageEditor } from "./page-editor";
import { getSeedContentSnapshot } from "@/lib/content-store";

afterEach(() => cleanup());

describe("PageEditor", () => {
  it("loads the single content language without language tabs", () => {
    const records = getSeedContentSnapshot().staticPages.filter((page) => page.slug === "privacy");
    const view = render(<PageEditor slug="privacy" title="Privacy Policy" records={records} />);

    expect(view.getByRole("heading", { name: "Treść strony" })).toBeInTheDocument();
    expect(view.queryByRole("tab")).not.toBeInTheDocument();
    expect(view.getByLabelText("Treść")).toHaveValue(records.find((page) => page.locale === "en")?.body);
    expect(view.getByText("Klucz strony: privacy")).toBeInTheDocument();
    expect(view.container.querySelector('select[name="slug"]')).not.toBeInTheDocument();
    expect(view.container.querySelector('input[name="slug"]')).toHaveValue("privacy");
  });

  it("submits only the page content through the provided action", async () => {
    const saveAction = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    const records = getSeedContentSnapshot().staticPages.filter((page) => page.slug === "privacy");
    const view = render(<PageEditor slug="privacy" title="Privacy Policy" records={records} saveAction={saveAction} />);

    const title = view.container.querySelector<HTMLInputElement>("#page-title");
    expect(title).not.toBeNull();
    await user.clear(title!);
    await user.type(title!, "Updated privacy policy");
    await user.click(view.getAllByRole("button", { name: "Zapisz" })[0]);

    await waitFor(() => expect(saveAction).toHaveBeenCalled());
    const formData = saveAction.mock.calls[0][0] as FormData;
    expect(formData.get("slug")).toBe("privacy");
    expect(formData.get("title")).toBe("Updated privacy policy");
    expect(formData.has("title_pl")).toBe(false);
    expect(formData.has("body_pl")).toBe(false);
  });
});
