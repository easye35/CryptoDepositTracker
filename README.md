CryptoDepositTracker — Google Apps Script Automation
Automatically scan Gmail for crypto deposit emails (Shakepay + all supported wallets), extract BTC/CAD amounts, and write them into a Google Sheets “Deposits” ledger with summaries, reconciliation dashboards, and backend syncing.

This script is deployed automatically by CryptoDepositTracker.com (Swinging Pineapple Studios) and powers the Google Sheets automation portion of the service.

📌 Features
Scans Gmail for deposit emails from Shakepay and all wallets configured in your CDT backend

Extracts BTC, CAD, Lightning deposits, and fallback patterns

Writes deposits into a structured Deposits sheet

Generates:

Summary sheet (Total CAD, Total BTC, Last Updated)

Reconciliation Dashboard (wallet totals, monthly totals, duplicates, incomplete rows)

Exceptions sheet (rows needing review)

Automatically labels processed Gmail threads

Syncs deposits back to your CDT backend via /push-deposits

Handles Gmail quota limits with cooldown logic

Automatically manages Apps Script triggers (minutes/hours/days)

Supports license validation via /check-license

Fully self‑healing: recreates sheets, headers, triggers, and properties if missing

🚀 How It Works
1. Setup
When the script runs for the first time:

Creates the Deposits sheet

Creates the Summary sheet

Migrates data from “Sheet1” if present

Stores the user’s Google email

Creates the scan trigger (interval normalized to Apps Script limits)

2. Gmail Scanning
The script builds a Gmail query based on wallet configs retrieved from:

Code
{{CDT_WP_BASE}}/wallet-config
Wallet configs include:

sender email

subject text

BTC regex

CAD regex

enabled/disabled state

If the backend is unreachable, a Shakepay fallback parser is used:

“You received ([\d.]+) BTC”
“Quantity ([\d.]+) BTC”

The scanner:

Searches recent Gmail threads

Extracts BTC/CAD amounts

Detects Shakepay withdrawals to avoid false positives

Prevents duplicates using a composite key

Writes new deposits to the sheet

Labels processed Gmail threads

Pushes deposits to the CDT backend

3. Summary Generation
The Summary sheet shows:

Total CAD value

Total BTC received

Last updated timestamp

CAD values embedded in Notes (e.g., CAD: 123.45) are included.

4. Reconciliation Dashboard
Automatically generated with:

Total BTC

Total CAD

Rows needing review

Wallet‑level totals

Month‑level totals

Duplicate detection

Incomplete row detection

5. Exceptions Sheet
Lists rows with:

Missing fields

Duplicate keys

Parsing issues

📡 Backend Endpoints Used
The script communicates with your CDT backend using:

Purpose	Endpoint
License validation	/check-license
Wallet config retrieval	/wallet-config
Deposit push	/push-deposits
Logging	/push-log
Error reporting	/push-error


Payloads include:

user email

API key

spreadsheet ID

deposits (ISO timestamps, BTC/CAD amounts, source wallet, notes)

⚙️ Trigger Normalization
Apps Script only allows specific intervals:

Minutes: 1, 5, 10, 15, 30

Hours: 1, 2, 4, 6, 8, 12

Days: 1–15

Your normalizeScanInterval() function snaps any backend‑requested interval to the nearest valid Apps Script value.

🔐 Gmail Quota Protection
If Gmail returns:

“too many times for one day: gmail”

The script enters a cooldown until midnight, preventing lockouts.

📁 Sheet Structure
Deposits
| Date | Amount | Currency | Source | TxID | Notes |

Summary
| Total CAD | Total BTC | Last Updated |

Reconciliation
Wallet totals

Monthly totals

Duplicate detection

Incomplete rows

Exceptions
| Date | Amount | Currency | Wallet | TxID | Notes | Issue |

🛠️ Deployment
This script is automatically injected into the user’s Google Sheet by CryptoDepositTracker.com.

Environment variables are replaced during deployment:

Code
{{CDT_WP_BASE}}
{{CDT_API_KEY}}
{{CDT_SPREADSHEET_ID}}
{{CDT_SCRIPT_VERSION}}
📄 License
This repository contains the Apps Script portion of CryptoDepositTracker.com.
All backend endpoints and business logic belong to Swinging Pineapple Studios.

💬 Support
For help, visit:

CryptoDepositTracker.com

Or contact support through your CDT dashboard.
