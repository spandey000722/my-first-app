# PeopleDesk HR

A simple HR app for small companies (under ~50 people). It runs entirely in the browser, with no server or install needed.

## What it does

PeopleDesk runs HR for **several companies** from one app. Group HR can switch between companies or see all of them together; managers and employees only see their own company.

| Area | HR | Managers | Employees |
|---|---|---|---|
| **Dashboard** | Headcount, who's in per shift, leave and overtime approvals, payroll per company | Team approvals, own check-in | Check in / out, leave balance, overtime, latest payslip |
| **People** | Add, edit, mark as left; company, shift, weekly off, monthly or daily-wage pay | Directory and their team | Directory and own profile |
| **Leave** | Approve/reject any request | Approve/reject their team | Apply, cancel, track balance |
| **Attendance** | Team today by shift, monthly summary, overtime approvals, corrections | Same, for their team | Daily check-in, monthly calendar |
| **Payroll** | Preview and run payroll per company, payslips | Own payslips | Own payslips |
| **Settings** | Every rule below, per company; add companies | n/a | n/a |

### Nothing is hard-coded

Every rule is edited in **Settings**, separately for each company:

- **Company details:** name, address, PF and ESI codes (printed on payslips)
- **Working time:** shifts (overnight shifts supported), overtime threshold per shift, default weekly off, late-mark grace minutes. Each employee can also have their own weekly off.
- **Payroll rules:** PF employee/company % and wage ceiling; ESI employee/company % and wage limit; professional tax slabs; overtime multiplier, minimum and hourly-rate basis; loss of pay for absences; holiday pay for daily-wage workers
- **Leave policy:** add, rename or remove leave types and days per year (unpaid leave is built in)
- **Holidays:** per company, with "copy to other companies"

The sample data starts with Gujarat values (PT ₹200 from ₹12,000, ESI up to ₹21,000, PF 12% up to ₹15,000, overtime at 2×). Changing a rule affects future payroll runs only; issued payslips stay as they were unless HR recalculates that month.

### Two kinds of pay

- **Monthly salary:** basic + HRA + allowances, with loss of pay for unpaid leave and (optionally) absences
- **Daily wage:** paid days × daily rate. Paid days are days worked plus paid leave plus (optionally) holidays.

Overtime is counted when someone works past their shift's "overtime after" hours. It needs approval from their manager or HR, and only approved overtime is paid.

## Try it

Open `index.html` in any browser. On the sign-in screen, pick a sample person to see the app as Group HR, a manager, an office employee or a factory worker. The two companies (Demo Polymers and Demo Exports) are samples; rename them or add your own in Settings.

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

Weekly-off rotation rosters, onboarding/offboarding checklists, employee documents, performance reviews, recruitment, announcements, reports and Excel export, PF/ESI/TDS compliance reports, half-day leave, and leave carry-forward.
