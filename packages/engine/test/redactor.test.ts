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

test("a token's public type prefix is not a fragment of it; the token and its truncations still are (alpha.47)", () => {
    const github = "github_pat_11FIXTUREQWERTYzxcvbnmasdfgPLMOKNIJBUHVYGCTFX", gitlab = "glpat-" + "Zx9Qw8Er7Ty6Ui5Op4As";
    const r = new Redactor(undefined, { GITHUB_TOKEN: github, GITLAB_TOKEN: gitlab });
    for (const text of ['{"kind":"github","endpoint":"https://api.github.com"}', "https://github.com/acme/example", '{"kind":"gitlab","note":"glpat- tokens"}']) expect(r.scrub(text)).toBe(text);
    expect(r.scrub(`Bearer ${github}`)).toBe("Bearer [REDACTED]"); expect(r.scrub(`PRIVATE-TOKEN: ${gitlab}`)).toBe("PRIVATE-TOKEN: [REDACTED]");
    expect(r.scrub(`truncated ${github.slice(0, 24)}`)).toBe("truncated [REDACTED]"); expect(r.scrub(`tail ${github.slice(-12)}`)).toBe("tail [REDACTED]");
    expect(r.scrub(`truncated ${gitlab.slice(0, 12)}`)).toBe("truncated [REDACTED]");
});
