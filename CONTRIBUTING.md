# Contributing

Factrove is licensed under AGPL-3.0-or-later. See [LICENSE](LICENSE). The copyright notice is in [NOTICE](NOTICE). By contributing, you agree to the [contributor license agreement](CLA.md). You keep the copyright in your work. The agreement gives Magnificode LTD a license to use and relicense contributions, including under proprietary terms.

## Sign the agreement

A pull request from someone who is not allowlisted needs a signature. CLA Assistant Lite comments on the pull request and links to the agreement. To sign, comment this sentence on the pull request:

```text
I have read the CLA Document and I hereby sign the CLA
```

The check runs again after that comment. Comment `recheck` if you need the bot to look again. Signatures are stored in `signatures/version1/cla.json` on the `cla-signatures` branch. That branch is created for the bot and should not be protected, so the workflow can commit signatures with `GITHUB_TOKEN`. Do not add the signature file by hand. After a pull request is merged, the bot locks the conversation so the signature comment stays.

`tommagni`, `dependabot[bot]`, `cursor[bot]`, and `cursoragent` are allowlisted and do not sign.
