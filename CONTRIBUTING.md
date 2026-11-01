# Contributing

Outside contributions are not accepted for now. Issues, bug reports, and feedback are welcome. Outside pull requests will be closed without merging.

Factrove is licensed under AGPL-3.0-or-later. See [LICENSE](LICENSE). The copyright notice is in [NOTICE](NOTICE). By contributing, you agree to the [contributor license agreement](CLA.md). You keep the copyright in your work. The agreement gives Magnificode LTD a license to use and relicense contributions, including under proprietary terms.

## Sign the agreement

These steps apply once outside pull requests are accepted again.

Pull requests opened by the GitHub accounts `tommagni`, `dependabot[bot]`, `cursor[bot]`, and `cursoragent` skip the check. The workflow matches the account that opened the pull request. A git commit author name does not skip it. Every other pull request needs a signature. CLA Assistant Lite comments on the pull request and links to the agreement. To sign, comment this sentence on the pull request:

```text
I have read the CLA Document and I hereby sign the CLA
```

The check runs again after that comment. Comment `recheck` if you need the bot to look again. The check reads at most 100 commits and 30 comments. Past either limit it fails until a maintainer verifies the CLA status manually, or the contributor splits the pull request.

Signatures are stored in `signatures/version1/cla.json` on the `cla-signatures` branch. That file is already on the branch and starts as `{"signedContributors":[]}`. CLA Assistant Lite v2.6.1 does not create the file when it is missing, so leave it in place. The branch should not be protected, so the workflow can commit new signatures with `GITHUB_TOKEN`. After a signed pull request is merged, the bot locks the conversation so the signature comment stays.
