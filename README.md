# PeopleDesk HR

An HR app for a group of companies: people, leave, attendance with shifts and overtime, and payroll. It runs in the browser, with data stored in Supabase.

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

## Two modes

- **Live:** when [`config.js`](config.js) has your Supabase address and key, everyone signs in with their own email and password and shares one database. **To set this up, follow [SETUP.md](SETUP.md).**
- **Demo:** when `config.js` is empty, the app runs with sample companies and employees saved only in your browser. Pick any sample person on the sign-in screen to explore.

## Security

Access is enforced by the database itself (row-level security in [`supabase/schema.sql`](supabase/schema.sql)), not just hidden in the app:

| | HR | Manager | Employee |
|---|---|---|---|
| Directory | All companies | Own company + their team | Own company |
| Pay and payslips | Everyone | Own only | Own only |
| Leave | Everyone, approve any | Own + team, approve team | Own, apply and cancel pending |
| Attendance | Everyone, correct any | Own + team, mark and correct team | Check in for today, check out once |
| Overtime approval | Anyone | Their team | No |
| Settings and payroll | Yes | No | No |

A login is linked to an employee by email address. Someone who signs up with an email HR hasn't added sees nothing.

## Files

- `index.html`: the page
- `styles.css`: look and layout (light and dark themes)
- `app.js`: app logic, payroll rules, sample data, and syncing with Supabase
- `config.js`: your Supabase address and public key (empty = demo)
- `supabase/schema.sql`: database tables and security rules
- `vendor/`: the Supabase JavaScript library (v2.45.4, MIT licence)

## Ideas for later

Weekly-off rotation rosters, onboarding/offboarding checklists, employee documents, performance reviews, recruitment, announcements, reports and Excel export, PF/ESI/TDS compliance reports, half-day leave, and leave carry-forward.
