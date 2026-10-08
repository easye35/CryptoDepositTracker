# CryptoDeposit Tracker (standalone)

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Google Apps Script](https://img.shields.io/badge/Made%20with-Google%20Apps%20Script-4285F4.svg)](https://developers.google.com/apps-script)
[![Release](https://img.shields.io/github/v/release/easye35/CryptoDepositTracker)](https://github.com/easye35/CryptoDepositTracker/releases)

A free Google Apps Script that scans your Gmail for Bitcoin deposit notification emails and logs them to a Google Sheet. It runs entirely inside your own Google account: no server, no license key, and nothing is sent anywhere.

Looking for a hosted version with managed setup, more wallet providers, and automatic updates? See [Bitcoin deposit tracking for Google Sheets](https://cryptodeposittracker.com) at cryptodeposittracker.com.

<!-- Add screenshots here, e.g. ![Reconciliation dashboard](docs/reconciliation.png) -->

## Related resources

- [How to forward wallet notifications to Gmail](https://cryptodeposittracker.com/forwarding-guide)
- [Free Bitcoin ledger spreadsheet templates](https://cryptodeposittracker.com/free-template)
- [Frequently asked questions](https://cryptodeposittracker.com/faq)
- [Hosted plans and pricing](https://cryptodeposittracker.com/pricing)

## What it does

- Searches Gmail on a schedule for deposit emails (ShakePay is preconfigured; add other providers in the config block).
- Writes each deposit to a **Deposits** sheet and skips duplicates.
- Keeps a **Summary** sheet with total BTC and CAD.
- Builds a **Reconciliation** dashboard (totals by wallet and month) and an **Exceptions** sheet for incomplete or possibly duplicate rows.
- Labels processed Gmail threads (`CDT Processed`).

## Setup

1. Create a new Google Sheet and open **Extensions > Apps Script**.
2. Paste the contents of [`Code.gs`](Code.gs) into the editor and save.
3. Review the `CONFIG` block at the top (scan interval, lookback days, wallets).
4. Run `setup()` and approve the Gmail and Sheets permissions.

A **CryptoDeposit** menu is added to the sheet for manual scans.

## Adding a wallet

Add an entry to `CONFIG.wallets`:

```js
{
  name: 'MyWallet',
  enabled: true,
  sender: 'notifications@example.com',   // '' matches any sender
  subject: 'Deposit received',
  btcPatterns: [/Received\s+([\d.,]+)\s+BTC/i],  // first capture group = amount
  cadPatterns: [],                               // optional CAD value
}
```

## Contributing

Issues and pull requests are welcome, especially new wallet email patterns. See [CONTRIBUTING.md](CONTRIBUTING.md). Release notes are in [CHANGELOG.md](CHANGELOG.md).

## Privacy

The script only reads Gmail messages matching your configured subjects and writes to the spreadsheet it is attached to. It makes no external network requests.

## Limitations

- It records what notification emails say. It does not verify blockchain settlement and cannot access or move crypto.
- Email formats change; you may need to update the regex patterns.
- This is not tax, legal, or accounting advice.

## License

[MIT](LICENSE)
