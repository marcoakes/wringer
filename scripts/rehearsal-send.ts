import type { Page } from "playwright";

/** Admission re-checks the prepared bundle's seal before it answers. A local
 * design Send took 15.8 s on an M1 at alpha.40 and over 40 s on macos-15, when
 * every read re-ran the full audit; 2.4 s at alpha.41. Back to the 20-second UI
 * action budget, so a slow admission fails here rather than on a person's page.
 * This bounds observation only: never click again or infer publication. */
export function waitForSendAdmission(page: Page) {
    return page.waitForResponse(response => new URL(response.url()).pathname === "/api/job/send" && response.request().method() === "POST", { timeout: 20000 });
}
