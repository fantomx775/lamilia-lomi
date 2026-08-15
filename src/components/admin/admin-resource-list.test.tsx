/** @vitest-environment jsdom */

import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const routerPush = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

import { AdminResourceList, formatPolishResultsCount } from "./admin-resource-list";
import { DataTable, type DataTableColumn } from "./data-table";

afterEach(() => {
  cleanup();
  routerPush.mockClear();
});

type TestRow = {
  id: string;
  name: string;
};

const columns: DataTableColumn<TestRow>[] = [
  {
    id: "name",
    header: "Name",
    cell: (row) => row.name,
  },
];

describe("DataTable", () => {
  it("renders accessible column headers and row data", () => {
    const { getByRole } = render(
      <DataTable
        caption="Test records"
        columns={columns}
        data={[{ id: "1", name: "Alpha" }]}
        getRowId={(row) => row.id}
        emptyState={<p>Nothing here</p>}
      />,
    );

    const table = getByRole("table", { name: "Test records" });

    expect(table.querySelector("th")?.textContent).toBe("Name");
    expect(table.querySelector("td")?.textContent).toBe("Alpha");
  });

  it("keeps table rows read-only without button semantics", () => {
    const { getByRole } = render(
      <DataTable
        caption="Read-only records"
        columns={columns}
        data={[{ id: "1", name: "Alpha" }]}
        getRowId={(row) => row.id}
        emptyState={<p>Nothing here</p>}
      />,
    );

    const row = getByRole("table", { name: "Read-only records" }).querySelector("tbody tr");

    expect(row).not.toHaveAttribute("role", "button");
    expect(row).not.toHaveAttribute("tabindex");
  });

  it("navigates from neutral row space without hijacking nested links", async () => {
    const user = userEvent.setup();
    const { getAllByRole, getByRole } = render(
      <DataTable
        caption="Navigable records"
        columns={[
          {
            id: "name",
            header: "Name",
            cell: (row) => <a href={`/records/${row.id}/link`}>{row.name}</a>,
          },
          {
            id: "status",
            header: "Status",
            cell: () => <span>Neutral</span>,
          },
          {
            id: "action",
            header: "Action",
            cell: () => <button type="button">Action</button>,
          },
        ]}
        data={[{ id: "1", name: "Alpha" }]}
        getRowId={(row) => row.id}
        getRowHref={(row) => `/records/${row.id}`}
        emptyState={<p>Nothing here</p>}
      />,
    );

    const table = getByRole("table", { name: "Navigable records" });
    const row = table.querySelector("tbody tr");
    const nestedLink = getAllByRole("link", { name: "Alpha" })[0];
    const nestedButton = table.querySelector("button");
    const neutralCell = row?.querySelector("td:nth-child(2)");

    expect(row).not.toHaveAttribute("role", "link");
    expect(row).not.toHaveAttribute("tabindex");
    expect(nestedLink).toHaveAttribute("href", "/records/1/link");
    expect(neutralCell).not.toBeNull();

    await user.click(nestedLink);
    expect(routerPush).not.toHaveBeenCalled();

    await user.click(nestedButton!);
    expect(routerPush).not.toHaveBeenCalled();

    await user.click(neutralCell!);
    expect(routerPush).toHaveBeenCalledWith("/records/1");
  });

  it("activates drawer rows from neutral space and preserves the first-column trigger", async () => {
    const user = userEvent.setup();
    const onRowActivate = vi.fn();
    const rowValue = { id: "1", name: "Alpha" };
    const { getByRole } = render(
      <DataTable
        caption="Drawer records"
        columns={[
          {
            id: "name",
            header: "Name",
            cell: (row) => <button type="button">{row.name}</button>,
          },
          {
            id: "status",
            header: "Status",
            cell: () => <span>Neutral</span>,
          },
        ]}
        data={[rowValue]}
        getRowId={(row) => row.id}
        onRowActivate={onRowActivate}
        emptyState={<p>Nothing here</p>}
      />,
    );

    const table = getByRole("table", { name: "Drawer records" });
    const row = table.querySelector("tbody tr");
    const trigger = table.querySelector("tbody tr td:first-child button");
    const neutralCell = row?.querySelector("td:nth-child(2)");

    expect(row).not.toHaveAttribute("role");
    expect(row).not.toHaveAttribute("tabindex");
    expect(row).toHaveClass("focus-within:bg-[var(--color-bg-alt)]");

    await user.click(neutralCell!);
    expect(onRowActivate).toHaveBeenCalledWith(rowValue, trigger);

    await user.click(trigger!);
    expect(onRowActivate).toHaveBeenCalledTimes(1);
  });

  it("renders the empty state when there are no rows", () => {
    const { getAllByText } = render(
      <DataTable
        caption="Empty records"
        columns={columns}
        data={[]}
        getRowId={(row) => row.id}
        emptyState={<p>Nothing here</p>}
      />,
    );

    expect(getAllByText("Nothing here")).toHaveLength(2);
  });
});

describe("formatPolishResultsCount", () => {
  it.each([
    [0, "0 wyników"],
    [1, "1 wynik"],
    [2, "2 wyniki"],
    [4, "4 wyniki"],
    [5, "5 wyników"],
    [12, "12 wyników"],
    [14, "14 wyników"],
    [21, "21 wyników"],
    [22, "22 wyniki"],
    [24, "24 wyniki"],
    [25, "25 wyników"],
  ])("formats %i as %s", (count, expected) => {
    expect(formatPolishResultsCount(count)).toBe(expected);
  });
});

describe("AdminResourceList", () => {
  it("filters rows with case-insensitive, accent-insensitive search", async () => {
    const user = userEvent.setup();
    const { getByRole, getByText } = render(
      <AdminResourceList
        title="Records"
        searchPlaceholder="Search records"
        searchAriaLabel="Search records"
        caption="Records"
        rows={[
          { id: "1", name: "Żółta książka" },
          { id: "2", name: "Blue notebook" },
        ]}
        columns={columns}
        getRowId={(row) => row.id}
        getSearchText={(row) => row.name}
        emptyState={<p>No records</p>}
      />,
    );

    const search = getByRole("textbox", { name: "Search records" });
    expect(getByText("2 wyniki")).toBeInTheDocument();

    await user.type(search, "zolta");

    expect(getByText("1 wynik")).toBeInTheDocument();
    const table = getByRole("table", { name: "Records" });
    expect(table.textContent).toContain("Żółta książka");
    expect(table.textContent).not.toContain("Blue notebook");
  });
});
