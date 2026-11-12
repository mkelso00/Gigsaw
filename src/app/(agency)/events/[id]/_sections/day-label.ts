/** A YYYY-MM-DD day as words. Read at noon UTC so the day never slips in any time zone. */
export const dayLabel = (key: string, opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long", year: "numeric" }) =>
  new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));
