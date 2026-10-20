# PeopleDesk HR

A simple HR app for small companies (under ~50 people). It runs entirely in the browser, with no server or install needed.

## What it does

| Area | HR | Managers | Employees |
|---|---|---|---|
| **Dashboard** | Headcount, who's in today, who's on leave, pending approvals, payroll summary | Team approvals, own check-in, own balances | Check in / out, leave balance, latest payslip |
| **People** | Add, edit and mark employees as left; see salaries | View directory and their team's records | View directory and own profile |
| **Leave** | Approve/reject any request; see all requests | Approve/reject their team's requests | Apply, cancel, track balance |
| **Attendance** | Team today, monthly summary, correct records | Team today and monthly summary | Daily check-in, monthly calendar |
| **Payroll** | Preview and run monthly payroll, view all payslips | Own payslips | Own payslips |
| **Settings** | Company name, office start time, leave policy, holidays | n/a | n/a |

Payroll follows common Indian rules: PF at 12% of basic (₹15,000 ceiling), professional tax (Maharashtra slab), monthly TDS, and loss of pay for approved unpaid leave. Payslips show the net amount in words (lakh/crore).

## Try it

Open `index.html` in any browser. On the sign-in screen, pick a sample person to see the app as HR, a manager or an employee.

## Important: demo mode

This version stores data **in your browser only** (`localStorage`):

- Each browser/device has its own separate copy of the data.
- There are no real passwords, so anyone can pick any user.
- Clearing browser data erases everything. Use **Settings → Reset demo data** to restore the samples.

The next step to use it for real is a shared online database with proper logins (for example Supabase). All data access is in one place at the top of `app.js`, so that change is contained.

## Files

- `index.html`: the page
- `styles.css`: look and layout (light and dark themes)
- `app.js`: all app logic, sample data and payroll rules

## Ideas for later

Onboarding/offboarding checklists, employee documents, performance reviews, recruitment, announcements, reports and Excel export, PF/ESI/TDS compliance reports, half-day leave, and leave carry-forward.
