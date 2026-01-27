# Rimon Room Scheduler

Simple React app for approved students to sign in with Google and reserve free rooms.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and set your Google client ID:
   ```bash
   cp .env.example .env
   ```
3. Update the allowed student emails in `scripts/seed-data/allowedStudents.ts`.
4. Update rooms and labels in `scripts/seed-data/rooms.ts`.
5. Update the schedule CSV in `scripts/seed-data/rimon_schedule.csv`.
6. Start the app:
   ```bash
   npm run dev
   ```

## Schedule CSV format

The CSV is parsed via `src/lib/scheduleBuilder.ts` using column names defined in `src/config.ts`.
To change the format later, edit the config (column names, day mapping, slot minutes).

- Days are mapped from Hebrew letters (א-ה) to Sunday-Thursday.
- Semester A/B hours are treated as academic hours (45 minutes each).

## Notes

- Reservations are stored in `localStorage` only (demo-level persistence).
- Set `VITE_ENABLE_DEV_LOGIN=true` to use the dev sign-in form for testing.
