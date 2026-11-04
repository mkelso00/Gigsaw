import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The webpack loader that backports React's hydration replay fix (see scripts/react-hydration-fix.cjs).
const require = createRequire(import.meta.url);
const { patchReactDomClient } = require("../scripts/react-hydration-fix.cjs") as { patchReactDomClient: (source: string) => string | null };

const compiled = (channel: string, build: string) =>
  readFileSync(path.join(path.dirname(require.resolve("next/package.json")), "dist/compiled", channel, "cjs", `react-dom-client.${build}.js`), "utf8");

describe("React hydration replay fix", () => {
  for (const channel of ["react-dom", "react-dom-experimental"])
    for (const build of ["production", "development"])
      it(`patches the ${channel} ${build} build Next bundles, once`, () => {
        const source = compiled(channel, build);
        const patched = patchReactDomClient(source);
        // null means Next's React changed shape. If the new React has the fix, the loader returns it unchanged
        // and this test should be updated (or the loader removed); otherwise the fix needs porting again.
        expect(patched).not.toBeNull();
        if (patched === source) return; // already fixed upstream
        expect(patched).toContain("nextHydratableInstance = ");
        expect(patchReactDomClient(patched!)).toBe(patched);
      });

  it("puts the hydration cursor back on the element being replayed", () => {
    const source = `function replay(unitOfWork) {
  switch (unitOfWork.tag) {
    case 5:
      resetHooksOnUnwind(unitOfWork);
    default:
      unwindInterruptedWork(current, unitOfWork);
  }
}
function popToNextHostParent(fiber) {}
var hydrationParentFiber = null, nextHydratableInstance = null, isHydrating = !1;`;
    const out = patchReactDomClient(source)!;
    expect(out).toContain(
      "unitOfWork === hydrationParentFiber && (isHydrating ? (popToNextHostParent(unitOfWork), null != unitOfWork.stateNode && (nextHydratableInstance = unitOfWork.stateNode))",
    );
    expect(out.indexOf("hydrationParentFiber &&")).toBeLessThan(out.indexOf("default:"));
  });

  it("leaves a React that doesn't match alone", () => {
    expect(patchReactDomClient("case 5: somethingElse(); default:")).toBeNull();
  });
});
