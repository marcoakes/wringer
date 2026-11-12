# Try Wringer

Thank you for testing. Wringer sits beside your coding agent (Claude Code or Codex).
You write a request; Wringer has your agent make the change in a fresh copy of your
repository, runs your tests, which must have failed before the change, and has a
second agent session review the result. You approve the request, read the change, and
press Send. Send pushes a branch and can open a pull request whose description is the
evidence, which anyone can audit from a fresh clone.

This takes about 20 minutes. Step 3 builds a tiny sample repository so you see the
whole loop first; step 6 points Wringer at a repository of yours.

**Read this first.** This is an early prerelease. Your agent and your tests run on your
computer, under your account, in temporary copies of the repository; nothing is
contained. Do not try it on code or credentials you cannot risk. It uses your own Claude
Code or Codex plan: the sample job took one worker and one review session.

## 1. What you need

- A Mac with Apple silicon, or Linux on x64. Windows is not supported.
- Git, and Node.js 22 or later with `npx`.
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) or Codex installed and
  signed in. Wringer uses that login; it never asks for an API key.

## 2. Install

```sh
cd ~
curl -fsSLO https://raw.githubusercontent.com/marcoakes/wringer/v1.0.0-alpha.47/packaging/install.sh
less install.sh
```

The installer is 98 lines of shell; read it before running it, and press `q` to leave
`less`. Then:

```sh
sh install.sh --release 1.0.0-alpha.47 --download-to "$HOME/wringer-download-47" > "$HOME/wringer-install-preview.json"
```

That downloads the release from GitHub, checks it, and writes a preview of what it
would install. Nothing is installed yet. To install exactly what it previewed:

```sh
ID=$(sed -n 's/.*"identity": *"\([0-9a-f]*\)".*/\1/p' "$HOME/wringer-install-preview.json" | head -1)
sh install.sh --release 1.0.0-alpha.47 --download-to "$HOME/wringer-download-47" --apply --expected "$ID"
```

The installer changes no shell profile. Put Wringer on your PATH for this terminal.
On macOS:

```sh
export PATH="$HOME/Library/Application Support/WringerInstall/bin:$PATH"
```

On Linux:

```sh
export PATH="$HOME/.local/share/wringer-install/bin:$PATH"
```

Then check it runs:

```sh
wring --version
wring demo
```

`wring demo` uses no model and no account; it shows what a checked result looks like.

## 3. Make the sample repository

A slug function, a test it fails, and a local stand-in for GitHub to send to:

```sh
TRY="$HOME/wringer-try"
mkdir -p "$TRY" && cd "$TRY"
git init -q --bare first-job-origin.git
git init -q -b main first-job && cd first-job
mkdir src test
cat > package.json <<'EOF'
{ "name": "first-job", "private": true, "type": "module", "scripts": { "test": "node --test" } }
EOF
cat > src/slug.js <<'EOF'
export function slug(title) {
  return title.toLowerCase().replace(/[^a-z0-9]/g, '-');
}
EOF
cat > test/slug.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slug } from '../src/slug.js';
test('slug keeps letters and digits, joined by single hyphens', () => {
  assert.equal(slug('Hello, World!'), 'hello-world');
  assert.equal(slug('  Release 1.0  notes '), 'release-1-0-notes');
});
EOF
git add -A && git commit -qm "A slug function and a test it fails"
npm test || echo "It fails: good. Wringer needs a check that fails before the change."
wring init
git add .wringer.yaml .gitignore && git commit -qm "Add Wringer's check file"
git remote add origin "$TRY/first-job-origin.git" && git push -q -u origin main
```

`wring init` finds your test command and writes it to `.wringer.yaml`.

## 4. Set it up

Say which coding agent you use. For Claude Code:

```sh
CLIENT=claude-code ADAPTER=claude-agent-acp
```

For Codex, run this line instead:

```sh
CLIENT=codex ADAPTER=codex-acp
```

Then preview the setup and read it:

```sh
SETUP=(--repo "$PWD" --client "$CLIENT" --mode delegation --runtime trusted-local
  --worker-adapter "$ADAPTER" --judge-adapter "$ADAPTER"
  --source local --dependencies none --writable src --remote origin --base main)
wring setup "${SETUP[@]}" --dry-run --json > ../setup-preview.json
less ../setup-preview.json
```

It names the agents, the check, what the worker may change and where a finished job is
sent. Press `q`, then apply exactly what you read and check the agents start:

