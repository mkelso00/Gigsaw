/**
 * Webpack loader: backports React's fix for a hydration bug in the React build that Next 15.5 bundles
 * (19.2.0-canary-0bdb9206-20250818, in next/dist/compiled/react-dom). Remove it once Next ships a React
 * with the fix (React 19.3 and Next 16 have it); the loader then finds nothing to change and does nothing.
 *
 * The bug: while hydrating, React claims a server-rendered element and moves its cursor to that element's
 * first child. If reconciling the element's children then suspends (a child is still streaming in: React
 * splits big server component output into rows of about 3 KB and sends the rest later as "$L" references)
 * and the data arrives before React gives up, React replays the element. Replaying runs beginWork again,
 * which claims the node at the cursor, which is now the element's first child. React reports "Hydration
 * failed" (#418, HTML), throws the server HTML away, and the streaming scripts that were still due to swap
 * in Suspense content then fail with "Cannot read properties of null (reading 'parentNode')".
 *
 * It only happens when hydration catches up with the HTML stream at exactly that spot, so it shows up on
 * roughly one first load in a few under load and never in `next dev` (no row splitting race there).
 *
 * React's fix (in 19.3's replayBeginWork): before replaying an element that is the current hydration
 * parent, put the cursor back on the element itself. This loader inserts the same lines.
 */

// The buggy shape, in both the production and the development builds: the HostComponent case of the replay
// function only resets hooks, then falls through to unwind and begin the work again.
const BUGGY = /case 5:(\s*)resetHooksOnUnwind\((\w+)\);(\s*)default:/g;
// Present once React has the fix.
const FIXED = /===\s*hydrationParentFiber\s*&&\s*\(\s*isHydrating\s*\?\s*\(\s*popToNextHostParent\(/;
const NEEDS = ["function popToNextHostParent", "hydrationParentFiber", "nextHydratableInstance", "isHydrating"];

/** Returns the patched source, the source unchanged if React already has the fix, or null if it doesn't look like the expected build. */
function patchReactDomClient(source) {
  if (FIXED.test(source)) return source;
  const matches = source.match(BUGGY);
  if (!matches || matches.length !== 1 || !NEEDS.every((n) => source.includes(n))) return null;
  return source.replace(
    BUGGY,
    (_, a, f, b) =>
      `case 5:${a}resetHooksOnUnwind(${f});${a}` +
      `/* Gigsaw: React 19.3's hydration replay fix, see scripts/react-hydration-fix.cjs */ ` +
      `${f} === hydrationParentFiber && (isHydrating ? (popToNextHostParent(${f}), null != ${f}.stateNode && (nextHydratableInstance = ${f}.stateNode)) : (popToNextHostParent(${f}), (isHydrating = !0)));` +
      `${b}default:`,
  );
}

module.exports = function reactHydrationFixLoader(source) {
  const patched = patchReactDomClient(source);
  if (patched === null) {
    this.emitWarning(new Error(`react-hydration-fix: ${this.resourcePath} doesn't match the React build this fix was written for; left unchanged.`));
    return source;
  }
  return patched;
};
module.exports.patchReactDomClient = patchReactDomClient;
