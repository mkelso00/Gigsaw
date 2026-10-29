import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/overture";
import { splitNames, templateCsv, TEMPLATE_COLUMNS } from "@/lib/templates";

describe("fill-in templates", () => {
  it("download as CSV that reads back with the right columns", () => {
    for (const kind of ["acts", "people", "venues"] as const) {
      const rows = parseCsv(templateCsv(kind));
      expect(Object.keys(rows[0])).toEqual(TEMPLATE_COLUMNS[kind].columns);
      expect(rows).toHaveLength(2);
    }
  });
  it("splits lists of names on semicolons or commas", () => {
    expect(splitNames("Dev Sharma; Sam Price, Jo")).toEqual(["Dev Sharma", "Sam Price", "Jo"]);
    expect(splitNames(undefined)).toEqual([]);
  });
});
