import { readFile, appendFile, mkdir, mkdtemp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function actionSelection(env, version) {
  const mode = env.WRINGER_MODE ?? 'binary', ref = env.WRINGER_ACTION_REF ?? '';
  if (!['binary', 'source'].includes(mode)) throw new Error('Select binary or explicit source development mode');
  if (mode === 'binary' && ref !== `v${version}` && !/^[a-f0-9]{40}$/.test(ref)) throw new Error('Binary mode requires an exact action release tag or commit; local/branch development requires mode: source');
  if ((env.WRINGER_CONFIG ?? '.wringer.yaml') !== '.wringer.yaml') throw new Error('Only repository-owned .wringer.yaml is supported');
  const gates = JSON.parse(env.WRINGER_SELECTION ?? '[]');
  if (!Array.isArray(gates) || gates.length > 64 || new Set(gates).size !== gates.length || gates.some(g => typeof g !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(g))) throw new Error('selection must be a bounded JSON array of distinct gate IDs');
  const prove = env.WRINGER_PROVE ?? 'false'; if (!['true', 'false'].includes(prove)) throw new Error('prove must be true or false');
  return { mode, ref, version, gates, prove: prove === 'true' };
}
function launch(command, cwd, env) {
  const child = spawnSync(command[0], command.slice(1), { cwd, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 30 * 60 * 1000 });
  return { exit: child.status ?? 2, stdout: child.stdout ?? '', stderr: child.stderr ?? '', error: child.error?.message ?? null };
}
export async function runVerification({ launcher, repo, output, selection, env }) {
  if ([output, env.GITHUB_OUTPUT, env.GITHUB_STEP_SUMMARY].some(v => v && /[\r\n\0]/.test(v))) throw new Error('Action output paths must not contain line breaks');
  const argv = [...launcher, 'verify', '--repo', repo, '--output', output, '--strict', '--json'];
  if (selection.prove) argv.push('--prove');
  for (const id of selection.gates) argv.push('--gate', id);
  const result = launch(argv, repo, env);
  // GitHub's command channel must not interpret repository check output.
  const token = `wringer-${randomUUID()}`;
  process.stdout.write(`::stop-commands::${token}\n`);
  process.stdout.write(result.stdout); process.stderr.write(result.stderr);
  process.stdout.write(`\n::${token}::\n`);
  let observed = null; try { observed = JSON.parse(result.stdout); } catch {}
  const coverage = selection.gates.length ? `Partial selection (${selection.gates.length} gates); omitted checks remain unevidenced.` : 'Full configured selection requested; inspect evidence for missing, optional and inconclusive checks.';
  const status = result.exit;
  // Report failures are visible, but cannot convert the verifier's real status.
  const reporting = [];
  if (env.GITHUB_OUTPUT) try { await appendFile(env.GITHUB_OUTPUT, `evidence-dir=${output}\nexit-code=${status}\n`); } catch { reporting.push('Could not write action outputs'); }
  if (env.GITHUB_STEP_SUMMARY) try {
    const proof = observed?.acceptance?.status;
    await appendFile(env.GITHUB_STEP_SUMMARY, `### Wringer verification\n\nExit code: **${status}**. ${coverage}\n\nProof requested: **${selection.prove ? 'yes' : 'no'}**. ${['passed', 'failed', 'inconclusive'].includes(proof) ? `Recorded acceptance assessment: **${proof}**.` : 'No complete requirement proof is inferred from this summary.'}\n\nRepository commands ran trusted-local on this runner. Human acceptance and publication are separate; this Action does neither.\n`);
  } catch { reporting.push('Could not write job summary'); }
  for (const failure of reporting) process.stderr.write(`${failure}; verification exit remains ${status}\n`);
  return { ...result, reporting, output, observed };
}
export async function actionMain(env = process.env) {
  const actionRoot = resolve(env.WRINGER_ACTION_ROOT ?? join(fileURLToPath(new URL('.', import.meta.url)), '..'));
  const pkg = JSON.parse(await readFile(join(actionRoot, 'package.json'), 'utf8'));
  const selection = actionSelection(env, pkg.version), repo = resolve(env.WRINGER_REPOSITORY ?? '.');
  const temporary = resolve(env.RUNNER_TEMP ?? '/tmp');
  const work = await mkdtemp(join(temporary, 'wringer-action-'));
  let launcher;
  if (selection.mode === 'source') launcher = [join(actionRoot, 'dist/wring')];
  else {
    const shell = ['/bin/sh', join(actionRoot, 'packaging/install.sh'), '--release', selection.version, '--download-to', join(work, 'download'), '--prefix', join(work, 'install'), '--app-dir', join(work, 'state')];
    const prepared = launch(shell, work, env); if (prepared.exit !== 0) throw new Error(`Release download/preview failed: ${prepared.stderr}`);
    const preview = JSON.parse(prepared.stdout);
    if (!preview.eligible) throw new Error('Release installation is held');
    // Pinned action commits must point at the artifact source commit too.
    if (/^[a-f0-9]{40}$/.test(selection.ref)) {
      const metadata = JSON.parse(await readFile(join(actionRoot, 'package.json'), 'utf8'));
      if (metadata.version !== selection.version) throw new Error('Action version changed during preparation');
      // The installed archive verifier exposes exact build provenance in its preview.
      if (preview.source?.commit !== selection.ref) throw new Error('The release artifact was not built from this pinned action commit');
    }
    const installed = launch([...shell, '--apply', '--expected', preview.identity], work, env);
    if (installed.exit !== 0) throw new Error(`Release install failed: ${installed.stderr}`);
    launcher = [join(work, 'install/bin/wring')];
  }
  const output = join(repo, '.wringer/runs', `action-${randomUUID()}`);
  const result = await runVerification({ launcher, repo, output, selection, env }); return result.exit;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  actionMain().then(code => { process.exitCode = code; }, error => { process.stderr.write(`Wringer Action: ${error.message}\n`); process.exitCode = 2; });
}
