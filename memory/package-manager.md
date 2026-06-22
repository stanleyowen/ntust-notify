---
name: package-manager
description: Which package manager to use in the client/ workspace
metadata:
  type: project
---

The `client/` workspace tracks BOTH `package-lock.json` and `yarn.lock` in git, but **yarn is the active manager** (yarn.lock is updated more recently; `yarn add` works and warns about the stray npm lockfile).

**Why:** Mixing managers causes resolution drift; picking the wrong one rewrites the wrong lockfile.

**How to apply:** Use `yarn add` / `yarn build` / `yarn dev` in `client/`, not npm.
