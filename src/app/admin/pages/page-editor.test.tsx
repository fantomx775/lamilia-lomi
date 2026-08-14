/** @vitest-environment jsdom */

import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/admin/actions", () => ({ saveStaticPagesAction: vi.fn() }));

import { PageEditor } from "./page-editor";
import { getSeedContentSnapshot } from "@/lib/content-store";

afterEach(() => cleanup());

describe("PageEditor", () => {
  it("loads existing page locales and keeps one body editor visible", async () => {
    const user = userEvent.setup();
    const records = getSeedContentSnapshot().staticPages.filter((page) => page.slug === "privacy");
    const view = render(<PageEditor title="Privacy Policy" records={records} />);

    expect(view.getByRole("heading", { name: "Treść strony" })).toBeInTheDocument();
    expect(view.getAllByRole("tabpanel")).toHaveLength(1);
    expect(view.getByRole("tabpanel").querySelector("textarea")).toHaveValue(records[0].body);

    await user.click(view.getByRole("tab", { name: /PL/ }));
    expect(view.getByRole("tabpanel").querySelector("textarea")).toHaveValue(records.find((page) => page.locale === "pl")?.body);
    expect(view.getByLabelText("Slug")).toHaveValue("privacy");
  });

  it("renders a blank create flow with the supported page keys", () => {
    const view = render(<PageEditor title="Nowa strona" records={[]} isNew />);
    expect(view.getByRole("heading", { name: "Nowa strona" })).toBeInTheDocument();
    expect(view.getByLabelText("Slug")).toHaveValue("privacy");
    expect(view.getByRole("option", { name: "terms" })).toBeInTheDocument();
  });

  it("submits the shared slug and all locale fields through the provided action", async () => {
    const saveAction = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    const records = getSeedContentSnapshot().staticPages.filter((page) => page.slug === "privacy");
    const view = render(<PageEditor title="Privacy Policy" records={records} saveAction={saveAction} />);

    const title = view.container.querySelector<HTMLInputElement>("#page-title-en");
    expect(title).not.toBeNull();
    await user.clear(title!);
    await user.type(title!, "Updated privacy policy");
    await user.click(view.getAllByRole("button", { name: "Zapisz" })[0]);

    await waitFor(() => expect(saveAction).toHaveBeenCalled());
    const formData = saveAction.mock.calls[0][0] as FormData;
    expect(formData.get("slug")).toBe("privacy");
    expect(formData.get("title_en")).toBe("Updated privacy policy");
    expect(formData.get("body_pl")).toBe(records.find((page) => page.locale === "pl")?.body);
  });
});
