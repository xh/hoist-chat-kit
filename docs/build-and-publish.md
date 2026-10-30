# Build and Publish

Hoist Chat Kit uses [GitHub Actions](https://docs.github.com/en/actions) for continuous
integration and npm publishing. All workflow definitions live in `.github/workflows/`. They
follow hoist-react's workflows step for step, and the multi-step pieces - snapshot versioning,
release version checks, and tagging - come from shared actions in
[`xh/hoist-dev-utils`](https://github.com/xh/hoist-dev-utils/tree/master/.github/actions), pinned
by commit SHA. Dependabot bumps the pins.

The kit ships as source, so it has no compile step. Its "build" is the packed tarball, which
`pnpm build` checks. See [Published as source](../CLAUDE.md#published-as-source) for what that
means for the package.

## CI (`ci.yml`)

Runs on pushes and pull requests to `develop`, and CodeQL also runs on a weekly schedule. Two
independent jobs:

- **Lint** - installs with `pnpm install --frozen-lockfile`, then runs `pnpm lint`,
  `pnpm typecheck`, `pnpm test` and `pnpm build` as distinct steps. It ends with a
  production-dependency audit, `pnpm audit --prod --audit-level high`, which fails the job on any
  high or critical advisory that `auditConfig` in `pnpm-workspace.yaml` does not accept. Skipped
  on scheduled runs.
- **CodeQL** - GitHub's security analysis for JavaScript and TypeScript. It runs only while the
  repository is public, since code scanning needs GitHub Code Security.

## Deploy Snapshot (`deploySnapshot.yml`)

Publishes a SNAPSHOT build to npm on every push to `develop`. The version comes from
`package.json`, such as `1.0.0-SNAPSHOT`, with a timestamp appended so that each snapshot is
unique. Snapshots publish under the `next` dist-tag, so `latest` does not move. Lint, type check,
tests and the package check run first, and a failure in any of them blocks the publish.

The workflow can also run by hand for any branch, with two optional inputs:

- **Version** - overrides the version from `package.json`. `-SNAPSHOT` is appended if missing.
- **Dist-tag** - the npm dist-tag, default `next`. Use another, such as `beta`, to let an app try
  a feature branch without moving `next`:

```bash
gh workflow run deploySnapshot.yml --ref my-branch -f version=1.0.0-my-branch -f dist-tag=beta
```

The app then installs the exact version shown in the run's job summary. Remove the extra dist-tag
once the branch merges, with `npm dist-tag rm @xh/hoist-chat-kit beta`.

Publishing authenticates with npm through OIDC trusted publishing, with no stored npm token.
npm attaches a provenance attestation to each published tarball.

## Deploy Release (`deployRelease.yml`)

Publishes a numbered release to npm. **Run by hand** from the `master` branch. It takes two
inputs:

- **Release Version** - a semver string, such as `1.1.0`. It must be exactly one increment -
  major, minor or patch - from the latest release tag.
- **Is Hotfix** - check when releasing a hotfix to a version other than the latest. The workflow
  must then run from a branch other than `master` or `develop`.

The workflow refuses to run from `develop`, validates the version against the existing `v*` tags,
and runs lint, type check, tests and the package check. Then it:

1. Sets the version in `package.json`, in the runner only.
2. Publishes to npm with the `latest` dist-tag, or `hotfix` for a hotfix.
3. Creates and pushes a `vX.Y.Z` git tag.
4. Creates a GitHub Release with auto-generated notes. A hotfix is marked as not the latest
   release, so it does not supplant the most recent mainline release.

The tag points at a commit whose `package.json` still reads `-SNAPSHOT`. The workflow does not
commit the version back, which avoids paired set-and-reset commits on every release. The
published tarball carries the release version.

Release publishing authenticates through OIDC trusted publishing, as snapshots do. A publish
that fails there stops the run before the tag and the GitHub Release are created, so the run can
be repeated once the configuration is fixed.

### Cut a release

1. Make sure `develop` is green in CI and holds everything the release needs.
2. On `develop`, set the topmost `CHANGELOG.md` heading to the release version and today's date,
   as in `## 1.1.0 - 2026-11-20`. Commit and push.
3. Fast-forward `master` to `develop` and push it:
   ```bash
   git switch master && git merge --ff-only develop && git push
   ```
4. Run **Deploy Release** from `master` with the version. The Actions page offers the form, or:
   ```bash
   gh workflow run deployRelease.yml --ref master -f version=1.1.0 -f is-hotfix=false
   ```
5. Back on `develop`, bump `package.json` to the next minor `-SNAPSHOT` version, add a matching
   `## 1.2.0-SNAPSHOT - unreleased` heading at the top of `CHANGELOG.md`, and push. The next push
   publishes the first snapshot of the new line.

### Cut a hotfix

A hotfix patches a release that is no longer the latest.

1. Branch from the release tag: `git switch -c hotfix/1.0.x v1.0.0`.
2. Cherry-pick or make the fix, add a `## 1.0.1 - {date}` entry to `CHANGELOG.md`, and push the
   branch.
3. Run **Deploy Release** from the hotfix branch with the patch version and **Is Hotfix** checked.
   It publishes under the `hotfix` dist-tag, so `latest` does not move.
4. Merge the fix forward into `develop`, with a changelog entry under the current line too.

A patch to the latest release is an ordinary release, cut from `master`.

## Dependabot (`dependabot.yml`)

Dependabot opens weekly PRs against `develop` for GitHub Actions and npm dependencies. Minor and
patch bumps are grouped. Major bumps get a PR each. It leaves `@xh/hoist` alone, which moves by
hand with each Hoist release, and `rxjs`, which must match the version `@ag-ui/client` pins.

## Required Secrets and Variables

| Name | Type | Used By | Purpose |
|------|------|---------|---------|
| `FONTAWESOME_PACKAGE_TOKEN` | Secret | CI, Snapshot, Release, Dependabot | Auth token for the Font Awesome Pro npm registry, which `@xh/hoist` depends on. Dependabot needs it in its own secrets. |
| `GITHUB_TOKEN` | Secret | Release | Provided by GitHub Actions. Used to create the tag and the GitHub Release. |

Font Awesome Pro packages come from the official registry at `npm.fontawesome.com`, configured in
`.npmrc`. The workflows append the token to `.npmrc` at build time. It is never checked in.

No npm token is stored. Both publish workflows authenticate through
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers), which the package on npm
configures with this repository and each workflow's file name. The `id-token: write` permission
on each publish job lets it mint the OIDC token that npm exchanges for a scoped publish token.

## Branch Protection

A repository ruleset blocks deletion and force-pushes on `develop` and `master`. PRs target
`develop` and are squash-merged. See [Git Workflow](../CLAUDE.md#git-workflow) for the branching
rules.
