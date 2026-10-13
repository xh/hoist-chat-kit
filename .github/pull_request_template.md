Hoist Chat Kit P/R Checklist
----------------------------

**Pull request authors:** Review and check off the below. Items that do not apply can also be
checked off to show they were considered. If unclear if a step is relevant, leave it unchecked and
note it in comments.

- [ ] Caught up with `develop` branch as of last change.
- [ ] Added CHANGELOG entry, or determined not required.
- [ ] Reviewed for breaking changes, added `breaking-change` label + CHANGELOG if so.
- [ ] Updated docs (doc comments, README, index, registry), or determined not required.
- [ ] Added or updated unit tests, or determined not required.
- [ ] Reviewed and tested on Mobile, or determined not required.
- [ ] Tested in a consuming app, or determined not required.

**If your change is still a WIP**, use the "Create draft pull request" option in the split button
below to show it is not ready yet for a final review.

> **Pull request reviewers:** when merging this P/R, consider using a *squash commit* to collapse
> intermediate commits into a single commit for the overall change. PRs with a single commit
> should be *rebased* when possible.
