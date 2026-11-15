---
name: package-manager
description: Which package manager to use in the client/ workspace
metadata:
  type: project
---

The `client/` workspace uses **yarn** and tracks only `yarn.lock` (the stray npm `package-lock.json` was removed). It needs Node ≥ 24.12; `client/.nvmrc` pins 24.

**Why:** Mixing managers causes resolution drift; picking the wrong one rewrites the wrong lockfile.

**How to apply:** Use `yarn add` / `yarn build` / `yarn dev` in `client/`, not npm.
