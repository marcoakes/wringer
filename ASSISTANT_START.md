# Start with your coding assistant

The adoption entry is [docs/START_AGENT.md](docs/START_AGENT.md): explicitly choose
verification or contained delegation, prepare a workspace, open its review page,
and preview the scoped client connection. Existing assistant commands remain
available through `wring assistant --help` for retained legacy controllers.

[Consumer-agent contract](USING_WRINGER.md) · [Installation](INSTALL.md) ·
[Compatibility and historical journeys](docs/ASSISTANT_COMPATIBILITY.md) ·
[Operator/recovery guide](docs/START_OPERATOR.md)

Earlier releases required manually authored profiles. The guided runtime/setup
route now prepares them from explicit selections. Live containment and named
client acceptance remain separately measured; see [EVIDENCE.md](EVIDENCE.md).

## Retained explicit-profile route

Existing operator-authored plans remain supported. For a local-only repository,
the contributor build can prepare a pinned Git bundle with this exact command:

```sh
./dist/wringer-assistant prepare --from-plan ABS_EXISTING_PROFILE --repo ABS_REPO --image DIGEST_QUALIFIED_IMAGE --output ABS_NEW_PROFILE --root ABS_CONTROLLER --local
```

Replace each uppercase value with its reviewed absolute path or measured image
reference. With an installed product, use `wring assistant` in place of
`./dist/wringer-assistant`. Keep the output and controller outside the repository.
This prepares data; it grants no execution and establishes no runtime readiness.
Use the guided [operator entry](docs/START_OPERATOR.md) for a new standard setup.
