# The ePlane Co. — Clay Studio Dashboard

Full-stack inventory & project dashboard for ePlane.ai team.

## Deploy to Vercel (step-by-step)

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### 2. Connect to Vercel
1. Go to [vercel.com](https://vercel.com) → New Project
2. Import your GitHub repository
3. Framework Preset: **Other**
4. Root Directory: ` . ` (leave as-is)
5. Click **Deploy**

### 3. Set Environment Variables (REQUIRED)
In Vercel → Your Project → Settings → Environment Variables, add:

| Variable | Value |
|---|---|
| `JWT_SECRET` | A long random string (run `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`) |
| `ADMIN_EMAIL_1` | `rahul.sp@eplane.ai` |
| `ADMIN_NAME_1` | `Rahul Sakthevel` |
| `ADMIN_PASS_1` | Your secure password |
| `ADMIN_EMAIL_2` | `rajan.sunjay@eplane.ai` |
| `ADMIN_NAME_2` | `Rajan Sunjay` |
| `ADMIN_PASS_2` | Your secure password |

After adding env vars, **Redeploy** the project.

## Local Development

```bash
npm install
npm run dev
```

Open http://localhost:3000

**Logging in locally:** If you don't set any `ADMIN_*` environment variables, the
app seeds a default admin so you can sign in immediately:

| Email | Password |
|---|---|
| `admin@eplane.ai` | `admin123` |

Change this (or set the `ADMIN_*` vars) before deploying anywhere public. This
default is only ever seeded in local development, never on Vercel.

## Important Notes

- **Currency**: All amounts are shown in Indian Rupees (₹).
- **Borrow Tracker**: Logs items other teams borrow from the studio — borrower
  name, team, item, date, and whether it's been returned. (This replaced the
  older Tasks module.)
- **Auth cookies**: Set automatically as `SameSite=Lax` over local HTTP and
  `Secure; SameSite=None` over HTTPS (Vercel), so login works in both.
- **Forgot password without email set up**: If `GMAIL_USER` / `GMAIL_APP_PASS`
  aren't configured, the OTP can't be emailed. In local development the reset
  screen fills the code in for you so the flow still works. In production an
  unconfigured mailer returns an error instead of exposing the code.
- **Database persistence**: On Vercel, the SQLite DB lives in `/tmp` which resets on cold starts. This is fine for an internal tool but data won't survive redeploys. For permanent storage, migrate to [Supabase](https://supabase.com) or [PlanetScale](https://planetscale.com).
- **Signups**: Only `@eplane.ai` email addresses can register.
- **Approval flow**: New users need admin approval before they can log in.
