/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
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
    expect(view.getByRole("group", { name: "Tryb edycji" })).toBeInTheDocument();
    expect(view.getByRole("button", { name: "Rich Text" })).toHaveAttribute("aria-pressed", "true");
    expect(view.queryByRole("tabpanel")).not.toBeInTheDocument();
    expect(view.getByRole("textbox", { name: "Treść" })).toHaveTextContent(records.find((page) => page.locale === "en")?.body ?? "");
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
    expect(formData.get("body")).toBe(records.find((page) => page.locale === "en")?.body);
    expect(formData.has("title_pl")).toBe(false);
    expect(formData.has("body_pl")).toBe(false);
  });

  it("uses successfully saved page content as the new unsaved-change baseline", async () => {
    const saveAction = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    const records = getSeedContentSnapshot().staticPages.filter((page) => page.slug === "privacy");
    const originalTitle = records.find((page) => page.locale === "en")?.title ?? "";
    const savedTitle = "Saved privacy title";
    const view = render(<PageEditor slug="privacy" title="Privacy Policy" records={records} saveAction={saveAction} />);
    const title = view.container.querySelector<HTMLInputElement>("#page-title");

    await user.clear(title!);
    await user.type(title!, savedTitle);
    await user.click(view.getAllByRole("button", { name: "Zapisz" })[0]);
    await waitFor(() => expect(saveAction).toHaveBeenCalled());

    const savedRecords = records.map((record) => record.locale === "en" ? { ...record, title: savedTitle } : record);
    view.rerender(<PageEditor slug="privacy" title="Privacy Policy" records={savedRecords} feedback="Zapisano zmiany." saved saveAction={saveAction} />);
    await waitFor(() => expect(view.queryByText("Masz niezapisane zmiany.")).not.toBeInTheDocument());

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await user.clear(title!);
    await user.type(title!, originalTitle);
    await waitFor(() => expect(view.getByText("Masz niezapisane zmiany.")).toBeInTheDocument());
    await user.click(view.getByRole("link", { name: "Strony" }));
    expect(confirm).toHaveBeenCalledWith("Masz niezapisane zmiany. Opuścić edytor i je odrzucić?");
    confirm.mockRestore();
  });

  it("keeps unsafe HTML drafts unchanged until the user accepts the supported conversion", async () => {
    const user = userEvent.setup();
    const records = getSeedContentSnapshot().staticPages.filter((page) => page.slug === "privacy");
    const originalBody = records.find((page) => page.locale === "en")?.body ?? "";
    const view = render(<PageEditor slug="privacy" title="Privacy Policy" records={records} />);

    await user.click(view.getByRole("button", { name: "HTML" }));
    const source = view.getByRole("textbox", { name: "Źródło HTML" });
    fireEvent.change(source, { target: { value: '<p onclick="alert(1)">Safe <a href="javascript:alert(2)">link</a><script>alert(3)</script></p>' } });
    await user.click(view.getByRole("button", { name: "HTML" }));
    expect(view.getByRole("textbox", { name: "Źródło HTML" })).toHaveValue('<p onclick="alert(1)">Safe <a href="javascript:alert(2)">link</a><script>alert(3)</script></p>');
    expect(view.container.querySelector<HTMLInputElement>('input[name="body"]')).toHaveValue(originalBody);
    await user.click(view.getByRole("button", { name: "Rich Text" }));

    expect(view.getByText(/Przed konwersją/)).toBeInTheDocument();
    expect(view.container.querySelector<HTMLInputElement>('input[name="body"]')).toHaveValue(originalBody);
    expect((view.getByRole("textbox", { name: "Źródło HTML" }) as HTMLTextAreaElement).value).toContain("javascript:");

    await user.click(view.getByRole("button", { name: "Użyj obsługiwanej treści" }));
    await waitFor(() => expect(view.container.querySelector<HTMLInputElement>('input[name="body"]')?.value.startsWith("lamilia-rich-text:v1:")).toBe(true));
    expect(view.container.querySelector<HTMLInputElement>('input[name="body"]')?.value).not.toMatch(/javascript:|script|onclick/i);
    expect(view.getByRole("textbox", { name: "Treść" })).toHaveTextContent("Safe link");
  });

  it("blocks saving while a source HTML draft has not been converted", async () => {
    const saveAction = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    const records = getSeedContentSnapshot().staticPages.filter((page) => page.slug === "terms");
    const view = render(<PageEditor slug="terms" title="Terms" records={records} saveAction={saveAction} />);

    await user.click(view.getByRole("button", { name: "HTML" }));
    fireEvent.change(view.getByRole("textbox", { name: "Źródło HTML" }), { target: { value: "<p>Unconverted source</p>" } });
    await user.click(view.getAllByRole("button", { name: "Zapisz" })[0]);

    expect(saveAction).not.toHaveBeenCalled();
    expect(view.getByRole("textbox", { name: "Źródło HTML" })).toHaveValue("<p>Unconverted source</p>");
  });

  it("warns before leaving a page with unsaved changes", async () => {
    const user = userEvent.setup();
    const records = getSeedContentSnapshot().staticPages.filter((page) => page.slug === "terms");
    const view = render(<PageEditor slug="terms" title="Terms" records={records} />);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const title = view.container.querySelector<HTMLInputElement>("#page-title");

    await user.type(title!, " updated");
    expect(view.getByRole("status")).toHaveTextContent("Masz niezapisane zmiany.");
    await user.click(view.getByRole("link", { name: "Strony" }));
    expect(confirm).toHaveBeenCalledWith("Masz niezapisane zmiany. Opuścić edytor i je odrzucić?");
    expect(view.container.querySelector("#page-title")).toBeInTheDocument();
    confirm.mockRestore();
  });

});
