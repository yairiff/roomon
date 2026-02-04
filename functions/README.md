# Email Notifications (Cloud Functions)

This project includes Firebase Cloud Functions that send email notifications:

- Admins get an email when a new user registers (role=`pending`).
- The user gets an email when approved (role changes from `pending` to `student`/`moderator`/`admin`).

## Provider

The implementation uses SendGrid's HTTP API (no extra npm deps beyond `firebase-admin` / `firebase-functions`).

## Required env vars

Configure these for your Functions runtime:

- `SENDGRID_API_KEY`
- `SENDGRID_FROM_EMAIL`
- `SENDGRID_FROM_NAME` (optional)
- `APP_URL` (optional, e.g. `https://your-domain.web.app`)

## Deploy (example)

Install deps and build:

```bash
cd functions
npm i
npm run build
```

Then deploy:

```bash
firebase deploy --only functions
```

