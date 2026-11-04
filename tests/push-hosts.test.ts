import { describe, expect, it } from "vitest";
import { isPushEndpoint } from "@/lib/push-hosts";

describe("isPushEndpoint", () => {
  it("allows the browsers' push services", () => {
    expect(isPushEndpoint("https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91bHPRgkF3JUikC4ENAHEeMrd41Zxv3hVZjC9KtT8OvPVGJ")).toBe(true);
    expect(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/gAAAAABk")).toBe(true);
    expect(isPushEndpoint("https://web.push.apple.com/QGuQyavXutnMH5Rq6dTxk0Ql2yAUb4u8G2gBy7")).toBe(true);
    expect(isPushEndpoint("https://api.push.apple.com/3/device/abc")).toBe(true);
    expect(isPushEndpoint("https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB%2b2f%3d")).toBe(true);
    expect(isPushEndpoint("https://eu.push.services.mozilla.com/wpush/v2/x")).toBe(true);
  });

  it("refuses any other host", () => {
    expect(isPushEndpoint("https://example.com/push")).toBe(false);
    expect(isPushEndpoint("https://localhost/push")).toBe(false);
    expect(isPushEndpoint("https://10.0.0.5/push")).toBe(false);
    expect(isPushEndpoint("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isPushEndpoint("https://[::1]/push")).toBe(false);
    expect(isPushEndpoint("https://postgres.railway.internal/")).toBe(false);
  });

  it("isn't fooled by look-alike hosts", () => {
    expect(isPushEndpoint("https://fcm.googleapis.com.evil.com/x")).toBe(false);
    expect(isPushEndpoint("https://evilfcm.googleapis.com/x")).toBe(false);
    expect(isPushEndpoint("https://evilpush.apple.com/x")).toBe(false);
    expect(isPushEndpoint("https://notify.windows.com.evil.com/x")).toBe(false);
    expect(isPushEndpoint("https://notify.windows.com/x")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com./x")).toBe(false);
  });

  it("refuses user names, passwords, ports and other schemes", () => {
    expect(isPushEndpoint("https://evil.com@fcm.googleapis.com/x")).toBe(false);
    expect(isPushEndpoint("https://user:pass@fcm.googleapis.com/x")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com@evil.com/x")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com:8443/x")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com:443/x")).toBe(false);
    expect(isPushEndpoint("http://fcm.googleapis.com/x")).toBe(false);
    expect(isPushEndpoint("ftp://fcm.googleapis.com/x")).toBe(false);
  });

  it("refuses addresses that aren't written the way they parse", () => {
    expect(isPushEndpoint("https://FCM.googleapis.com/x")).toBe(false);
    expect(isPushEndpoint("https://evil.com\\@fcm.googleapis.com/x")).toBe(false);
    expect(isPushEndpoint(" https://fcm.googleapis.com/x")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com/x\n")).toBe(false);
  });

  it("refuses junk", () => {
    expect(isPushEndpoint("")).toBe(false);
    expect(isPushEndpoint("not a url")).toBe(false);
    expect(isPushEndpoint(`https://fcm.googleapis.com/${"a".repeat(2000)}`)).toBe(false);
  });
});
