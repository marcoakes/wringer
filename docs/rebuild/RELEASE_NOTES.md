Wringer 1.0.0-alpha.41 fixes the slow Send that alpha.40 listed as a known issue.
Send on the job page now answers in seconds, and every step that runs Git is faster.

**Send answers in seconds.** On an M1 Mac, Send for a local design job was answered
in 2.4 s, down from 15.8 s on the same machine at alpha.40. On GitHub's macOS 15
runners it had passed 40 s, close to the 45 s at which the job page gives up on a
decision. The whole local design rehearsal now takes 62 s on the M1, down from 145 s.

**Why it was slow.** Every page refresh re-ran the full audit of the same prepared
handover, and Send ran it four more times before answering. That is about 3 s each,
mostly Git, and every command waited 100 ms after it had already exited.

- A read now re-checks every byte of the prepared bundle against its sealed digest
  index, and reuses a passed audit only when the bundle is identical. Anything else
  is audited in full. `wringer-drive audit` and the fresh-clone audit always run in
  full.
- A command that exits with nothing left running returns at once. The 100 ms grace,
  and the forced stop after it, still apply to anything it leaves behind. A Git call
  takes about 9 ms instead of about 120 ms.

**Rehearsed where it is built.** The macOS archive is built on macOS 15, and its
rehearsals run there again, in the release and on every push. The rehearsal's bound
on a Send answer is back to 20 s, so a slow admission fails a rehearsal before it
reaches a person's page.

**How it was tested.** Each fix has a test that failed before it and passes after:

- In the test fixture, a repeated read of an unchanged bundle ran all 15 of the
  audit's Git commands again. It now runs none, and a changed byte is still refused.
- Five empty commands took 581 ms, and now take about 20 ms. A leftover process that
  ignores the polite stop is still stopped.

Five guards were each removed alone in a scratch copy, and each turned its test red:
the reuse itself, a reused view shared with its caller, reuse for different bytes, the
grace after every exit, and a leftover process that ignores the polite stop. No
record or schema changed.

**Not measured:** a live model run, or how long Send takes on a person's own Mac.

Native macOS arm64 and Linux x64 archives retain checksums, inventories, signed
provenance and exact-artifact claim reports. GitHub publication does not itself
publish an npm package, Homebrew tap or MCP registry listing. The documented
cooperative-local operator boundary remains.

[Start from your coding agent](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.41/docs/START_AGENT.md)
· [Trusted-local](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.41/docs/native/TRUSTED_LOCAL.md)
· [Previous release: doors that lead somewhere](https://github.com/marcoakes/wringer/releases/tag/v1.0.0-alpha.40)
