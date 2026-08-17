# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Remotes

- `origin` → `https://github.com/SeattleDiver/n8n-nodes-nodeflex.git` — **development** repo. All local branching and pushing happens here.
- `nodeflex` → `https://github.com/NodeFlexIO/n8n-nodes-nodeflex.git` — **publish** repo. Releases are pushed here deliberately, not as a side effect of routine development.

Whenever branching or pushing (e.g. `git checkout -b`, `git push`), remind the user that `origin` (SeattleDiver) is the designated development repo, and confirm before pushing to `nodeflex` (NodeFlexIO) since that is the publish target.
