"use client";

import { useEffect, useState } from "react";
import { removePushSubscription, savePushSubscription, sendTestPush } from "@/actions/push";

type State = "checking" | "unsupported" | "install" | "off" | "on" | "blocked";

function keyBytes(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function deviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows computer";
  return "Browser";
}

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const isInstalled = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Lets an artist turn on gig reminders as notifications on this phone. */
export function PushSetup({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<State>("checking");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    (async () => {
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!supported) return setState(isIos() && !isInstalled() ? "install" : "unsupported");
      if (Notification.permission === "denied") return setState("blocked");
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        const sub = await reg.pushManager.getSubscription();
        if (sub && Notification.permission === "granted") {
          // Make sure the server still has it (e.g. after the browser renewed it).
          await savePushSubscription(sub.toJSON() as never, deviceName());
          return setState("on");
        }
      } catch {
        // fall through: show the button and let the artist try
      }
      setState("off");
    })();
  }, []);

  async function turnOn() {
    setBusy(true);
    setNote("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub)
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey),
        });
      const res = await savePushSubscription(sub.toJSON() as never, deviceName());
      if (!res.ok) throw new Error("save failed");
      setState("on");
      setNote("Done. You'll get a reminder the week before and on the day of each gig.");
    } catch {
      setNote("That didn't work. Check notifications are allowed for this app in your phone's settings, then try again.");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    const { reached } = await sendTestPush();
    setNote(reached ? "Sent. It should appear in a few seconds." : "We couldn't reach this phone. Turn notifications off and on again.");
    setBusy(false);
  }

  async function turnOff() {
    setBusy(true);
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await removePushSubscription(sub.endpoint);
      await sub.unsubscribe();
    }
    setState("off");
    setNote("Notifications are off on this phone. You'll still get reminders by email.");
    setBusy(false);
  }

  if (state === "checking") return null;
  const btn = "flex h-12 w-full items-center justify-center rounded-xl text-[15px] font-medium transition disabled:opacity-50";

  return (
    <section className="rounded-2xl border border-white/[0.06] bg-ink-900 p-5" data-push-state={state}>
      <h2 className="text-sm font-medium text-ink-400">Gig reminders on this phone</h2>
      {state === "on" ? (
        <>
          <p className="mt-1 text-sm text-ink-300">On. You&apos;ll get your week of gigs each week and a reminder on the day of each gig.</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button onClick={test} disabled={busy} className={`${btn} border border-white/10 bg-white/[0.06] text-white hover:bg-white/[0.1]`}>
              Send a test
            </button>
            <button onClick={turnOff} disabled={busy} className={`${btn} text-ink-400 hover:text-white`}>
              Turn off
            </button>
          </div>
        </>
      ) : state === "off" ? (
        <>
          <p className="mt-1 text-sm text-ink-300">
            Get a list of next week&apos;s gigs each week, and a &ldquo;don&apos;t forget your gig&rdquo; reminder on the day.
          </p>
          <button onClick={turnOn} disabled={busy} className={`${btn} mt-4 bg-volt-400 text-ink-950 hover:bg-volt-300`}>
            {busy ? "Turning on…" : "Turn on reminders"}
          </button>
        </>
      ) : state === "install" ? (
        <>
          <p className="mt-1 text-sm text-ink-300">On iPhone, add Gigsaw to your Home Screen first. Then open it from there and turn reminders on.</p>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-ink-300">
            <li>
              Tap the <strong className="text-white">Share</strong> button in Safari (the square with an arrow).
            </li>
            <li>
              Tap <strong className="text-white">Add to Home Screen</strong>, then <strong className="text-white">Add</strong>.
            </li>
            <li>Open Gigsaw from your Home Screen and come back to this card.</li>
          </ol>
        </>
      ) : state === "blocked" ? (
        <p className="mt-1 text-sm text-ink-300">
          Notifications are blocked for Gigsaw on this phone. Allow them in your phone&apos;s settings (on iPhone: Settings, Notifications, Gigsaw), then come
          back here.
        </p>
      ) : (
        <p className="mt-1 text-sm text-ink-300">This browser can&apos;t show notifications. You&apos;ll still get reminders by email.</p>
      )}
      {note && <p className="mt-3 text-sm text-volt-400">{note}</p>}
    </section>
  );
}
