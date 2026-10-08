# Contributing

Thanks for helping improve CryptoDeposit Tracker (standalone).

## Good first contributions

- **New wallet patterns:** add a wallet entry to `CONFIG.wallets` in `Code.gs` for a provider whose notification emails aren't covered. Include the sender, subject, and a regex that captures the BTC amount.
- **Pattern fixes:** providers change their email wording. Update the regex and describe what changed.
- **Bug reports:** open an issue with the wallet/provider and the error message from **Executions** in the Apps Script editor.

## Before opening a pull request

- Keep the script self-contained: no external network calls, API keys, or tracking.
- Test in a copy of a Google Sheet and confirm that running a scan twice does not create duplicate rows.
- **Never include real email contents, addresses, amounts, or personal data** in issues or PRs. Replace them with placeholders.

## Scope

This repo is the free, standalone script. Hosted-service features (managed setup, accounts, billing) live in the hosted product and are out of scope here.
