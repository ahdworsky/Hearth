# Hearth chore reminders — setup

This adds a daily automation (via GitHub Actions, free) that checks Firestore
for chores due today and emails — or texts, via carrier email gateways —
whoever they're assigned to.

## 1. Update the site first
The People form now has reminder fields (Off / Email / Text / Both, plus
email/phone/carrier). Deploy the updated `index.html` + `assets` files from
this batch the same way you did last time, then go into **People** on the
live site and set a reminder preference + contact info for each family
member you want reminders for.

## 2. Add these files to your Hearth repo
Copy this whole folder's contents into your existing `Hearth` GitHub repo,
preserving the structure:
```
Hearth/
  index.html          (already there)
  assets/              (already there)
  scripts/
    send-reminders.js
    package.json
  .github/
    workflows/
      chore-reminders.yml
```
Easiest way: use GitHub's "Add file → Upload files" and drag the `scripts`
and `.github` folders in at the repo root — GitHub preserves the folder
structure on upload.

## 3. Get a Firebase service account key
This lets the automation read your Firestore data (the app itself only ever
reads/writes as an anonymous public client — this key is a separate,
higher-privilege credential, so keep it secret).

1. In the Firebase console, go to **Settings (gear icon) → Project settings → Service accounts**.
2. Click **Generate new private key**. It downloads a `.json` file — keep it safe, don't commit it to the repo.
3. Open that file in a text editor and copy its *entire* contents (it's one big JSON object).

## 4. Get a Gmail app password
This lets the script send email through your Gmail account without your real password.

1. Your Google account needs 2-Step Verification turned on first (Google Account → Security).
2. Go to https://myaccount.google.com/apppasswords, sign in, and create a new app password (name it anything, e.g. "Hearth").
3. Google shows you a 16-character password — copy it.

## 5. Add three secrets to your GitHub repo
In your `Hearth` repo: **Settings → Secrets and variables → Actions → New repository secret**. Add all three:

| Secret name | Value |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | The entire JSON file content from step 3 |
| `GMAIL_USER` | Your Gmail address |
| `GMAIL_APP_PASSWORD` | The 16-character app password from step 4 |

## 6. Test it
Go to the **Actions** tab in your repo → click "Hearth chore reminders" in
the left list → click **Run workflow** (top right) → **Run workflow** again
to confirm. It runs in about 15–20 seconds. Click into the run to see the
log — it'll say who it emailed/texted, or tell you nobody has chores due.

Once that works, it'll run automatically every day at 7am Eastern. To
change the time, edit the `cron` line in `.github/workflows/chore-reminders.yml`
— cron times are in UTC, so subtract 4 hours (EDT) or 5 hours (EST) from
the Eastern time you want.

## Notes
- Carrier email-to-SMS gateways are reliable but not instant or guaranteed by
  carriers — fine for a casual reminder, not for anything time-critical.
- Gmail caps outbound mail at 500/day, far more than a family needs.
- If a family member's phone number changes, or they switch carriers, just
  update it in the People tab on the site.
