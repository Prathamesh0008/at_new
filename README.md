# Attendance Portal (Deployment Ready)

Unified employee portal built on Next.js 16.

## Features
- Attendance module (start/end shift, break tracking)
- Leave workflow (multi-level approval)
- Task assignment and worksheet flow
- Reimbursements and attendance corrections
- Manager dashboard with exports (Excel/PDF)
- Email notifications (real or simulated mode)

## Tech Stack
- Next.js 16 (App Router)
- React 19
- Firebase Firestore
- Nodemailer

## 1) Local Setup
```bash
npm install
cp .env.example .env.local
npm run dev
```
Open: `http://localhost:3000`

## 2) Environment Variables
Set these in `.env.local` and in deployment platform env settings.

Required for Firebase:
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

Optional for email sending:
- `EMAIL_USER`
- `EMAIL_PASSWORD`

If email vars are missing, `/api/send-email` runs in simulated mode (safe fallback).

## 3) Quality Checks
```bash
npm run lint
npm run build
```

## 4) Production Run
```bash
npm run build
npm run start
```

## 5) Deployment (Vercel)
1. Push repository to GitHub.
2. Import project in Vercel.
3. Add all env vars from `.env.example`.
4. Deploy.

## 6) Health Check
- Endpoint: `/api/health`
- Example response:
```json
{ "ok": true, "service": "attendanceportal", "timestamp": "..." }
```

## Notes
- Home route (`/`) is the unified portal.
- Legacy snapshots under `.history/` are ignored by lint.
