import { runReversions } from "./rebuild-reversions";
const file = "packages/engine/src/io.ts", test = "packages/engine/test/redactor.test.ts";
await runReversions("ci-oidc-guards", [test], [
    { name: "scheme-poisons-public-urls", file, before: "if (n > schemeLength) parts.add(value.slice(0, n));", after: "parts.add(value.slice(0, n));", test, pattern: "OIDC credential metadata" },
    { name: "drop-meaningful-prefix-redaction", file, before: "if (n > schemeLength) parts.add(value.slice(0, n));", after: "/* fault: meaningful secret prefixes leak */", test, pattern: "URL-valued secrets" },
    { name: "drop-suffix-redaction", file, before: "parts.add(value.slice(-n));", after: "/* fault: secret suffixes leak */", test, pattern: "OIDC credential metadata" },
]);