```sh
ID=$(sed -n 's/.*"identity": *"\([0-9a-f]*\)".*/\1/p' ../setup-preview.json | head -1)
wring setup "${SETUP[@]}" --apply --expected "$ID" --actor "$USER" --cooperative-local --json > ../setup.json
WID=$(grep -o '"id": *"[0-9a-f-]*"' ../setup.json | head -1 | tr -d '" ' | cut -d: -f2)
wring job check --workspace "$WID"
```

`job check` starts each agent and sends no prompt. The first run downloads the agent
adapter through `npx`. If you have both agents, you may mix them: name one in
`--worker-adapter` and the other in `--judge-adapter`, so a different model reviews
the work.

## 5. Run a job

Write your request once, here. Then connect your agent and open the job page:

```sh
wring job new --workspace "$WID" --intent "Make slug() join words with single hyphens and trim them from the ends, so the slug test passes."
wring connect --workspace "$WID" --client "$CLIENT" --scope project --dry-run --json > ../connect-preview.json
ID=$(sed -n 's/.*"identity": *"\([0-9a-f]*\)".*/\1/p' ../connect-preview.json | head -1)
wring connect --workspace "$WID" --client "$CLIENT" --scope project --apply --expected "$ID"
wring job open --workspace "$WID"
```

`job open` opens your private job page in the browser and leaves Wringer running in
the background until `wring job close`. In the same folder, start your agent:

- **Claude Code:** run `claude` and accept the project's `wringer` server when it asks.
- **Codex:** run `codex` and trust the folder when it asks; Codex reads a project's
  settings only in a folder it trusts. It then asks before each Wringer tool that
  records something. Allow them.

Then say:

> Use Wringer to do the job I prepared.

Your agent records the request and points you to the page. On the page:

1. **Approve** the request and its limits. The work starts by itself.
2. Wait a minute or two. Wringer may stop to ask you something; the page says what.
3. **Read the change** and press **Send**. It pushes a branch, here to the local stand-in.

See what arrived, and audit it from a fresh clone; the page shows the exact commands:

```sh
git fetch -q origin && git branch -r
```

**Coming back in a new terminal?** The PATH and the variables are gone. Run the
`export PATH` line from step 2 again, then list your jobs:

```sh
wring job list
```

Each job is printed with its `workspaceId`. Set `WID` to it, and `CLIENT` as in step 4,
then `wring job open --workspace "$WID"` reopens the page.

## 6. Try it on your own repository

Pick a small change and commit a test that fails today; Wringer refuses work whose
check already passes. Run `wring init`, commit `.wringer.yaml`, then steps 4 and 5 with
your folders in `--writable` (repeat it for each) and, for an npm project,
`--dependencies npm-ci`.

To have Send open a GitHub pull request, add these to `SETUP`:
`--forge github --forge-repo OWNER/NAME --forge-token-env GITHUB_TOKEN`. Then start
Wringer with your GitHub CLI login's token, which it reads at Send and never stores:

```sh
wring job close --workspace "$WID"
GITHUB_TOKEN="$(gh auth token)" wring job open --workspace "$WID"
```

The first line stops a Wringer that was started without the token.

## Rough edges we know about

- Without `--remote` and `--base` at setup, a finished job has nowhere to go: the page
  says nothing can be sent, and the change stays in Wringer's records.
- Your request is fixed when you run `wring job new`. If you ask your agent in other
  words, Wringer keeps the job's wording and the agent says so.
- If your repository's history holds a test value shaped like a key or token, the job
  stops once before Send and lists each match by file. Give a reason for each on the
  page, or do not send if one is real.
- A mistyped workspace ID prints a raw "no such file" error.
- If the page says it is locked and `wring job open` does not unlock it, run
  `wring job close --workspace "$WID"` and open it again. Your jobs are kept.

## 7. Tell us how it went

[Open a tester report](https://github.com/marcoakes/wringer/issues/new?template=tester-report.yml).
Where you got stuck matters most, even if you got past it. Never paste keys, tokens,
private page links or private source.

## When you are done

Stop Wringer and take its connection out of the repository, from the repository's
folder. This removes exactly the files `wring connect` added:

```sh
wring job close --workspace "$WID"
wring connect --workspace "$WID" --client "$CLIENT" --scope project --remove --dry-run --json > ../remove-preview.json
ID=$(sed -n 's/.*"identity": *"\([0-9a-f]*\)".*/\1/p' ../remove-preview.json | head -1)
wring connect --workspace "$WID" --client "$CLIENT" --scope project --remove --apply --expected "$ID"
```

To remove Wringer itself, preview it first:

```sh
wring uninstall --dry-run --json
```

It lists what it would remove and anything still in the way. Repeat it with
`--apply --expected IDENTITY`, using the `identity` it printed. Your jobs and their
evidence stay in Wringer's application folder until you delete it.
