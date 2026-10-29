import { describe, expect, it } from "vitest";
import { fillPlaceholders, messageFor } from "@/lib/message-templates";
import { prefsFromForm, wants } from "@/lib/notify-prefs";

describe("message templates", () => {
  it("fills placeholders and leaves unknown ones visible", () => {
    expect(fillPlaceholders("Hi {first_name}, {act} at {venue} {oops}", { first_name: "Jo", act: "Wonderlust", venue: "The Crown" })).toBe(
      "Hi Jo, Wonderlust at The Crown {oops}",
    );
    expect(fillPlaceholders("Hi {first_name}, hello", { first_name: "" })).toBe("Hi , hello");
  });
  it("uses Gigsaw's wording unless the business changed it, and can be switched off", () => {
    expect(messageFor({}, "OFFER", {})).toEqual({ on: true, subject: undefined, intro: undefined, text: undefined });
    const t = messageFor({ OFFER: { subject: "Fancy {venue}?", intro: "  " } }, "OFFER", { venue: "The Swan" });
    expect(t).toMatchObject({ on: true, subject: "Fancy The Swan?", intro: undefined });
    expect(messageFor({ BOOKED: { off: true } }, "BOOKED", {}).on).toBe(false);
  });
});

describe("personal alert choices", () => {
  it("are on unless turned off", () => {
    expect(wants({}, "LATE", "text")).toBe(true);
    expect(wants({ LATE: { text: false } }, "LATE", "text")).toBe(false);
    expect(wants({ LATE: { text: false } }, "LATE", "email")).toBe(true);
    const f = new FormData();
    f.set("LATE:email", "on");
    expect(prefsFromForm(f)).toMatchObject({ LATE: { email: true, text: false }, ACCEPTED: { email: false } });
  });
});
