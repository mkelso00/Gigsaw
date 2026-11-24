import { describe, expect, it } from "vitest";
import { clientRecipient, isCustomerBooking, type ClientPayer, type LeadPerson } from "@/lib/client-recipient";

// Who a booking's client-facing messages go to (src/lib/client-recipient.ts): the booking's lead contact, then the
// venue's, then the company's, then the payer as before; wedding couples and private customers keep their own; and a
// company that doesn't want day-to-day emails at its own email gets none without a lead contact, but still gets documents.

const person = (id: string, o: Partial<LeadPerson> = {}): LeadPerson => ({
  id,
  firstName: id[0].toUpperCase() + id.slice(1),
  surname: "Smith",
  email: `${id}@venue.test`,
  phone: `07700 9000${id.length}`,
  ...o,
});
const company = (o: Partial<ClientPayer> = {}): ClientPayer => ({
  name: "Rekom accounts",
  company: "Rekom",
  email: "owner@rekom.test",
  phone: "0161 000 0000",
  type: "PROMOTER",
  ...o,
});
const couple = (o: Partial<ClientPayer> = {}): ClientPayer => ({
  name: "Hannah Jones",
  email: "hannah@couple.test",
  phone: "07700 900999",
  type: "CLIENT",
  ...o,
});

describe("clientRecipient", () => {
  it("uses the booking's own lead contact first", () => {
    const r = clientRecipient({
      clientContact: person("jo"),
      venue: { name: "The Swan", leadContact: person("sam") },
      promoter: company({ leadContact: person("kim") }),
    });
    expect(r).toMatchObject({ source: "BOOKING", personId: "jo", email: "jo@venue.test", firstName: "Jo", hint: "" });
    expect(r.label).toBe("Jo Smith, chosen for this booking");
  });

  it("falls back to the venue's lead contact, then the company's, then the company's own email", () => {
    const venue = { name: "The Swan", leadContact: person("sam") };
    expect(clientRecipient({ venue, promoter: company({ leadContact: person("kim") }) })).toMatchObject({
      source: "VENUE",
      personId: "sam",
      label: "Sam Smith, The Swan's lead contact",
    });
    expect(clientRecipient({ venue: { name: "The Swan" }, promoter: company({ leadContact: person("kim") }) })).toMatchObject({
      source: "COMPANY",
      personId: "kim",
      label: "Kim Smith, Rekom's lead contact",
    });
    expect(clientRecipient({ venue: { name: "The Swan" }, promoter: company() })).toMatchObject({
      source: "PAYER",
      personId: null,
      email: "owner@rekom.test",
      phone: "0161 000 0000",
      firstName: "Rekom",
      label: "Rekom, who pays",
    });
  });

  it("is nobody with no lead contact and no payer", () => {
    expect(clientRecipient({ venue: { name: "The Swan" } })).toMatchObject({ source: "NONE", email: "", phone: "" });
  });

  it("day to day, the first lead contact set wins even without an email (texts only), so the owners aren't emailed", () => {
    const noEmail = person("sam", { email: "" });
    const r = clientRecipient({ venue: { name: "The Swan", leadContact: noEmail }, promoter: company() });
    expect(r).toMatchObject({ source: "VENUE", email: "", phone: noEmail.phone, hint: "" });
    const nothing = clientRecipient({ venue: { name: "The Swan", leadContact: person("sam", { email: "", phone: "" }) }, promoter: company() });
    expect(nothing).toMatchObject({ source: "VENUE", email: "", phone: "" });
    expect(nothing.hint).toMatch(/no email or phone number/);
  });

  it("a document goes to the first lead contact with an email, else the company's own email with a hint", () => {
    const party = { venue: { name: "The Swan", leadContact: person("sam", { email: "" }) }, promoter: company({ leadContact: person("kim") }) };
    expect(clientRecipient(party, "DOCUMENT")).toMatchObject({ source: "COMPANY", email: "kim@venue.test" });
    const r = clientRecipient({ ...party, promoter: company() }, "DOCUMENT");
    expect(r).toMatchObject({ source: "PAYER", email: "owner@rekom.test" });
    expect(r.hint).toMatch(/no email/);
  });

  describe("a company that doesn't want day-to-day emails at its own email", () => {
    const quiet = company({ notifyOwner: false });

    it("is sent nothing day to day without a lead contact", () => {
      const r = clientRecipient({ venue: { name: "The Swan" }, promoter: quiet });
      expect(r).toMatchObject({ source: "NONE", email: "", phone: "" });
      expect(r.hint).toMatch(/nothing is sent/);
    });

    it("still gets documents (invoices, PO requests) at its own email, with a hint", () => {
      const r = clientRecipient({ venue: { name: "The Swan" }, promoter: quiet }, "DOCUMENT");
      expect(r).toMatchObject({ source: "PAYER", email: "owner@rekom.test" });
      expect(r.hint).toMatch(/still go to the company/);
    });

    it("has its lead contacts used as usual", () => {
      expect(clientRecipient({ venue: { name: "The Swan", leadContact: person("sam") }, promoter: quiet })).toMatchObject({ source: "VENUE" });
      expect(clientRecipient({ promoter: { ...quiet, leadContact: person("kim") } })).toMatchObject({ source: "COMPANY" });
    });
  });

  describe("wedding couples and private customers", () => {
    const venue = { name: "The Barn", leadContact: person("sam") };

    it("keep hearing themselves, whatever the venue's or company's lead contact", () => {
      for (const party of [
        { eventId: "e1", venue, promoter: couple() },
        { eventType: "WEDDING", venue, promoter: couple() },
        { eventType: "PRIVATE_PARTY", venue, promoter: couple() },
        { eventType: "GIG", venue, promoter: couple() },
        // A corporate do paid by a company: the company's own contact, not the venue's manager.
        { eventType: "CORPORATE", venue, promoter: company({ leadContact: person("kim") }) },
      ]) {
        const r = clientRecipient(party);
        expect(r.source).toBe("CUSTOMER");
        expect(r.personId).toBeNull();
        expect(r.email).toBe(party.promoter.email);
      }
    });

    it("never lose their messages to the notifyOwner switch", () => {
      expect(clientRecipient({ eventType: "CORPORATE", promoter: company({ notifyOwner: false }) })).toMatchObject({
        source: "CUSTOMER",
        email: "owner@rekom.test",
      });
    });

    it("hear through a lead contact only when one is set on the booking itself", () => {
      expect(clientRecipient({ eventType: "WEDDING", venue, promoter: couple(), clientContact: person("planner") })).toMatchObject({
        source: "BOOKING",
        email: "planner@venue.test",
      });
    });

    it("are told apart from venue gigs", () => {
      expect(isCustomerBooking({ eventId: "e1" })).toBe(true);
      expect(isCustomerBooking({ eventType: "WEDDING" })).toBe(true);
      expect(isCustomerBooking({ eventType: "GIG", promoter: couple() })).toBe(true);
      expect(isCustomerBooking({ eventType: "GIG", promoter: company() })).toBe(false);
      expect(isCustomerBooking({ eventType: "CLUB_NIGHT" })).toBe(false);
    });
  });
});
