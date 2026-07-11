# Releasing, versioning & rollback

## Versioning
- Version lives in the `VERSION` file (SemVer `MAJOR.MINOR.PATCH`) and is served
  at `GET /version` and shown in the app header (`· vX.Y.Z`).
- Bump it in the same commit as the change set:
  - **PATCH** — fixes, no behaviour change for users.
  - **MINOR** — new backward-compatible features (most of what we ship).
  - **MAJOR** — breaking changes.

## Branches
- **`main`** — integration. PRs merge here; CI runs. Does **not** deploy.
- **`production`** — the live website. A push here deploys to the VM. Nothing
  else deploys.

## Cutting a release
1. Update `VERSION` and add a section to `CHANGELOG.md`.
2. Merge to `main` via PR (CI runs).
3. **Promote to production** to go live (see below).
4. Tag it and push the tag (or let the Tag & Release workflow do it):
   ```bash
   git tag -a v1.2.0 -m "v1.2.0 — <summary>"
   git push origin v1.2.0
   ```
   (Optionally create a GitHub Release from the tag for release notes.)

## PR workflow (into main)
`main` is protected — no direct pushes. All changes go through a pull request:
```bash
git checkout -b feature/my-change
# ...work, commit...
git push -u origin feature/my-change
# open a PR into main; CI (.github/workflows/ci.yml) must pass; then merge.
```
Merging to `main` does NOT deploy — it just integrates the change.

## Promoting to production (going live)
When `main` is ready to ship, promote it to `production`:
```bash
git fetch origin
git checkout production
git merge --ff-only origin/main      # production must be a fast-forward of main
git push origin production           # <-- this triggers Deploy to VM
```
(Or open a PR from `main` into `production` and merge it.) Only this deploys the
live site. Roll back with `deploy/rollback.sh` or by re-running Deploy to VM with
an older ref (see below).

## Rolling back a bad deploy
Two ways:

**A. Instant — restore the previous deploy (on the VM):**
```bash
bash /opt/quanthunt/deploy/rollback.sh
```
Every deploy snapshots the live code to `/opt/quanthunt.prev` first, so this
restores the immediately-previous version and restarts the service.

**B. To a specific version — via GitHub Actions:**
Actions → **Deploy to VM** → **Run workflow** → set **ref** to a tag or commit
(e.g. `v1.0.0`). This checks out that exact version and deploys it.

## Where things run
- Source of truth: GitHub `main`.
- Live server: `/opt/quanthunt` on the Oracle VM (systemd service `quanthunt`).
- Fundamentals cache (`fund_cache.json`) and `.env` are VM-local and never
  overwritten by deploys or rollbacks.
