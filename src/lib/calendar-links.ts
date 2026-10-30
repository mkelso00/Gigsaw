// One-click "subscribe" links for a private calendar feed. Subscribed calendars update by themselves.

export function calendarLinks(feedUrl: string, name: string) {
  const webcal = feedUrl.replace(/^https?:\/\//, "webcal://");
  const fromWeb = (host: string) => `https://${host}/calendar/0/addfromweb?url=${encodeURIComponent(feedUrl)}&name=${encodeURIComponent(name)}`;
  return {
    /** Apple Calendar, and most other calendar apps, open webcal:// links as a subscription. */
    webcal,
    google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
    /** Outlook.com, Hotmail and Live accounts. */
    outlook: fromWeb("outlook.live.com"),
    /** Microsoft 365 work or school accounts. */
    outlook365: fromWeb("outlook.office.com"),
  };
}
