# E-invoice (Egyptian Tax Authority) setup

Shiply issues one tax invoice per merchant per month for our fees (INV-000001 onward) and
credit notes when fees are given back (CN-000001 onward). Each document must be signed with
the company's electronic signature (the USB token) and sent to the tax authority's
e-invoice system (ETA). Shiply does everything except the signing, which happens on the
finance PC where the token is plugged in.

```
Shiply (server)                         Finance PC (USB token)          Tax authority
  issue invoices for the month
  hold each document's text  ──────────▶  ShiplySigner.ps1 signs  
                             ◀──────────  signatures sent back
  submit signed documents  ─────────────────────────────────────────▶  checks them
  ask for the result       ◀─────────────────────────────────────────  Valid / Invalid
```

## 1. On the tax authority's portal (once)

1. Sign in to the e-invoice portal with the company's account.
2. Register an ERP system (Shiply). Write down the **client id** and **client secret**.
   Do this first on the **pre-production** portal to test, then again on production.
3. Register one item code (EGS) per fee type. Suggested names:
   delivery service fee, COD handling fee, failed delivery fee, receiving fee, storage fee,
   return to merchant fee, fee adjustment. Write down each code (EG-<tax number>-...).

## 2. On the server (Render, environment)

Add these environment variables to the service and redeploy:

| Name | Value |
|---|---|
| `ETA_ENV` | `preprod` while testing, then `production` |
| `ETA_CLIENT_ID` | the client id from step 1 |
| `ETA_CLIENT_SECRET` | the client secret from step 1 |

Never paste the secret in a chat, an email or the code.

## 3. In Shiply (Finance, Company tax details)

1. Fill our legal name, tax registration number (9 digits), activity code (4 digits) and
   address exactly as registered.
2. Paste each item code from step 1.
3. Fill each merchant's tax details. A merchant with a tax registration number is invoiced
   as a company and needs its full address; without one it is invoiced as a person.
4. Tick "Send invoices to the e-invoice system" and save.
5. Admin: "New signing key". Copy the key (it is shown once).

## 4. On the finance PC (once)

1. Install the USB token's driver from the company that issued it (Egypt Trust, MCDR or
   Fixed Misr). Plug in the token.
2. Copy the folder `scripts/eta-signer` to the PC.
3. Open PowerShell in that folder and list the certificates:
   `powershell -ExecutionPolicy Bypass -File ShiplySigner.ps1 -ListCertificates`
   Copy the thumbprint of the company's certificate.
4. Copy `signer.example.json` to `signer.json` and fill the Shiply address, the signing key
   and the thumbprint.

## 5. Every month

1. Finance, Tax invoices: choose last month, "Issue the month's invoices".
2. On the finance PC, with the token plugged in, run
   `powershell -ExecutionPolicy Bypass -File ShiplySigner.ps1`
   (or keep it running: add `-Every 10` to sign every 10 minutes). Windows asks for the
   token PIN.
3. Shiply sends the signed invoices within a minute and shows Valid or Invalid for each.
4. An invoice that comes back Rejected or Invalid shows the tax authority's reason. Fix it
   (our details, the merchant's details or an item code) and press "Send again"; it is
   signed again on the next run.

The tax authority expects invoices to be sent within a few days of their date, so issue and
sign them in the first days of each month.

## Not tested yet

The signing program follows the tax authority's own signing sample (CAdES-BES, SHA-256,
signing-certificate-v2), but it has not been tried with a real token. Test it on the
pre-production portal first and send us any error it shows.
