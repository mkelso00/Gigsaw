import { describe, expect, it } from "vitest";
import { parseCsv, readOvertureContacts, tidyPhone } from "@/lib/overture";

const HEAD = `﻿"Contact ID","First name",Surname,"Job title","Company name","Act name","Act name 2","Email 1","Phone number 1","Address 1: Line 1","Address 1: City",Tag\n`;

describe("Overture contacts export", () => {
  it("parses quoted fields with commas and line breaks", () => {
    const rows = parseCsv(`a,b\n"one, two","line\nbreak"\n`);
    expect(rows).toEqual([{ a: "one, two", b: "line\nbreak" }]);
  });

  it("sorts rows into acts, people, venues, companies and customers, and links them", () => {
    const csv =
      HEAD +
      `1,,,,,"Wonderlust",,,,,,Artist\n` +
      `2,Graham,McKee,,,"Graham McKee","Wonderlust",g@x.com,7700900123,,,\n` +
      `3,,,,"The Crown",,,,,"1 High St",Bristol,\n` +
      `4,,,,"Suave Agency",,,,,,,\n` +
      `5,Rachel,Green,Manager,"The Crown",,,r@x.com,,,,\n` +
      `6,Hannah,Brooks,,,,,h@x.com,,,,Customer\n` +
      `"Contact ID","First name",Surname,"Job title","Company name","Act name","Act name 2","Email 1","Phone number 1","Address 1: Line 1","Address 1: City",Tag\n`;
    const d = readOvertureContacts(parseCsv(csv));
    expect(d.acts.map((a) => a.name).sort()).toEqual(["Graham McKee", "Wonderlust"]);
    const graham = d.people.find((p) => p.firstName === "Graham")!;
    expect(graham).toMatchObject({ surname: "McKee", phone: "07700900123", acts: ["Graham McKee", "Wonderlust"], customer: false });
    expect(d.people.find((p) => p.firstName === "Rachel")).toMatchObject({ companies: ["The Crown"], jobTitle: "Manager" });
    expect(d.people.find((p) => p.firstName === "Hannah")?.customer).toBe(true);
    expect(d.companies.find((c) => c.name === "The Crown")).toMatchObject({ venue: true, city: "Bristol" });
    expect(d.companies.find((c) => c.name === "Suave Agency")?.venue).toBe(false);
  });

  it("adds the missing 0 to UK mobiles", () => {
    expect(tidyPhone("7700900123")).toBe("07700900123");
    expect(tidyPhone("+44 7700 900123")).toBe("+44 7700 900123");
  });
});
