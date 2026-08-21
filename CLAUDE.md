# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Remotes

- `origin` → `https://github.com/SeattleDiver/n8n-nodes-nodeflex.git` — **development** repo. All local branching and pushing happens here.
- `nodeflex` → `https://github.com/NodeFlexIO/n8n-nodes-nodeflex.git` — **publish** repo. Releases are pushed here deliberately, not as a side effect of routine development.

Whenever branching or pushing (e.g. `git checkout -b`, `git push`), remind the user that `origin` (SeattleDiver) is the designated development repo, and confirm before pushing to `nodeflex` (NodeFlexIO) since that is the publish target.

## Publishing a release ("publish this branch")

When the user asks to publish/release (e.g. "publish this branch", "cut a release", "publish development"), run the process below. It exists because the two repos have incompatible layouts: `development` nests the package under `n8n-nodes-nodeflex/` (this is a wrapper checkout), while `nodeflex`'s `main` is the flat, standalone layout that `npm publish` and n8n's Cloud verification actually see. A raw `git push` between them would corrupt one side, so the sync goes through a `git subtree split` instead.

**Defaults** (do these without asking, unless the user says otherwise for this run):
- Source branch is always `development` on `origin` — switch to it first (stashing/asking about any uncommitted work first) regardless of what's currently checked out.
- Version bump is always **patch**. Only use minor/major if the user explicitly asks for it in the same request.

**Procedure:**

1. **Preflight.** `git checkout development`, confirm the working tree is clean, `git pull origin development` (fast-forward only).
2. **Split.** From `development`, run `git subtree split --prefix=n8n-nodes-nodeflex -b sync-tmp` to produce a flat-layout branch matching `nodeflex/main`'s structure.
3. **Stage in a scratch clone.** Clone `nodeflex` (the NodeFlexIO repo) into a throwaway directory (e.g. under the scratchpad), checked out to `main`. Pull `sync-tmp` into it and replace its tree with a single new commit on top of `main`'s current tip (`git read-tree -u --reset sync-tmp && git commit`) — this is a normal, fast-forwardable commit, never a forced history rewrite.
4. **Bump the version.** In that clone: bump `package.json`'s version (patch by default), run `npm ci`, `npm run lint`, `npm run build`, `npm test` to confirm everything is green, regenerate the changelog (`npx auto-changelog -p`), then `git commit -am "Release X.Y.Z"` and `git tag X.Y.Z`.
   - Note: this replicates `npm run release` (`n8n-node release`) manually rather than invoking it directly, because that command hard-requires the branch literally be named `main` and prompts interactively for the bump — neither of which works unattended from Claude Code. The user can still run `npm run release` by hand from the scratch clone afterward if they want its interactive GitHub-release-creation step; the automated flow below does not create a GitHub Release entry.
5. **Stop and confirm.** Before pushing anything to `nodeflex`, show the user: old → new version, the file/commit diff being synced, and the exact push that's about to happen. Wait for explicit go-ahead — this step is irreversible (it triggers a real npm publish).
6. **Push.** On confirmation: `git push origin main --follow-tags` from the scratch clone (`origin` here being `nodeflex`, as remembered in that clone). This push to `main` triggers `ci.yml` (build/lint/test), and the tag push triggers `publish.yml`, which publishes to npm with provenance via GitHub Actions.
7. **Sync back into `development`.** Immediately after pushing, bring the release back into `development` so it never drifts behind `nodeflex/main` again:
   - Back on `development`, copy the release-relevant files out of `nodeflex/main` into the `n8n-nodes-nodeflex/` prefix: `package.json`, `package-lock.json` (new version), and `CHANGELOG.md` (regenerated changelog), plus any genuine content changes made directly on `nodeflex/main` since the last sync (e.g. a README edit).
   - Do **not** port over changes that exist only because of the flat publish-repo layout — most notably any trimming of dev-only tooling/tests or `.gitignore` entries for them. `development` is the wrapper checkout and keeps its full test suite; `nodeflex/main` deliberately strips it for the published package.
   - `git subtree pull` will refuse this with "unrelated histories" (the split branch was never recorded via `git subtree add`, so there's no shared merge base) — don't fight it. Diff the common files between `development`'s prefix and `nodeflex/main` directly (e.g. `git show nodeflex/main:<path>` vs the working-tree file) and copy over just the files that actually changed.
   - Commit the result on `development` and push to `origin` (SeattleDiver) — confirm with the user first per the remotes rule above.
8. **Report back.** Link the GitHub Actions run(s) and the npm package page so the user can watch the build/publish finish; mention that no GitHub Release was created automatically if step 4's note applies, and confirm the `development` sync commit was pushed.
