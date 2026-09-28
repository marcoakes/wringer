import type { Page } from "playwright";

/** Durable admission audits the prepared bundle. Native design rehearsals
 * measured 14–19.2 seconds; allow twice the former 20-second UI action budget.
 * This bounds observation only: never click again or infer publication. */
export function waitForSendAdmission(page: Page) {
    return page.waitForResponse(response => new URL(response.url()).pathname === "/api/job/send" && response.request().method() === "POST", { timeout: 40000 });
}
