import { expect, test } from "bun:test";
import { Redactor } from "../src/io";
const endpoint = "https://oidc.example.invalid/_apis/identity/job-fixture-123?api-version=2.0";
const bearer = "synthetic-bearer-credential-for-redaction-only";
test("OIDC credential metadata does not turn a public URL scheme into a secret", () => {
    const redactor = new Redactor(undefined, { ACTIONS_ID_TOKEN_REQUEST_URL: endpoint, ACTIONS_ID_TOKEN_REQUEST_TOKEN: bearer });
    const publicText = 'Read https://github.com/example/repository and https://fixture.invalid/source.git';
    expect(redactor.scrub(publicText)).toBe(publicText);
    expect(redactor.scrub(endpoint)).toBe("[REDACTED]");
    expect(redactor.scrub(bearer)).toBe("[REDACTED]");
    expect(redactor.scrub(endpoint.slice(0, 30))).toBe("[REDACTED]");
    expect(redactor.scrub(endpoint.slice(-24))).toBe("[REDACTED]");
    expect(redactor.scrub(bearer.slice(0, 18))).toBe("[REDACTED]");
    expect(redactor.scrub(bearer.slice(-18))).toBe("[REDACTED]");
});
test("URL-valued secrets retain their meaningful prefixes without masking common transport syntax", () => {
    for (const scheme of ["http://", "https://", "postgresql://"]) {
        const secret = scheme + "private-user:fixture-password@example.invalid/private-path";
        const redactor = new Redactor(undefined, { FIXTURE_SECRET_URL: secret });
        expect(redactor.scrub(scheme + "public.example.invalid/"), scheme).toBe(scheme + "public.example.invalid/");
        expect(redactor.scrub(secret), scheme).toBe("[REDACTED]");
        expect(redactor.scrub(secret.slice(0, scheme.length + 15)), scheme).toBe("[REDACTED]");
        expect(redactor.scrub(secret.slice(-20)), scheme).toBe("[REDACTED]");
    }
});
