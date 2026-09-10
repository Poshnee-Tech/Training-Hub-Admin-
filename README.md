# Training Simulator — Admin Console

The administrator half of **CallSim**, a training platform for insurance
call-center agents. This is the "switchboard": enroll agents, author the
training content, assign customers, review recordings, and read how the floor is
performing.

Next.js 16 · React 19 · Tailwind CSS · Zustand

> 📘 **Screen-by-screen walkthrough:** [USER_MANUAL.md](./USER_MANUAL.md).
> **System reference** — architecture, call flow, QA evaluation, voice pipeline,
> deployment — lives in the backend repository's `README.md`.

---

## Quick start

```bash
npm install
cp .env.local.example .env.local
npm run dev            # http://localhost:3000
```

The backend must be running on `http://localhost:4000` first — see the
[backend repository](https://github.com/Poshnee-Tech/Training-Simulator-Backend-).

### Environment

```
NEXT_PUBLIC_API_URL=http://localhost:4000
```

`NEXT_PUBLIC_*` values are inlined at build time, so changing one means
rebuilding rather than just restarting.

### Development sign-in

Seeded by `npm run db:seed` in the backend:

| Email | Password | Role |
|---|---|---|
| `admin@callsim.com` | `admin123456` | `SUPER_ADMIN` |

---

## User manual

### The sections

| Section | What you do there |
|---|---|
| **Dashboard** | Floor-wide command centre — agent counts, team average, the weakest category, top and bottom performers, calls awaiting a verifier |
| **Agents** | Enroll agents, edit profiles, reset passwords, activate/deactivate, inspect and reset an individual's journey |
| **Assign Customers** | Give agents the scenarios they will practise against |
| **Product Knowledge** | Author ACA/Medicare articles and upload narration audio |
| **Quizzes** | Build question banks, set pass marks and attempt limits |
| **Best Practice Clips** | Upload clips, organise them into sections, add transcripts |
| **Call History** | Every session, filterable by agent, campaign and status |
| **Recordings** | Stereo recordings (trainee left, customer right), streamed behind admin auth |
| **Scenarios** | The AI customer personas — campaign, difficulty, mood, agenda |
| **Analytics** | Performance over time — see below |

### Analytics

Everything on the page answers the same question for whatever slice the filter
bar names.

**The filter bar** sits in one row above the panels and scopes all of them, so
two panels can never disagree about what they are counting:

- **Campaign** — All campaigns · ACA · Medicare · Med alert
- **Agent** — a searchable picker. Type any part of a first name, last name or
  email; matching happens server-side. The × clears back to the whole floor.

The two combine: *the whole floor*, *ACA only*, *one agent*, or *one agent on
ACA*. Changing scope holds the previous render at reduced opacity instead of
blanking the page, and the panel headings, the badge under the title and the
footer line all restate the active scope.

**The panels:**

| Panel | Reads |
|---|---|
| Four tiles | Completed calls (all time), calls in the last 30 days, evaluations, share hitting the 80 target |
| Score trend | Daily average across 30 days, with a 7-day trailing line to follow |
| Strong and weak | The five scored categories as ranked bars, weakest first, each with a 15-day-vs-15-day change |
| Call volume | Completed calls per day, so a score dip can be read against that day's workload |
| Campaign breakdown | Per campaign: a call-weighted average and the practice mix across difficulty |

**Reading them honestly:**

- A day with no evaluations draws a **gap**, not a zero. Nobody was scored that
  day; that is not everyone scoring nothing.
- A change reads "Not enough data" unless both halves of the window carry at
  least three evaluations — a "+18 pts" built from one call either side is a
  coin flip wearing a trend's clothes.
- Days are bucketed in **UTC** on every panel, so the trend and the volume chart
  line up.
- Every chart has a **Table** toggle. No number is reachable only by hovering.
- Green/amber/red always means *what a score means*. Scenario difficulty uses a
  separate single-hue ramp, because an EASY scenario is not a "good" one.

### Resetting a stuck agent

A single-attempt quiz an agent fails leaves them blocked. Open
**Agents → (agent) → journey** and clear that stage to restore the attempt. This
is the supported recovery path — do not edit the database by hand.

### Themes

The dark/bright toggle in the sidebar is remembered per browser and applies to
the whole console. All entrance animation respects `prefers-reduced-motion`.

---

## Project layout

```
src/
  app/                    routes (dashboard, agents, analytics, content/*, calls, recordings…)
  components/
    layout/               AdminShell (theme + chrome), AdminSidebar
    admin/                RadialGauge, chart components, analytics filters and tiles
  lib/
    api.ts                the single API client
    analytics-series.ts   pure data shaping for the analytics charts
  store/                  Zustand auth store
```

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Dev server on `:3000` |
| `npm run build` | Production build |
| `npm run start` | Serve the build |
| `npm run lint` | Lint |

## Troubleshooting

**Every panel says "could not load".** The browser was blocked before the
request left. Add `http://localhost:3000` to `CORS_ORIGINS` in the backend
`.env` and restart the backend.

**Analytics shows nothing for an agent you know has calls.** Check the campaign
filter — an agent with only Medicare calls shows nothing under ACA. The footer
line under the panels always states the active scope.

**Dashboard and analytics disagree.** The dashboard is all-time and floor-wide;
analytics is a rolling 30-day window and obeys the filter bar.

More in [USER_MANUAL.md](./USER_MANUAL.md#12-troubleshooting).
