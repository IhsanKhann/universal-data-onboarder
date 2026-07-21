# Continuation Plan: GitHub, CI/CD, Pages Deployment

**Status:** Ready to execute  
**Preflight (Phase A):** Passed — gh CLI authenticated as IhsanKhann, Node v24  
**Location:** `D:\universal-data-onboarder\docs\CONTINUATION_PLAN_GITHUB_CI_CD.md`

---

## Phase A — Preflight checks (DONE)

- ✅ `gh --version`: 2.95.0
- ✅ `gh auth status`: Logged in as IhsanKhann
- ✅ `node --version`: v24.12.0
- ✅ `npm --version`: 11.6.2
- ✅ Repo is at `D:\universal-data-onboarder\` with Phase 0-7 committed
- ✅ All 9 e2e tests pass

## Phase B — Create the GitHub repo via `gh`

Run:
```
cd /d/universal-data-onboarder
gh repo create universal-data-onboarder \
  --public \
  --description "Universal, tenant-agnostic, streaming-safe data onboarding engine — extracted from OfferBerries" \
  --source=. \
  --remote=origin \
  --push
```

Then:
```
gh repo edit --add-topic data-migration --add-topic etl --add-topic multi-tenant --add-topic mongodb --add-topic csv-import
gh repo edit --enable-issues --enable-projects
```

## Phase C — License, README, CONTRIBUTING, and repo hygiene files

1. Ask user for license choice (MIT, Apache-2.0, or MPL-2.0)
2. Write `README.md` with quickstart, badges, and docs links
3. Write `CONTRIBUTING.md` with adapter/target contribution guide
4. Create `.github/ISSUE_TEMPLATE/bug_report.md` and `feature_request.md`
5. Create `.github/PULL_REQUEST_TEMPLATE.md`

## Phase D — GitHub Actions: CI

Create `.github/workflows/ci.yml` with:
- Node 20 and 22 matrix
- `npm install`
- `npm test` (Jest-based tests)
- Native test runner (`npm run test:native`) for Node 24 compatibility
- Upload test artifacts on failure

Set branch protection on `main` via `gh api`.

## Phase E — Secrets via `gh secret set`

Run `gh secret set NPM_TOKEN` interactively (prompt user for value).

## Phase F — Docs site (VitePress) + Swagger UI

1. Add `swagger-jsdoc` + `swagger-ui-express` to server
2. Scaffold `docs-site/` with VitePress
3. Populate from `docs/ARCHITECTURE.md`

## Phase G — GitHub Pages deployment

Create `.github/workflows/pages.yml` and enable Pages via `gh api`.

## Phase H — npm publish workflow

Create `.github/workflows/publish.yml` triggered on `v*.*.*` tags.

## Phase I — Full end-to-end verification

1. Fresh `git clone` → `npm install` → boots without errors
2. Swagger UI renders at `/docs`
3. `npm test` passes
4. CI shows green on PR checks
5. Pages URL loads
6. `gh secret list` shows expected secrets
7. `npm publish --dry-run` shows correct files
