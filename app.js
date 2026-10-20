/*
 * PeopleDesk — HR for a group of companies, running entirely in the browser.
 * Data is kept in localStorage (demo mode). Every read/write of the data
 * goes through `db` + `save()`, so swapping in a real backend later only
 * touches the storage section at the top of this file.
 *
 * Nothing about payroll or attendance is hard-coded: PF, ESI, professional
 * tax slabs, overtime, shifts, weekly offs, leave types and holidays all live
 * in each company's settings (company.rules etc.) and are edited in Settings.
 */
(function () {
  'use strict';

  /* ================= Storage ================= */

  const STORE_KEY = 'peopledesk.v2';
  const SESSION_KEY = 'peopledesk.user';
  const memory = {};
  const storage = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return memory[k] ?? null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { memory[k] = v; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } delete memory[k]; },
  };

  /* ================= Utilities ================= */

  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const todayISO = () => iso(new Date());
  const thisMonth = () => todayISO().slice(0, 7);
  const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const daysInMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
  const prevMonth = (ym) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 2, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
  const num = (n) => (Math.round(n * 100) / 100).toLocaleString('en-IN');
  const fmtDate = (s) => parse(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const fmtShort = (s) => parse(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const fmtDay = (s) => parse(s).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  const monthLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }); };
  const initials = (name) => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const minutes = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
  const hm = (mins) => { const m = ((mins % 1440) + 1440) % 1440; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
  // Works across midnight, so a 22:00 → 06:00 night shift is 8 hours.
  const hoursBetween = (a, b) => (a && b ? ((minutes(b) - minutes(a) + 1440) % 1440) / 60 : 0);
  const plural = (n, w) => `${num(n)} ${w}${n === 1 ? '' : 's'}`;

  // Amount in words, Indian numbering (lakh / crore) — as printed on Indian payslips.
  function inWords(n) {
    n = Math.round(n);
    if (n === 0) return 'Zero';
    const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
      'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const two = (x) => (x < 20 ? a[x] : b[Math.floor(x / 10)] + (x % 10 ? ' ' + a[x % 10] : ''));
    const three = (x) => (x >= 100 ? a[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' + two(x % 100) : '') : two(x));
    const out = [];
    const crore = Math.floor(n / 1e7); n %= 1e7;
    const lakh = Math.floor(n / 1e5); n %= 1e5;
    const thousand = Math.floor(n / 1e3); n %= 1e3;
    if (crore) out.push(three(crore) + ' Crore');
    if (lakh) out.push(two(lakh) + ' Lakh');
    if (thousand) out.push(two(thousand) + ' Thousand');
    if (n) out.push(three(n));
    return out.join(' ');
  }

  // Small seeded random so the demo data looks the same on every reset.
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ================= Default rules ================= */

  // Starting values for a new company (Gujarat, 2026). All editable in Settings.
  function defaultRules() {
    return {
      pfRate: 12,                 // employee PF, % of basic
      pfErRate: 12,               // employer PF, % of basic
      pfCeilingOn: true,
      pfCeiling: 15000,           // PF wage ceiling per month
      esiRate: 0.75,              // employee ESI, % of gross
      esiErRate: 3.25,            // employer ESI, % of gross
      esiLimit: 21000,            // ESI applies when monthly wages are at or below this
      ptSlabs: [{ from: 0, amount: 0 }, { from: 12000, amount: 200 }], // professional tax per month
      otMultiplier: 2,            // overtime paid at 2× the ordinary hourly rate
      otBasis: 'basic',           // hourly rate for monthly staff is worked out from 'basic' or 'gross'
      otDays: 26,                 // working days per month used for that hourly rate
      otMinMinutes: 30,           // overtime shorter than this is ignored (counted in 30-minute steps)
      absentLop: true,            // unexplained absence = loss of pay for monthly staff
      holidayPaidDaily: true,     // daily-wage workers are paid for company holidays
    };
  }

  /* ================= Demo data ================= */

  function seed() {
    const today = new Date();
    const y = today.getFullYear();
    const H = (md, name) => ({ date: `${y}-${md}`, name });

    const companies = [
      {
        id: 'C1', name: 'Demo Polymers Pvt. Ltd.', short: 'Polymers',
        address: 'Plot 42, GIDC Makarpura, Vadodara 390010, Gujarat',
        pfCode: 'GJVAD0012345000', esiCode: '37000123450001001',
        weeklyOff: [0], graceMin: 10,
        shifts: [
          { id: 'G', name: 'General', start: '09:00', end: '18:00', otAfter: 9 },
          { id: 'A', name: 'Shift A', start: '06:00', end: '14:00', otAfter: 8 },
          { id: 'B', name: 'Shift B', start: '14:00', end: '22:00', otAfter: 8 },
          { id: 'C', name: 'Shift C (night)', start: '22:00', end: '06:00', otAfter: 8 },
        ],
        leavePolicy: { Earned: 15, Sick: 7, Casual: 7 },
        holidays: [H('01-14', 'Uttarayan'), H('01-26', 'Republic Day'), H('03-04', 'Dhuleti'), H('08-15', 'Independence Day'),
          H('09-04', 'Janmashtami'), H('10-02', 'Gandhi Jayanti'), H('11-08', 'Diwali'), H('11-10', 'Bestu Varas (New Year)')],
        rules: defaultRules(),
      },
      {
        id: 'C2', name: 'Demo Exports Pvt. Ltd.', short: 'Exports',
        address: '5th Floor, Shivalik Plaza, Ashram Road, Ahmedabad 380009, Gujarat',
        pfCode: 'GJAHD0067890000', esiCode: '37000678900001002',
        weeklyOff: [0, 6], graceMin: 15,
        shifts: [{ id: 'G', name: 'General', start: '09:30', end: '18:30', otAfter: 9 }],
        leavePolicy: { Earned: 18, Sick: 8, Casual: 7 },
        holidays: [H('01-14', 'Uttarayan'), H('01-26', 'Republic Day'), H('03-04', 'Dhuleti'), H('08-15', 'Independence Day'),
          H('08-28', 'Raksha Bandhan'), H('09-04', 'Janmashtami'), H('10-02', 'Gandhi Jayanti'), H('11-08', 'Diwali'),
          H('11-10', 'Bestu Varas (New Year)'), H('11-11', 'Bhai Bij'), H('12-25', 'Christmas')],
        rules: defaultRules(),
      },
    ];

    const M = (id, name, title, dept, role, companyId, managerId, joinDate, dob, basic, hra, allowances, tds, shiftId, weeklyOff) => ({
      id, name, title, dept, role, companyId, managerId, joinDate, dob, status: 'Active', payType: 'monthly',
      shiftId: shiftId || 'G', weeklyOff: weeklyOff || null,
      phone: '98250 ' + (40100 + parseInt(id.slice(1), 10)),
      email: name.toLowerCase().split(' ')[0] + '.' + name.toLowerCase().split(' ').slice(-1)[0] + '@demo.example',
      salary: { basic, hra, allowances, tds, dailyRate: 0 },
    });
    const D = (id, name, title, dailyRate, shiftId, weeklyOff, joinDate, dob) => ({
      ...M(id, name, title, 'Production', 'employee', 'C1', 'E008', joinDate, dob, 0, 0, 0, 0, shiftId, weeklyOff),
      payType: 'daily', salary: { basic: 0, hra: 0, allowances: 0, tds: 0, dailyRate },
    });
    const employees = [
      M('E001', 'Hetal Shah', 'Group HR Manager', 'Human Resources', 'hr', 'C2', null, '2017-06-12', '1986-03-19', 55000, 22000, 13000, 6200),
      M('E002', 'Rajesh Joshi', 'Export Manager', 'Exports', 'manager', 'C2', null, '2016-01-04', '1982-09-07', 80000, 32000, 23000, 13500),
      M('E003', 'Krupa Trivedi', 'Export Executive', 'Exports', 'employee', 'C2', 'E002', '2021-08-02', '1995-04-16', 32000, 12800, 7200, 900),
      M('E004', 'Darshan Pandya', 'Logistics Coordinator', 'Logistics', 'employee', 'C2', 'E002', '2022-03-14', '1994-12-01', 26000, 10400, 5600, 0),
      M('E005', 'Megha Bhatt', 'HR Executive', 'Human Resources', 'hr', 'C2', 'E001', '2023-05-08', '1998-07-22', 22000, 8800, 4200, 0),
      M('E006', 'Vivek Modi', 'Accounts Executive', 'Finance', 'employee', 'C2', 'E001', '2020-10-19', '1991-02-11', 28000, 11200, 5800, 300),
      M('E007', 'Nirav Patel', 'Plant Manager', 'Production', 'manager', 'C1', null, '2015-07-01', '1980-11-30', 75000, 30000, 20000, 11000),
      M('E008', 'Kiran Desai', 'Production Supervisor', 'Production', 'manager', 'C1', 'E007', '2018-02-05', '1988-05-14', 30000, 12000, 6000, 400, 'A'),
      M('E009', 'Pooja Mehta', 'Accounts Officer', 'Finance', 'employee', 'C1', 'E007', '2019-09-09', '1992-08-03', 27000, 10800, 5200, 200),
      M('E010', 'Imran Saiyed', 'Maintenance Technician', 'Maintenance', 'employee', 'C1', 'E007', '2020-01-20', '1990-06-25', 13000, 5200, 1800, 0, 'G', [4]),
      D('E011', 'Ramesh Vaghela', 'Machine Operator', 720, 'A', [2], '2019-04-15', '1987-01-09'),
      D('E012', 'Suresh Thakor', 'Machine Operator', 720, 'B', [2], '2020-06-01', '1989-10-12'),
      D('E013', 'Mahesh Rathod', 'Helper', 560, 'C', [4], '2022-08-22', '1999-03-30'),
      D('E014', 'Jignesh Parmar', 'Machine Operator', 700, 'A', [4], '2021-01-11', '1993-07-04'),
      D('E015', 'Bhavesh Solanki', 'Packer', 540, 'B', null, '2023-02-06', '2000-12-18'),
      D('E016', 'Dinesh Chauhan', 'Helper', 560, 'C', null, '2024-03-18', '2001-05-27'),
      D('E017', 'Sanjay Makwana', 'Quality Checker', 650, 'A', null, '2021-11-29', '1996-09-15'),
    ];

    const data = { companies, employees, leaves: [], attendance: [], payruns: [] };
    db = data; // the helpers below read from db

    // Nth working day for this employee from today (negative = past).
    const wd = (e, n) => {
      let d = new Date(today); const step = n < 0 ? -1 : 1; let left = Math.abs(n);
      const ok = (x) => !isOff(e, x) && !isHoliday(coOf(e), iso(x));
      if (n === 0) { while (!ok(d)) d = addDays(d, 1); return iso(d); }
      while (left > 0) { d = addDays(d, step); if (ok(d)) left--; }
      return iso(d);
    };
    const L = (empId, type, a, b, status, reason, decidedBy) => {
      const e = employees.find((x) => x.id === empId);
      const from = wd(e, a); const to = wd(e, b);
      const applied = iso(addDays(parse(from), -6));
      data.leaves.push({ id: uid('L'), empId, type, from, to, status, reason, appliedOn: applied > todayISO() ? todayISO() : applied, decidedBy: decidedBy || null });
    };
    L('E003', 'Casual', 0, 0, 'Approved', 'Family function', 'E002');
    L('E011', 'Sick', -8, -7, 'Approved', 'Fever', 'E008');
    L('E004', 'Unpaid', -15, -15, 'Approved', 'Personal work', 'E002');
    L('E006', 'Earned', -20, -17, 'Approved', 'Trip to Saputara', 'E001');
    L('E013', 'Casual', -5, -5, 'Rejected', 'Personal', 'E008');
    L('E012', 'Unpaid', -3, -3, 'Approved', 'Village visit', 'E008');
    L('E009', 'Earned', 6, 8, 'Pending', 'Sister’s wedding in Surat');
    L('E014', 'Earned', 9, 12, 'Pending', 'Family trip to Dwarka');
    L('E005', 'Sick', 1, 1, 'Pending', 'Doctor appointment');
    L('E016', 'Casual', 3, 3, 'Pending', 'Bank work');

    // Attendance from the start of last month, plus check-ins so far today.
    const r = rng(7);
    const nowMin = minutes(nowHM());
    const startDays = Math.round((today - parse(prevMonth(thisMonth()) + '-01')) / 864e5);
    for (let i = startDays; i >= 0; i--) {
      const d = addDays(today, -i); const s = iso(d);
      employees.forEach((e) => {
        const c = coOf(e); const sh = shiftOf(e);
        if (s < e.joinDate || isOff(e, d) || isHoliday(c, s) || leaveOn(e.id, s)) return;
        const roll = r();
        const start = minutes(sh.start); const end = minutes(sh.end);
        const inMin = start - 15 + Math.floor(r() * (roll < 0.12 ? 45 : 22));
        if (i === 0) {
          if (start <= nowMin && start > 300 && roll < 0.9) data.attendance.push({ empId: e.id, date: s, in: hm(inMin), out: null });
          return;
        }
        if (roll < 0.035) return; // absent
        const factory = c.id === 'C1' && e.dept === 'Production';
        let outMin = end - 3 + Math.floor(r() * 12);
        if (factory && r() < 0.22) outMin += 60 + Math.floor(r() * 4) * 30; // stayed back for overtime
        const rec = { empId: e.id, date: s, in: hm(inMin), out: hm(outMin) };
        if (otHours(rec, e) > 0) rec.otStatus = i > 4 ? (r() < 0.92 ? 'Approved' : 'Rejected') : 'Pending';
        data.attendance.push(rec);
      });
    }

    // Last month's payroll has already been processed for both companies.
    const lm = prevMonth(thisMonth());
    companies.forEach((c) => data.payruns.push({ companyId: c.id, month: lm, processedOn: iso(addDays(parse(lm + '-01'), daysInMonth(lm))), slips: payrollFor(c.id, lm) }));
    return data;
  }

  /* ================= Data access ================= */

  let db; // loaded below, once every helper it depends on is defined
  function load() {
    const raw = storage.get(STORE_KEY);
    if (raw) { try { return JSON.parse(raw); } catch (e) { /* fall through to seed */ } }
    const s = seed();
    storage.set(STORE_KEY, JSON.stringify(s));
    return s;
  }
  function save() { storage.set(STORE_KEY, JSON.stringify(db)); }

  const emp = (id) => db.employees.find((e) => e.id === id);
  const co = (id) => db.companies.find((c) => c.id === id);
  const coOf = (e) => co(e.companyId) || db.companies[0];
  const shiftOf = (e) => { const c = coOf(e); return c.shifts.find((s) => s.id === e.shiftId) || c.shifts[0]; };
  const shiftHours = (sh) => hoursBetween(sh.start, sh.end) || 8;
  const shiftText = (sh) => `${sh.name} · ${sh.start}–${sh.end}`;
  const weeklyOffOf = (e) => e.weeklyOff || coOf(e).weeklyOff;
  const isOff = (e, d) => weeklyOffOf(e).includes(d.getDay());
  const isHoliday = (c, s) => c.holidays.some((h) => h.date === s);
  const holidayName = (c, s) => c.holidays.find((h) => h.date === s)?.name;
  const activeEmployees = () => db.employees.filter((e) => e.status === 'Active');
  const reportsOf = (id) => activeEmployees().filter((e) => e.managerId === id);
  const attOf = (id, s) => db.attendance.find((a) => a.empId === id && a.date === s);
  const leaveTypes = (e) => [...Object.keys(coOf(e).leavePolicy), 'Unpaid'];
  const leaveOn = (id, s) => db.leaves.find((l) => l.empId === id && l.status === 'Approved' && s >= l.from && s <= l.to);
  const daysText = (days) => days.map((d) => DAYS[d]).join(', ') || 'None';

  function workingDays(e, from, to) {
    let n = 0;
    for (let d = parse(from); d <= parse(to); d = addDays(d, 1)) {
      if (!isOff(e, d) && !isHoliday(coOf(e), iso(d))) n++;
    }
    return n;
  }
  const leaveDays = (l) => workingDays(emp(l.empId), l.from, l.to);

  function balances(id) {
    const e = emp(id); const year = todayISO().slice(0, 4);
    return Object.entries(coOf(e).leavePolicy).map(([type, total]) => {
      const mine = db.leaves.filter((l) => l.empId === id && l.type === type && l.from.startsWith(year));
      const used = mine.filter((l) => l.status === 'Approved').reduce((s, l) => s + leaveDays(l), 0);
      const pending = mine.filter((l) => l.status === 'Pending').reduce((s, l) => s + leaveDays(l), 0);
      return { type, total, used, pending, left: total - used };
    });
  }

  // Late = arrived more than the company's grace minutes after shift start.
  function isLate(e, rec) {
    const diff = (minutes(rec.in) - minutes(shiftOf(e).start) + 1440) % 1440;
    return diff > coOf(e).graceMin && diff < 720;
  }

  // Overtime hours on one attendance record, in 30-minute steps.
  function otHours(rec, e) {
    if (!rec.out) return 0;
    const extra = (hoursBetween(rec.in, rec.out) - shiftOf(e).otAfter) * 60;
    if (extra < coOf(e).rules.otMinMinutes) return 0;
    return Math.floor(extra / 30) * 0.5;
  }

  // present | late | leave | absent | holiday | off | notyet | null (before joining)
  function dayStatus(e, s) {
    if (s < e.joinDate) return null;
    const c = coOf(e);
    const rec = attOf(e.id, s);
    if (isHoliday(c, s)) return 'holiday';
    if (isOff(e, parse(s))) return rec ? (isLate(e, rec) ? 'late' : 'present') : 'off';
    if (rec) return isLate(e, rec) ? 'late' : 'present';
    if (leaveOn(e.id, s)) return 'leave';
    return s < todayISO() ? 'absent' : 'notyet';
  }

  // Day counts for one employee in one month (up to today).
  function monthDays(e, ym) {
    const R = coOf(e).rules;
    const out = { present: 0, late: 0, leave: 0, absent: 0, workdays: 0, hours: 0, paid: 0, lop: 0, ot: 0, otPending: 0 };
    const today = todayISO();
    for (let i = 1; i <= daysInMonth(ym); i++) {
      const s = `${ym}-${pad(i)}`;
      if (s > today) break;
      const st = dayStatus(e, s);
      if (!st || st === 'notyet') continue;
      const rec = attOf(e.id, s);
      if (rec) {
        out.hours += hoursBetween(rec.in, rec.out);
        if (rec.otStatus === 'Approved') out.ot += otHours(rec, e);
        if (rec.otStatus === 'Pending') out.otPending += otHours(rec, e);
      }
      if (st === 'holiday') { if (R.holidayPaidDaily) out.paid++; continue; }
      if (st === 'off') continue;
      out.workdays++;
      if (st === 'present' || st === 'late') { out[st]++; out.paid++; }
      if (st === 'leave') {
        out.leave++;
        if (leaveOn(e.id, s).type === 'Unpaid') out.lop++; else out.paid++;
      }
      if (st === 'absent') { out.absent++; if (R.absentLop) out.lop++; }
    }
    out.rate = out.workdays ? Math.round(((out.present + out.late) / out.workdays) * 100) : 0;
    return out;
  }

  /* ================= Payroll ================= */

  const ptFor = (R, wages) => ([...R.ptSlabs].sort((a, b) => b.from - a.from).find((s) => wages >= s.from)?.amount) || 0;

  function payslip(e, ym) {
    const c = coOf(e); const R = c.rules; const sh = shiftOf(e);
    const dim = daysInMonth(ym);
    const m = monthDays(e, ym);
    const s = e.salary;
    const daily = e.payType === 'daily';
    let fixed, pfBase, otRate, lop = 0, lopAmt = 0;
    if (daily) {
      fixed = s.dailyRate * m.paid;
      pfBase = fixed;
      otRate = s.dailyRate / shiftHours(sh);
    } else {
      fixed = s.basic + s.hra + s.allowances;
      lop = m.lop;
      lopAmt = Math.round((fixed / dim) * lop);
      pfBase = (s.basic * (dim - lop)) / dim;
      otRate = (R.otBasis === 'gross' ? fixed : s.basic) / R.otDays / shiftHours(sh);
    }
    const otAmt = Math.round(m.ot * otRate * R.otMultiplier);
    const gross = fixed + otAmt;
    const earned = gross - lopAmt;
    const pfWage = R.pfCeilingOn ? Math.min(pfBase, R.pfCeiling) : pfBase;
    const pf = Math.round((pfWage * R.pfRate) / 100);
    const pfEr = Math.round((pfWage * R.pfErRate) / 100);
    const esiOn = fixed > 0 && fixed <= R.esiLimit; // eligibility on regular wages, contribution on all earnings
    const esi = esiOn ? Math.ceil((earned * R.esiRate) / 100) : 0;
    const esiEr = esiOn ? Math.ceil((earned * R.esiErRate) / 100) : 0;
    const pt = earned > 0 ? ptFor(R, earned) : 0;
    const tds = daily ? 0 : s.tds || 0;
    const deductions = pf + esi + pt + tds + lopAmt;
    return {
      empId: e.id, name: e.name, title: e.title, dept: e.dept, payType: e.payType,
      basic: s.basic, hra: s.hra, allowances: s.allowances, dailyRate: s.dailyRate, paidDays: m.paid,
      otHours: m.ot, otRate: Math.round(otRate * R.otMultiplier * 100) / 100, otAmt, gross,
      lop, lopAmt, pf, pfEr, esi, esiEr, pt, tds, deductions, net: Math.max(0, gross - deductions),
      pfRate: R.pfRate, esiRate: R.esiRate,
    };
  }

  function payrollFor(companyId, ym) {
    const monthEnd = `${ym}-${pad(daysInMonth(ym))}`;
    return db.employees
      .filter((e) => e.companyId === companyId && e.status === 'Active' && e.joinDate <= monthEnd)
      .map((e) => payslip(e, ym));
  }
  const payrunFor = (companyId, ym) => db.payruns.find((p) => p.companyId === companyId && p.month === ym);

  db = load();

  /* ================= App state ================= */

  const ROUTES = ['dashboard', 'people', 'leave', 'attendance', 'payroll', 'settings'];
  const state = {
    userId: storage.get(SESSION_KEY),
    route: ROUTES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'dashboard',
    scope: 'all',
    profileId: null,
    tabs: { leave: 'mine', attendance: 'mine' },
    peopleQuery: '',
    peopleDept: '',
    leaveFilter: 'All',
    attMonth: thisMonth(),
    payMonth: prevMonth(thisMonth()),
    payCompany: db.companies[0].id,
    setCompany: db.companies[0].id,
    confirm: null,
  };
  if (state.userId && !emp(state.userId)) state.userId = null;

  const me = () => emp(state.userId);
  const isHR = () => me()?.role === 'hr';
  const isManager = () => me()?.role === 'manager';
  const inScope = (e) => state.scope === 'all' || e.companyId === state.scope;
  const team = () => (isHR() ? activeEmployees().filter(inScope) : isManager() ? reportsOf(me().id) : []);
  const hasTeam = () => team().length > 0;
  function canManage(e) {
    const u = me();
    if (!u || !e || e.id === u.id) return false;
    return u.role === 'hr' || e.managerId === u.id;
  }
  const canApprove = (l) => canManage(emp(l.empId));
  const canSeePrivate = (e) => isHR() || e.id === me().id || e.managerId === me().id;
  const approvals = () => db.leaves.filter((l) => l.status === 'Pending' && canApprove(l) && inScope(emp(l.empId)));
  const otApprovals = () => db.attendance.filter((a) => a.otStatus === 'Pending' && canManage(emp(a.empId)) && inScope(emp(a.empId)));
  const scopeName = () => (state.scope === 'all' ? 'All companies' : co(state.scope)?.name);

  /* ================= Rendering helpers ================= */

  const ICONS = {
    dashboard: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>',
    people: '<circle cx="9" cy="8" r="4"/><path d="M2 21v-1a7 7 0 0 1 14 0v1M16 3.5a4 4 0 0 1 0 9M22 21v-1a6 6 0 0 0-4-5.6"/>',
    leave: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M9 15l2 2 4-4"/>',
    attendance: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    payroll: '<rect x="2" y="6" width="20" height="13" rx="2"/><circle cx="12" cy="12.5" r="2.5"/><path d="M6 10v5M18 10v5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  };
  const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`;

  const avatar = (e, cls = '') => `<span class="avatar ${cls}" aria-hidden="true">${esc(initials(e.name))}</span>`;
  const person = (e, sub) => `<div class="person">${avatar(e)}<div class="who"><b>${esc(e.name)}</b><span>${esc(sub ?? e.title)}</span></div></div>`;
  const coTag = (e) => (db.companies.length > 1 ? `<span class="tag">${esc(coOf(e).short)}</span>` : '');
  const STATUS_PILL = {
    Pending: 'warn', Approved: 'good', Rejected: 'bad', Active: 'good', Inactive: '',
    present: 'good', late: 'warn', leave: 'info', absent: 'bad', holiday: 'accent', off: '', notyet: '',
  };
  const STATUS_TEXT = { present: 'Present', late: 'Late', leave: 'On leave', absent: 'Absent', holiday: 'Holiday', off: 'Weekly off', notyet: 'Not in yet' };
  const pill = (status, text) => `<span class="pill ${STATUS_PILL[status] ?? ''}">${esc(text ?? STATUS_TEXT[status] ?? status)}</span>`;
  const roleText = { hr: 'HR', manager: 'Manager', employee: 'Employee' };
  const payText = (e) => (e.payType === 'daily' ? `Daily wage · ${money(e.salary.dailyRate)}/day` : 'Monthly salary');
  const empty = (text) => `<div class="empty">${esc(text)}</div>`;
  const pageHead = (title, sub, actions = '') => `
    <div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>
    <div class="actions">${actions}</div></div>`;
  const companyTabs = (current, action, extra = '') => (db.companies.length > 1 || extra ? `
    <div class="tabs" role="tablist">${db.companies.map((c) => `<button class="tab" role="tab" aria-selected="${c.id === current}" data-action="${action}" data-id="${c.id}">${esc(c.short)}</button>`).join('')}${extra}</div>` : '');

  /* ================= Views ================= */

  function viewLogin() {
    const picks = [['hr', 'HR team', ['E001', 'E005']], ['manager', 'Managers', ['E007', 'E008', 'E002']], ['employee', 'Employees', ['E003', 'E009', 'E011', 'E013']]];
    return `
    <div class="login"><div class="login-card">
      <div class="brand"><span class="brand-mark">P</span><div><div class="brand-name">PeopleDesk</div><div class="brand-co">${db.companies.length} companies</div></div></div>
      <div class="login-hero">
        <h1>Sign in to PeopleDesk</h1>
        <p>This is a demo with sample companies and employees. Pick a person to see the app the way they would. HR sees every company, managers see their team, and employees see their own records.</p>
      </div>
      ${picks.map(([role, label, ids]) => {
        const list = ids.map(emp).filter((e) => e && e.status === 'Active');
        const extra = activeEmployees().filter((e) => e.role === role && !ids.includes(e.id)).slice(0, Math.max(0, 2 - list.length));
        return `
        <div class="user-pick"><div class="label">${label}</div>
          ${[...list, ...extra].map((e) => `
            <button class="user-btn" data-action="login" data-id="${e.id}">${avatar(e)}
              <span class="who"><b>${esc(e.name)}</b><span>${esc(e.title)} · ${esc(coOf(e).short)}${e.payType === 'daily' ? ' · ' + esc(shiftOf(e).name) : ''}</span></span>
              <span class="pill">${roleText[e.role]}</span>
            </button>`).join('')}
        </div>`;
      }).join('')}
    </div></div>`;
  }

  function viewShell(content) {
    const u = me();
    const links = [
      ['dashboard', 'Dashboard'],
      ['people', 'People'],
      ['leave', 'Leave', approvals().length],
      ['attendance', 'Attendance', otApprovals().length],
      ['payroll', isHR() ? 'Payroll' : 'Payslips'],
      ...(isHR() ? [['settings', 'Settings']] : []),
    ];
    return `
    <div class="shell">
      <aside class="nav">
        <div class="brand"><span class="brand-mark">P</span><div><div class="brand-name">PeopleDesk</div><div class="brand-co">${esc(isHR() ? 'Group HR' : coOf(u).name)}</div></div></div>
        ${isHR() && db.companies.length > 1 ? `
        <div class="switcher"><label class="label" for="scope">Company</label>
          <select class="input" id="scope"><option value="all">All companies</option>
          ${db.companies.map((c) => `<option value="${c.id}" ${state.scope === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>` : ''}
        <nav class="nav-links" aria-label="Main">
          ${links.map(([r, label, count]) => `
            <a class="nav-link" href="#${r}" data-route="${r}" ${state.route === r ? 'aria-current="page"' : ''}>
              ${icon(r)}<span>${label}</span>${count ? `<span class="nav-count">${count}</span>` : ''}
            </a>`).join('')}
        </nav>
        <div class="nav-user">${avatar(u)}<div class="who"><b>${esc(u.name)}</b><span class="small muted">${roleText[u.role]}</span></div>
          <button class="btn btn-sm" data-action="logout">Switch user</button></div>
      </aside>
      <main class="main"><div class="main-inner">${content}</div></main>
    </div>`;
  }

  /* ----- Dashboard ----- */

  // Today's record, or last night's still-open night-shift record.
  function openRecord(e) {
    const t = attOf(e.id, todayISO());
    if (t) return t;
    const y = attOf(e.id, iso(addDays(new Date(), -1)));
    return y && !y.out ? y : null;
  }

  function clockCard() {
    const u = me(); const c = coOf(u); const s = todayISO(); const rec = openRecord(u); const lv = leaveOn(u.id, s);
    const sh = shiftOf(u);
    let body;
    if (rec && !rec.out) body = `<button class="btn btn-lg" data-action="checkout">Check out</button>`;
    else if (rec) {
      const ot = otHours(rec, u);
      body = pill('present', `Done · ${num(hoursBetween(rec.in, rec.out))} h${ot ? ` · ${num(ot)} h overtime` : ''}`);
    } else if (isHoliday(c, s)) body = `<p class="muted">Today is a holiday: ${esc(holidayName(c, s))}.</p>`;
    else if (isOff(u, parse(s))) body = `<div class="actions"><span class="muted small">Today is your weekly off.</span><button class="btn" data-action="checkin">Check in anyway</button></div>`;
    else if (lv) body = `<p class="muted">You’re on ${esc(lv.type.toLowerCase())} leave today.</p>`;
    else body = `<button class="btn btn-primary btn-lg" data-action="checkin">Check in</button>`;
    return `
    <section class="panel">
      <div class="clock">
        <div>
          <div class="label">${esc(fmtDay(s))} · ${esc(shiftText(sh))}</div>
          <div class="time" id="clock-time">${nowHM()}</div>
          <div class="clock-times small">
            <span><span class="muted">Check-in</span> <b class="num">${rec?.in ?? '—'}</b></span>
            <span><span class="muted">Check-out</span> <b class="num">${rec?.out ?? '—'}</b></span>
          </div>
        </div>
        <div>${body}</div>
      </div>
    </section>`;
  }

  function approvalsPanel(limit = 5) {
    const list = approvals().sort((a, b) => a.from.localeCompare(b.from));
    return `
    <section class="panel">
      <div class="panel-head"><h2>Leave requests to approve</h2>${list.length > limit ? `<a href="#leave" data-route="leave" data-tab="approvals" class="small">See all ${list.length}</a>` : ''}</div>
      <div class="list">${list.length ? list.slice(0, limit).map(approvalRow).join('') : empty('Nothing waiting for you. New requests from your team will appear here.')}</div>
    </section>`;
  }

  function approvalRow(l) {
    const e = emp(l.empId); const days = leaveDays(l);
    return `
    <div class="row">
      <div class="grow">${person(e, `${l.type} · ${fmtShort(l.from)}${l.to !== l.from ? ' – ' + fmtShort(l.to) : ''} · ${plural(days, 'day')}`)}</div>
      <div class="small muted grow">${coTag(e)} ${esc(l.reason || '')}</div>
      <div class="actions">
        <button class="btn btn-sm btn-good" data-action="decide" data-id="${l.id}" data-status="Approved">Approve</button>
        <button class="btn btn-sm btn-bad" data-action="decide" data-id="${l.id}" data-status="Rejected">Reject</button>
      </div>
    </div>`;
  }

  function otRow(a, actions = true) {
    const e = emp(a.empId);
    return `
    <div class="row">
      <div class="grow">${person(e, `${shiftOf(e).name} · ${fmtDay(a.date)}`)}</div>
      <div class="small grow"><b class="num">${num(otHours(a, e))} h</b> overtime <span class="muted num">(${a.in}–${a.out}, ${num(hoursBetween(a.in, a.out))} h worked)</span></div>
      ${actions && a.otStatus === 'Pending' ? `<div class="actions">
        <button class="btn btn-sm btn-good" data-action="decide-ot" data-id="${e.id}" data-date="${a.date}" data-status="Approved">Approve</button>
        <button class="btn btn-sm btn-bad" data-action="decide-ot" data-id="${e.id}" data-date="${a.date}" data-status="Rejected">Reject</button></div>` : pill(a.otStatus)}
    </div>`;
  }

  function otPanel(limit = 4) {
    const list = otApprovals().sort((a, b) => a.date.localeCompare(b.date));
    if (!list.length) return '';
    return `
    <section class="panel">
      <div class="panel-head"><h2>Overtime to approve</h2>${list.length > limit ? `<a href="#attendance" data-route="attendance" data-tab="overtime" class="small">See all ${list.length}</a>` : ''}</div>
      <div class="list">${list.slice(0, limit).map((a) => otRow(a)).join('')}</div>
    </section>`;
  }

  function holidaysPanel(c) {
    const t = todayISO();
    const next = c.holidays.filter((h) => h.date >= t).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4);
    return `
    <section class="panel">
      <div class="panel-head"><h2>Upcoming holidays</h2>${db.companies.length > 1 ? `<span class="small muted">${esc(c.short)}</span>` : ''}</div>
      <div class="list">${next.length ? next.map((h) => `
        <div class="row"><div class="grow"><b>${esc(h.name)}</b></div><span class="small muted num">${esc(fmtDay(h.date))}</span></div>`).join('') : empty('No more holidays this year.')}</div>
    </section>`;
  }

  function balancesBlock(id) {
    return `<div class="balances">${balances(id).map((b) => `
      <div class="balance">
        <div class="label">${esc(b.type)}</div>
        <div><span class="big">${num(b.left)}</span> <span class="of">of ${b.total} left</span></div>
        ${b.pending ? `<div class="small" style="color:var(--warn)">${b.pending} pending</div>` : ''}
        <div class="meter"><i style="width:${b.total ? Math.max(0, Math.min(100, (b.left / b.total) * 100)) : 0}%"></i></div>
      </div>`).join('')}</div>`;
  }

  function shiftPanel(people) {
    const s = todayISO();
    const rows = [];
    db.companies.filter((c) => state.scope === 'all' || c.id === state.scope).forEach((c) => {
      c.shifts.forEach((sh) => {
        const crew = people.filter((e) => e.companyId === c.id && shiftOf(e).id === sh.id);
        if (!crew.length) return;
        const st = crew.map((e) => dayStatus(e, s));
        const due = st.filter((x) => x && x !== 'off' && x !== 'holiday' && x !== 'leave').length;
        const inNow = st.filter((x) => x === 'present' || x === 'late').length;
        const late = st.filter((x) => x === 'late').length;
        rows.push({ c, sh, due, inNow, late, started: minutes(sh.start) <= minutes(nowHM()) });
      });
    });
    return `
    <section class="panel">
      <div class="panel-head"><h2>Shifts today</h2></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Shift</th><th class="r">Rostered</th><th class="r">In</th><th class="r">Late</th></tr></thead>
        <tbody>${rows.map((x) => `<tr>
          <td><b>${esc(x.sh.name)}</b> <span class="muted num">${x.sh.start}–${x.sh.end}</span>${db.companies.length > 1 ? `<div class="small muted">${esc(x.c.short)}</div>` : ''}</td>
          <td class="num r">${x.due}</td>
          <td class="num r">${x.started ? x.inNow : '<span class="muted">Starts later</span>'}</td>
          <td class="num r">${x.late ? `<span style="color:var(--warn);font-weight:700">${x.late}</span>` : '0'}</td></tr>`).join('')}</tbody>
      </table></div>
    </section>`;
  }

  function viewDashboard() {
    const u = me();
    const s = todayISO();
    const first = u.name.split(' ')[0];
    if (isHR()) {
      const all = activeEmployees().filter(inScope);
      const statuses = all.map((e) => dayStatus(e, s));
      const present = statuses.filter((x) => x === 'present' || x === 'late').length;
      const due = statuses.filter((x) => x && x !== 'off' && x !== 'holiday' && x !== 'leave').length;
      const late = statuses.filter((x) => x === 'late').length;
      const out = all.filter((e) => leaveOn(e.id, s));
      const pend = approvals().length + otApprovals().length;
      const daily = all.filter((e) => e.payType === 'daily').length;
      const groups = {};
      const byCompany = state.scope === 'all' && db.companies.length > 1;
      all.forEach((e) => { const k = byCompany ? coOf(e).short : e.dept; groups[k] = (groups[k] || 0) + 1; });
      const maxG = Math.max(1, ...Object.values(groups));
      const weekEnd = iso(addDays(parse(s), 7));
      const away = db.leaves.filter((l) => l.status === 'Approved' && l.to >= s && l.from <= weekEnd && inScope(emp(l.empId))).sort((a, b) => a.from.localeCompare(b.from));
      const runs = db.companies.filter((c) => state.scope === 'all' || c.id === state.scope)
        .map((c) => ({ c, run: [...db.payruns].filter((p) => p.companyId === c.id).sort((a, b) => b.month.localeCompare(a.month))[0] }));
      return `
      ${pageHead(`Good ${greeting()}, ${first}`, `${esc(scopeName())} · ${esc(parse(s).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}`,
        `<button class="btn" data-action="new-employee">Add employee</button><button class="btn btn-primary" data-route="payroll">Run payroll</button>`)}
      <div class="stats">
        <div class="stat"><div class="label">Headcount</div><div class="value">${all.length}</div><div class="hint">${all.length - daily} monthly · ${daily} daily wage</div></div>
        <div class="stat"><div class="label">In today</div><div class="value">${present}<span class="muted" style="font-size:1rem"> / ${due}</span></div><div class="hint">${late} came in late</div></div>
        <div class="stat"><div class="label">On leave today</div><div class="value">${out.length}</div><div class="hint">${out.map((e) => esc(e.name.split(' ')[0])).join(', ') || 'Everyone’s in'}</div></div>
        <div class="stat ${pend ? 'attn' : ''}"><div class="label">Waiting for you</div><div class="value">${pend}</div><div class="hint">${approvals().length} leave · ${otApprovals().length} overtime</div></div>
      </div>
      <div class="grid grid-main">
        <div class="grid">
          ${approvalsPanel()}
          ${otPanel()}
          ${shiftPanel(all)}
          <section class="panel">
            <div class="panel-head"><h2>Away in the next 7 days</h2></div>
            <div class="list">${away.length ? away.map((l) => { const e = emp(l.empId); return `<div class="row"><div class="grow">${person(e, `${coOf(e).short} · ${e.dept}`)}</div>${pill('leave', l.type)}<span class="small muted num">${fmtShort(l.from)}${l.to !== l.from ? ' – ' + fmtShort(l.to) : ''}</span></div>`; }).join('') : empty('No one has approved leave this week.')}</div>
          </section>
        </div>
        <div class="grid">
          <section class="panel">
            <div class="panel-head"><h2>Payroll</h2></div>
            <div class="list">${runs.map(({ c, run }) => `
              <div class="row"><div class="grow"><b>${esc(c.short)}</b><div class="small muted">${run ? `${monthLabel(run.month)} · ${run.slips.length} people` : 'Not run yet'}</div></div>
              ${run ? `<b class="num">${money(run.slips.reduce((a, x) => a + x.net, 0))}</b>` : ''}</div>`).join('')}</div>
          </section>
          <section class="panel">
            <div class="panel-head"><h2>People by ${byCompany ? 'company' : 'department'}</h2></div>
            <div class="bars">${Object.entries(groups).sort((a, b) => b[1] - a[1]).map(([d, n]) => `
              <div class="bar"><span>${esc(d)}</span><span class="track"><i style="width:${(n / maxG) * 100}%"></i></span><b class="num r">${n}</b></div>`).join('')}</div>
          </section>
          ${holidaysPanel(state.scope === 'all' ? coOf(u) : co(state.scope))}
        </div>
      </div>`;
    }

    const myLeaves = db.leaves.filter((l) => l.empId === u.id).sort((a, b) => b.from.localeCompare(a.from)).slice(0, 4);
    const mySlip = [...db.payruns].filter((p) => p.companyId === u.companyId).sort((a, b) => b.month.localeCompare(a.month))
      .map((p) => ({ month: p.month, slip: p.slips.find((x) => x.empId === u.id) })).find((x) => x.slip);
    const sum = monthDays(u, thisMonth());
    return `
    ${pageHead(`Good ${greeting()}, ${first}`, `${esc(u.title)} · ${esc(coOf(u).name)}`, `<button class="btn btn-primary" data-action="apply-leave">Apply for leave</button>`)}
    ${clockCard()}
    <div class="grid grid-main">
      <div class="grid">
        ${isManager() ? approvalsPanel() + otPanel() : ''}
        <section class="panel">
          <div class="panel-head"><h2>My leave balance</h2><span class="small muted">${todayISO().slice(0, 4)}</span></div>
          ${balancesBlock(u.id)}
        </section>
        <section class="panel">
          <div class="panel-head"><h2>My recent requests</h2><a href="#leave" data-route="leave" class="small">All requests</a></div>
          <div class="list">${myLeaves.length ? myLeaves.map((l) => leaveRow(l)).join('') : empty('You haven’t applied for leave yet.')}</div>
        </section>
      </div>
      <div class="grid">
        <section class="panel">
          <div class="panel-head"><h2>This month</h2></div>
          <dl class="kv"><dt>Attendance</dt><dd class="num">${sum.rate}%</dd><dt>Days present</dt><dd class="num">${sum.present + sum.late} of ${sum.workdays}</dd><dt>Late arrivals</dt><dd class="num">${sum.late}</dd><dt>Hours logged</dt><dd class="num">${num(sum.hours)}</dd>
          <dt>Overtime</dt><dd class="num">${num(sum.ot)} h approved${sum.otPending ? ` · ${num(sum.otPending)} h pending` : ''}</dd></dl>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Latest payslip</h2></div>
          ${mySlip ? `<dl class="kv"><dt>Month</dt><dd>${monthLabel(mySlip.month)}</dd><dt>Net pay</dt><dd class="num">${money(mySlip.slip.net)}</dd></dl>
            <div style="margin-top:12px"><button class="btn btn-sm" data-action="view-slip" data-month="${mySlip.month}" data-id="${u.id}">View payslip</button></div>` : empty('No payslips yet.')}
        </section>
        ${holidaysPanel(coOf(u))}
      </div>
    </div>`;
  }

  function greeting() { const h = new Date().getHours(); return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'; }

  /* ----- People ----- */

  function viewPeople() {
    if (state.profileId && emp(state.profileId)) return viewProfile(emp(state.profileId));
    const q = state.peopleQuery.toLowerCase();
    const base = db.employees.filter((e) => (isHR() ? inScope(e) : e.status === 'Active' && e.companyId === me().companyId));
    const depts = [...new Set(base.map((e) => e.dept))].sort();
    const list = base
      .filter((e) => !state.peopleDept || e.dept === state.peopleDept)
      .filter((e) => !q || [e.name, e.title, e.dept, e.email, e.id, coOf(e).short].join(' ').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
    const showCo = isHR() && state.scope === 'all' && db.companies.length > 1;
    return `
    ${pageHead('People', `${base.filter((e) => e.status === 'Active').length} active employees · ${esc(isHR() ? scopeName() : coOf(me()).name)}`, isHR() ? `<button class="btn btn-primary" data-action="new-employee">Add employee</button>` : '')}
    <section class="panel">
      <div class="toolbar" style="margin-bottom:12px">
        <input class="input search" id="people-search" type="search" placeholder="Search by name, role, email or ID" value="${esc(state.peopleQuery)}" aria-label="Search people">
        <select class="input" id="people-dept" aria-label="Department">
          <option value="">All departments</option>
          ${depts.map((d) => `<option ${d === state.peopleDept ? 'selected' : ''}>${esc(d)}</option>`).join('')}
        </select>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th>${showCo ? '<th>Company</th>' : ''}<th>Department</th><th>Shift</th><th>Pay</th><th>Phone</th><th>Status</th></tr></thead>
        <tbody>${list.map((e) => `
          <tr class="click" data-action="open-profile" data-id="${e.id}" tabindex="0">
            <td>${person(e)}</td>${showCo ? `<td>${esc(coOf(e).short)}</td>` : ''}<td>${esc(e.dept)}</td><td class="num">${esc(shiftOf(e).name)}</td>
            <td>${e.payType === 'daily' ? '<span class="pill info">Daily wage</span>' : '<span class="pill">Monthly</span>'}</td>
            <td class="num">${esc(e.phone)}</td><td>${pill(e.status)}</td>
          </tr>`).join('')}</tbody>
      </table></div>
      ${list.length ? '' : empty('No one matches that search.')}
    </section>`;
  }

  function viewProfile(e) {
    const mgr = emp(e.managerId);
    const c = coOf(e);
    const priv = canSeePrivate(e);
    const sum = monthDays(e, thisMonth());
    const s = e.salary; const gross = s.basic + s.hra + s.allowances;
    const reports = reportsOf(e.id);
    return `
    <div><button class="btn btn-ghost btn-sm" data-action="close-profile">← Back to people</button></div>
    <section class="panel">
      <div class="profile-head">
        ${avatar(e, 'lg')}
        <div class="who"><h1>${esc(e.name)}</h1><p class="muted">${esc(e.title)} · ${esc(e.dept)} · ${esc(c.name)}</p></div>
        <div class="actions">${pill(e.status)}
          ${isHR() ? `<button class="btn" data-action="edit-employee" data-id="${e.id}">Edit</button>
          <button class="btn ${e.status === 'Active' ? 'btn-bad' : ''}" data-action="toggle-status" data-id="${e.id}">${e.status === 'Active' ? 'Mark as left' : 'Reactivate'}</button>` : ''}
        </div>
      </div>
    </section>
    <div class="grid grid-2">
      <section class="panel">
        <div class="panel-head"><h2>Work details</h2></div>
        <dl class="kv">
          <dt>Employee ID</dt><dd class="mono">${esc(e.id)}</dd>
          <dt>Company</dt><dd>${esc(c.name)}</dd>
          <dt>Email</dt><dd>${esc(e.email || '—')}</dd>
          <dt>Phone</dt><dd class="num">${esc(e.phone || '—')}</dd>
          <dt>Reports to</dt><dd>${mgr ? `<a href="#people" data-action="open-profile" data-id="${mgr.id}">${esc(mgr.name)}</a>` : '—'}</dd>
          <dt>Shift</dt><dd>${esc(shiftText(shiftOf(e)))}</dd>
          <dt>Weekly off</dt><dd>${esc(weeklyOffOf(e).map((d) => DAYS_LONG[d]).join(', ') || 'None')}${e.weeklyOff ? '' : ' <span class="muted">(company default)</span>'}</dd>
          <dt>Joined</dt><dd>${fmtDate(e.joinDate)}</dd>
          ${priv && e.dob ? `<dt>Birthday</dt><dd>${parse(e.dob).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}</dd>` : ''}
          <dt>App access</dt><dd>${roleText[e.role]}</dd>
          ${reports.length ? `<dt>Team</dt><dd>${reports.map((r) => esc(r.name)).join(', ')}</dd>` : ''}
        </dl>
      </section>
      ${priv ? `
      <section class="panel">
        <div class="panel-head"><h2>Pay</h2><span class="small muted">${esc(payText(e))}</span></div>
        ${isHR() || e.id === me().id ? (e.payType === 'daily' ? `<dl class="kv">
          <dt>Daily rate</dt><dd class="num">${money(s.dailyRate)}</dd>
          <dt>Approx. per month</dt><dd class="num">${money(s.dailyRate * c.rules.otDays)} <span class="muted">(${c.rules.otDays} days)</span></dd>
          <dt>Overtime rate</dt><dd class="num">${money((s.dailyRate / shiftHours(shiftOf(e))) * c.rules.otMultiplier)} per hour</dd>
        </dl>` : `<dl class="kv">
          <dt>Basic</dt><dd class="num">${money(s.basic)}</dd>
          <dt>HRA</dt><dd class="num">${money(s.hra)}</dd>
          <dt>Other allowances</dt><dd class="num">${money(s.allowances)}</dd>
          <dt>Gross per month</dt><dd class="num"><b>${money(gross)}</b></dd>
          <dt>TDS per month</dt><dd class="num">${money(s.tds)}</dd>
        </dl>`) : empty('Only HR and the employee can see pay details.')}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Leave balance</h2></div>
        ${balancesBlock(e.id)}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Attendance · ${monthLabel(thisMonth())}</h2></div>
        ${monthStrip(e, thisMonth())}
        <p class="small muted" style="margin-top:10px">${sum.rate}% attendance · ${sum.late} late · ${sum.absent} absent · ${num(sum.ot)} h overtime</p>
      </section>` : ''}
    </div>`;
  }

  /* ----- Leave ----- */

  function leaveRow(l, showPerson) {
    const days = leaveDays(l); const e = emp(l.empId);
    const decider = l.decidedBy && emp(l.decidedBy);
    return `
    <div class="row">
      <div class="grow">${showPerson ? person(e, `${l.type} leave · ${coOf(e).short}`) : `<b>${esc(l.type)} leave</b><div class="small muted">${esc(l.reason || 'No reason given')}</div>`}</div>
      <div class="small num">${fmtShort(l.from)}${l.to !== l.from ? ' – ' + fmtShort(l.to) : ''}<div class="muted">${plural(days, 'day')}</div></div>
      <div style="min-width:110px;text-align:right">${pill(l.status)}${decider ? `<div class="small muted">by ${esc(decider.name.split(' ')[0])}</div>` : ''}</div>
      ${l.status === 'Pending' && l.empId === me().id ? `<button class="btn btn-sm btn-ghost" data-action="cancel-leave" data-id="${l.id}">Cancel</button>` : ''}
      ${showPerson && l.status === 'Pending' && canApprove(l) ? `<div class="actions"><button class="btn btn-sm btn-good" data-action="decide" data-id="${l.id}" data-status="Approved">Approve</button><button class="btn btn-sm btn-bad" data-action="decide" data-id="${l.id}" data-status="Rejected">Reject</button></div>` : ''}
    </div>`;
  }

  function viewLeave() {
    const u = me();
    const tabs = [['mine', 'My leave']];
    if (hasTeam()) tabs.push(['approvals', `To approve (${approvals().length})`]);
    if (isHR()) tabs.push(['all', 'All requests']);
    let tab = state.tabs.leave;
    if (!tabs.some(([k]) => k === tab)) tab = 'mine';
    let body;
    if (tab === 'mine') {
      const mine = db.leaves.filter((l) => l.empId === u.id).sort((a, b) => b.from.localeCompare(a.from));
      body = `
      <section class="panel"><div class="panel-head"><h2>Balance for ${todayISO().slice(0, 4)}</h2></div>${balancesBlock(u.id)}</section>
      <section class="panel"><div class="panel-head"><h2>My requests</h2></div>
        <div class="list">${mine.length ? mine.map((l) => leaveRow(l)).join('') : empty('You haven’t applied for leave yet. Use “Apply for leave” to send your first request.')}</div></section>`;
    } else if (tab === 'approvals') {
      const list = approvals().sort((a, b) => a.from.localeCompare(b.from));
      body = `<section class="panel"><div class="list">${list.length ? list.map(approvalRow).join('') : empty('Nothing waiting for you.')}</div></section>`;
    } else {
      const f = state.leaveFilter;
      const list = db.leaves.filter((l) => inScope(emp(l.empId)) && (f === 'All' || l.status === f)).sort((a, b) => b.from.localeCompare(a.from));
      body = `<section class="panel">
        <div class="toolbar" style="margin-bottom:8px">${['All', 'Pending', 'Approved', 'Rejected'].map((s) => `<button class="btn btn-sm ${f === s ? 'btn-primary' : ''}" data-action="leave-filter" data-status="${s}">${s}</button>`).join('')}</div>
        <div class="list">${list.length ? list.map((l) => leaveRow(l, true)).join('') : empty('No requests with this status.')}</div></section>`;
    }
    return `
    ${pageHead('Leave', 'Apply for time off and track approvals.', `<button class="btn btn-primary" data-action="apply-leave">Apply for leave</button>`)}
    ${tabs.length > 1 ? `<div class="tabs" role="tablist">${tabs.map(([k, label]) => `<button class="tab" role="tab" aria-selected="${k === tab}" data-action="tab" data-view="leave" data-tab="${k}">${label}</button>`).join('')}</div>` : ''}
    ${body}`;
  }

  /* ----- Attendance ----- */

  function monthStrip(e, ym) {
    const c = coOf(e);
    const cells = [];
    for (let i = 1; i <= daysInMonth(ym); i++) {
      const s = `${ym}-${pad(i)}`;
      const st = dayStatus(e, s) || 'notyet';
      const rec = attOf(e.id, s);
      const ot = rec ? otHours(rec, e) : 0;
      const tip = `${fmtDay(s)}: ${STATUS_TEXT[st]}${rec ? ` (${rec.in}–${rec.out ?? '…'})` : ''}${ot ? ` · ${num(ot)} h OT` : ''}${st === 'holiday' ? ' · ' + holidayName(c, s) : ''}`;
      cells.push(`<div class="day ${st}${ot ? ' ot' : ''}" title="${esc(tip)}">${i}</div>`);
    }
    return `<div class="strip">${cells.join('')}</div>
      <div class="legend">${['present', 'late', 'leave', 'absent', 'holiday'].map((k) => `<span><i class="day ${k}" style="aspect-ratio:auto"></i>${STATUS_TEXT[k]}</span>`).join('')}<span><i class="day present ot" style="aspect-ratio:auto"></i>Overtime</span></div>`;
  }

  function viewAttendance() {
    const u = me();
    const tabs = [['mine', 'My attendance']];
    if (hasTeam()) tabs.push(['today', 'Team today'], ['summary', 'Monthly summary'], ['overtime', `Overtime (${otApprovals().length})`]);
    let tab = state.tabs.attendance;
    if (!tabs.some(([k]) => k === tab)) tab = 'mine';
    const ym = state.attMonth;
    const monthPicker = `<input class="input" type="month" id="att-month" value="${ym}" max="${thisMonth()}" aria-label="Month">`;
    let body;
    if (tab === 'mine') {
      const sum = monthDays(u, ym);
      const rows = [];
      for (let i = daysInMonth(ym); i >= 1; i--) {
        const s = `${ym}-${pad(i)}`;
        if (s > todayISO()) continue;
        const st = dayStatus(u, s);
        if (!st || st === 'off') continue;
        const rec = attOf(u.id, s);
        const ot = rec ? otHours(rec, u) : 0;
        rows.push(`<tr><td>${fmtDay(s)}</td><td class="num">${rec?.in ?? '—'}</td><td class="num">${rec?.out ?? '—'}</td><td class="num r">${rec?.out ? num(hoursBetween(rec.in, rec.out)) : '—'}</td>
          <td class="num r">${ot ? `${num(ot)} h ${pill(rec.otStatus || 'Pending')}` : '—'}</td><td>${pill(st, st === 'holiday' ? holidayName(coOf(u), s) : undefined)}</td></tr>`);
      }
      body = `
      ${ym === thisMonth() ? clockCard() : ''}
      <section class="panel">
        <div class="panel-head"><h2>${monthLabel(ym)}</h2>${monthPicker}</div>
        ${monthStrip(u, ym)}
        <p class="small muted" style="margin-top:10px">${sum.rate}% attendance · ${sum.present + sum.late} of ${sum.workdays} working days · ${sum.late} late · ${num(sum.ot)} h overtime approved</p>
      </section>
      <section class="panel"><div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>In</th><th>Out</th><th class="r">Hours</th><th class="r">Overtime</th><th>Status</th></tr></thead>
        <tbody>${rows.join('')}</tbody></table></div>${rows.length ? '' : empty('No working days recorded for this month yet.')}</section>`;
    } else if (tab === 'today') {
      const s = todayISO();
      const people = team().sort((a, b) => a.companyId.localeCompare(b.companyId) || shiftOf(a).start.localeCompare(shiftOf(b).start) || a.name.localeCompare(b.name));
      body = `<section class="panel">
        <div class="panel-head"><h2>${esc(fmtDay(s))}</h2><span class="small muted">Late after shift start + grace minutes</span></div>
        <div class="table-wrap"><table>
        <thead><tr><th>Employee</th><th>Shift</th><th>Status</th><th>In</th><th>Out</th>${isHR() ? '<th></th>' : ''}</tr></thead>
        <tbody>${people.map((e) => {
          const rec = attOf(e.id, s); const st = dayStatus(e, s);
          return `<tr><td>${person(e, `${coOf(e).short} · ${e.dept}`)}</td><td class="num">${esc(shiftText(shiftOf(e)))}</td><td>${st ? pill(st) : '—'}</td><td class="num">${rec?.in ?? '—'}</td><td class="num">${rec?.out ?? '—'}</td>
          ${isHR() ? `<td class="r"><button class="btn btn-sm" data-action="edit-att" data-id="${e.id}" data-date="${s}">Edit</button></td>` : ''}</tr>`;
        }).join('')}</tbody></table></div></section>`;
    } else if (tab === 'summary') {
      const people = team().sort((a, b) => a.name.localeCompare(b.name));
      body = `<section class="panel">
        <div class="panel-head"><h2>${monthLabel(ym)}</h2>${monthPicker}</div>
        <div class="table-wrap"><table>
        <thead><tr><th>Employee</th><th class="r">Present</th><th class="r">Late</th><th class="r">Leave</th><th class="r">Absent</th><th class="r">Overtime</th><th class="r">Rate</th></tr></thead>
        <tbody>${people.map((e) => { const m = monthDays(e, ym); return `
          <tr class="click" data-action="open-profile" data-id="${e.id}"><td>${person(e, `${coOf(e).short} · ${shiftOf(e).name}`)}</td>
          <td class="num r">${m.present + m.late}</td><td class="num r">${m.late}</td><td class="num r">${m.leave}</td>
          <td class="num r" ${m.absent ? 'style="color:var(--bad);font-weight:700"' : ''}>${m.absent}</td><td class="num r">${m.ot ? num(m.ot) + ' h' : '—'}</td>
          <td class="r">${pill(m.rate >= 90 ? 'present' : m.rate >= 75 ? 'late' : 'absent', m.rate + '%')}</td></tr>`; }).join('')}</tbody>
        </table></div></section>`;
    } else {
      const pending = otApprovals().sort((a, b) => a.date.localeCompare(b.date));
      const since = iso(addDays(new Date(), -14));
      const recent = db.attendance.filter((a) => a.otStatus && a.otStatus !== 'Pending' && a.date >= since && canManage(emp(a.empId)) && inScope(emp(a.empId)))
        .sort((a, b) => b.date.localeCompare(a.date));
      body = `
      <section class="panel"><div class="panel-head"><h2>Waiting for approval</h2>${pending.length > 1 ? `<button class="btn btn-sm btn-good" data-action="approve-all-ot">Approve all ${pending.length}</button>` : ''}</div>
        <p class="small muted" style="margin-bottom:6px">Overtime is counted when someone works past their shift’s overtime limit. Only approved overtime is paid.</p>
        <div class="list">${pending.length ? pending.map((a) => otRow(a)).join('') : empty('No overtime waiting for approval.')}</div></section>
      <section class="panel"><div class="panel-head"><h2>Decided in the last 14 days</h2></div>
        <div class="list">${recent.length ? recent.map((a) => otRow(a, false)).join('') : empty('Nothing decided recently.')}</div></section>`;
    }
    return `
    ${pageHead('Attendance', 'Shifts, daily check-ins, overtime and monthly records.')}
    ${tabs.length > 1 ? `<div class="tabs" role="tablist">${tabs.map(([k, label]) => `<button class="tab" role="tab" aria-selected="${k === tab}" data-action="tab" data-view="attendance" data-tab="${k}">${label}</button>`).join('')}</div>` : ''}
    ${body}`;
  }

  /* ----- Payroll ----- */

  function rulesSummary(c) {
    const R = c.rules;
    const slabs = [...R.ptSlabs].sort((a, b) => a.from - b.from).filter((s) => s.amount > 0).map((s) => `${money(s.amount)} from ${money(s.from)}`).join(', ') || 'none';
    return `PF ${num(R.pfRate)}% of basic${R.pfCeilingOn ? ` up to ${money(R.pfCeiling)}` : ''}. ESI ${num(R.esiRate)}% (company ${num(R.esiErRate)}%) for wages up to ${money(R.esiLimit)}. Professional tax: ${slabs}. Overtime at ${num(R.otMultiplier)}× the hourly rate. ${R.absentLop ? 'Absent days are loss of pay.' : 'Absent days are not deducted.'}`;
  }

  function viewPayroll() {
    const u = me();
    if (!isHR()) {
      const mine = [...db.payruns].filter((p) => p.companyId === u.companyId).sort((a, b) => b.month.localeCompare(a.month))
        .map((p) => ({ month: p.month, slip: p.slips.find((x) => x.empId === u.id) })).filter((x) => x.slip);
      return `
      ${pageHead('Payslips', 'Your monthly pay statements.')}
      <section class="panel"><div class="list">${mine.length ? mine.map((x) => `
        <div class="row"><div class="grow"><b>${monthLabel(x.month)}</b><div class="small muted">Gross ${money(x.slip.gross)} · Deductions ${money(x.slip.deductions)}${x.slip.otHours ? ` · ${num(x.slip.otHours)} h overtime` : ''}</div></div>
        <b class="num">${money(x.slip.net)}</b><button class="btn btn-sm" data-action="view-slip" data-month="${x.month}" data-id="${u.id}">View</button></div>`).join('')
        : empty('No payslips yet. They appear here once HR runs payroll.')}</div></section>`;
    }
    if (state.scope !== 'all') state.payCompany = state.scope;
    const c = co(state.payCompany) || db.companies[0];
    const ym = state.payMonth;
    const run = payrunFor(c.id, ym);
    const slips = run ? run.slips : payrollFor(c.id, ym);
    const tot = (k) => slips.reduce((a, x) => a + (x[k] || 0), 0);
    const future = ym > thisMonth();
    const pendingOt = db.attendance.filter((a) => a.otStatus === 'Pending' && a.date.startsWith(ym) && emp(a.empId)?.companyId === c.id).length;
    return `
    ${pageHead('Payroll', `Calculate pay and issue payslips for ${esc(c.name)}.`,
      `<input class="input" type="month" id="pay-month" value="${ym}" aria-label="Payroll month">
       ${run ? `<button class="btn" data-action="rerun-payroll">Recalculate</button>` : `<button class="btn btn-primary" data-action="run-payroll" ${future || !slips.length ? 'disabled' : ''}>Run payroll for ${monthLabel(ym)}</button>`}`)}
    ${state.scope === 'all' ? companyTabs(c.id, 'pay-company') : ''}
    ${pendingOt && !run ? `<div class="note warn">${plural(pendingOt, 'overtime entry')} for this month ${pendingOt === 1 ? 'is' : 'are'} still waiting for approval and won’t be paid. <a href="#attendance" data-route="attendance" data-tab="overtime">Review overtime</a></div>` : ''}
    <div class="stats">
      <div class="stat"><div class="label">Status</div><div class="value" style="font-size:1.1rem;margin-top:12px">${run ? pill('Approved', 'Processed') : pill('Pending', 'Not run yet')}</div><div class="hint">${run ? 'on ' + fmtDate(run.processedOn) : 'Showing a preview'}</div></div>
      <div class="stat"><div class="label">Gross pay</div><div class="value">${money(tot('gross'))}</div><div class="hint">${slips.length} people · OT ${money(tot('otAmt'))}</div></div>
      <div class="stat"><div class="label">Net pay</div><div class="value">${money(tot('net'))}</div><div class="hint">Deductions ${money(tot('deductions'))}</div></div>
      <div class="stat"><div class="label">Company contributions</div><div class="value">${money(tot('pfEr') + tot('esiEr'))}</div><div class="hint">PF ${money(tot('pfEr'))} · ESI ${money(tot('esiEr'))}</div></div>
    </div>
    <section class="panel">
      <div class="panel-head"><h2>${monthLabel(ym)}</h2>${run ? '' : '<span class="small muted">Preview: payslips are issued when you run payroll</span>'}</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Employee</th><th>Paid for</th><th class="r">Overtime</th><th class="r">Gross</th><th class="r">PF</th><th class="r">ESI</th><th class="r">Prof. tax</th><th class="r">TDS</th><th class="r">Loss of pay</th><th class="r">Net pay</th>${run ? '<th></th>' : ''}</tr></thead>
        <tbody>${slips.map((x) => `<tr>
          <td>${person(emp(x.empId) || { name: x.name }, x.title)}</td>
          <td class="num small">${x.payType === 'daily' ? `${x.paidDays} days × ${money(x.dailyRate)}` : 'Monthly'}</td>
          <td class="num r">${x.otHours ? `${money(x.otAmt)} <span class="muted">(${num(x.otHours)} h)</span>` : '—'}</td>
          <td class="num r">${money(x.gross)}</td><td class="num r">${money(x.pf)}</td><td class="num r">${x.esi ? money(x.esi) : '—'}</td><td class="num r">${money(x.pt)}</td><td class="num r">${money(x.tds)}</td>
          <td class="num r">${x.lop ? `${money(x.lopAmt)} <span class="muted">(${x.lop}d)</span>` : '—'}</td>
          <td class="num r"><b>${money(x.net)}</b></td>
          ${run ? `<td class="r"><button class="btn btn-sm" data-action="view-slip" data-month="${ym}" data-id="${x.empId}">Payslip</button></td>` : ''}
        </tr>`).join('')}</tbody>
        <tfoot><tr><td>Total</td><td></td><td class="num r">${money(tot('otAmt'))}</td><td class="num r">${money(tot('gross'))}</td><td class="num r">${money(tot('pf'))}</td><td class="num r">${money(tot('esi'))}</td><td class="num r">${money(tot('pt'))}</td><td class="num r">${money(tot('tds'))}</td><td class="num r">${money(tot('lopAmt'))}</td><td class="num r">${money(tot('net'))}</td>${run ? '<td></td>' : ''}</tr></tfoot>
      </table></div>
      ${slips.length ? '' : empty('No active employees had joined by this month.')}
      <p class="small muted" style="margin-top:12px">${esc(rulesSummary(c))} <a href="#settings" data-route="settings" data-company="${c.id}">Change payroll rules</a></p>
    </section>`;
  }

  function slipHTML(ym, empId) {
    const e = emp(empId); const c = e ? coOf(e) : db.companies[0];
    const run = payrunFor(c.id, ym); const x = run?.slips.find((s) => s.empId === empId);
    if (!x) return empty('Payslip not found.');
    const line = (k, v) => `<div class="slip-line"><span>${k}</span><span class="num">${money(v)}</span></div>`;
    const earnings = x.payType === 'daily'
      ? line(`Wages (${x.paidDays} days × ${money(x.dailyRate)})`, x.paidDays * x.dailyRate)
      : line('Basic', x.basic) + line('House rent allowance', x.hra) + line('Other allowances', x.allowances);
    return `<div class="slip">
      <div class="slip-head">
        <div><div class="label">Payslip · ${monthLabel(ym)}</div><h2 style="margin-top:4px">${esc(c.name)}</h2><div class="small muted">${esc(c.address)}</div>
          <div class="small muted mono">PF ${esc(c.pfCode)} · ESI ${esc(c.esiCode)}</div></div>
        <div class="small" style="text-align:right"><b>${esc(x.name)}</b><div class="muted">${esc(x.title)} · <span class="mono">${esc(x.empId)}</span></div>${e ? `<div class="muted">Joined ${fmtDate(e.joinDate)}</div>` : ''}</div>
      </div>
      <div class="slip-cols">
        <div><div class="label" style="margin-bottom:6px">Earnings</div>
          ${earnings}${x.otHours ? line(`Overtime (${num(x.otHours)} h × ${money(x.otRate)})`, x.otAmt) : ''}
          <div class="slip-line total"><span>Gross earnings</span><span class="num">${money(x.gross)}</span></div></div>
        <div><div class="label" style="margin-bottom:6px">Deductions</div>
          ${line(`Provident fund (${num(x.pfRate)}%)`, x.pf)}${x.esi ? line(`ESI (${num(x.esiRate)}%)`, x.esi) : ''}${line('Professional tax', x.pt)}${x.tds ? line('Income tax (TDS)', x.tds) : ''}${x.lop ? line(`Loss of pay (${plural(x.lop, 'day')})`, x.lopAmt) : ''}
          <div class="slip-line total"><span>Total deductions</span><span class="num">${money(x.deductions)}</span></div></div>
      </div>
      <div class="slip-net"><div><div class="label">Net pay</div><div class="small">Rupees ${inWords(x.net)} only</div></div><div class="amt">${money(x.net)}</div></div>
      <p class="small muted">Company contributions (not deducted from pay): PF ${money(x.pfEr)}${x.esiEr ? ` · ESI ${money(x.esiEr)}` : ''}</p>
    </div>`;
  }

  /* ----- Settings ----- */

  // Editable row lists (shifts, leave types, PT slabs). Rows are added and removed
  // in the DOM only; nothing is saved until the form is submitted.
  const ROW_TEMPLATES = {
    shift: (s = { id: '', name: '', start: '09:00', end: '18:00', otAfter: 9 }) => `
      <div class="edit-row cols-shift" data-row data-id="${esc(s.id)}">
        <input class="input" data-f="name" value="${esc(s.name)}" placeholder="Shift name" aria-label="Shift name" required>
        <input class="input" data-f="start" type="time" value="${esc(s.start)}" aria-label="Start time" required>
        <input class="input" data-f="end" type="time" value="${esc(s.end)}" aria-label="End time" required>
        <input class="input" data-f="otAfter" type="number" min="1" max="24" step="0.5" value="${s.otAfter}" aria-label="Overtime after hours" required>
        <button class="btn btn-sm btn-ghost" type="button" data-action="remove-row" aria-label="Remove shift">Remove</button>
      </div>`,
    leave: (t = { name: '', days: 0 }) => `
      <div class="edit-row cols-2" data-row>
        <input class="input" data-f="name" value="${esc(t.name)}" placeholder="Leave type, e.g. Maternity" aria-label="Leave type" required>
        <input class="input" data-f="days" type="number" min="0" max="365" step="0.5" value="${t.days}" aria-label="Days per year" required>
        <button class="btn btn-sm btn-ghost" type="button" data-action="remove-row" aria-label="Remove leave type">Remove</button>
      </div>`,
    slab: (s = { from: 0, amount: 0 }) => `
      <div class="edit-row cols-2" data-row>
        <input class="input" data-f="from" type="number" min="0" step="1" value="${s.from}" aria-label="Monthly wages from" required>
        <input class="input" data-f="amount" type="number" min="0" step="1" value="${s.amount}" aria-label="Tax per month" required>
        <button class="btn btn-sm btn-ghost" type="button" data-action="remove-row" aria-label="Remove slab">Remove</button>
      </div>`,
  };
  const readRows = (form, list) => [...form.querySelectorAll(`[data-list="${list}"] [data-row]`)].map((row) => {
    const o = { id: row.dataset.id };
    row.querySelectorAll('[data-f]').forEach((i) => { o[i.dataset.f] = i.type === 'number' ? parseFloat(i.value) : i.value.trim(); });
    return o;
  });

  function viewSettings() {
    const c = co(state.setCompany) || db.companies[0];
    const R = c.rules;
    const hols = [...c.holidays].sort((a, b) => a.date.localeCompare(b.date));
    const field = (id, label, input, hint) => `<div class="field"><label for="${id}">${label}</label>${input}${hint ? `<span class="small muted">${hint}</span>` : ''}</div>`;
    const numIn = (id, name, val, step = 1, extra = '') => `<input class="input" id="${id}" name="${name}" type="number" min="0" step="${step}" value="${val}" required ${extra}>`;
    const check = (id, name, on, label) => `<label class="check" for="${id}"><input type="checkbox" id="${id}" name="${name}" ${on ? 'checked' : ''}> ${label}</label>`;
    const staff = db.employees.filter((e) => e.companyId === c.id && e.status === 'Active').length;
    return `
    ${pageHead('Settings', 'Every rule here can be changed at any time. Changes apply to future payroll runs and do not alter payslips already issued.',
      `<button class="btn" data-action="new-company">Add company</button>`)}
    ${companyTabs(c.id, 'set-company')}
    <div class="grid grid-2">
      <section class="panel">
        <div class="panel-head"><h2>Company details</h2><span class="small muted">${plural(staff, 'active employee')}</span></div>
        <form class="form" data-form="company" data-id="${c.id}">
          ${field('co-name', 'Registered name', `<input class="input" id="co-name" name="name" value="${esc(c.name)}" required>`)}
          ${field('co-short', 'Short name', `<input class="input" id="co-short" name="short" value="${esc(c.short)}" maxlength="20" required>`, 'Used in lists and tabs.')}
          ${field('co-addr', 'Address', `<textarea class="input" id="co-addr" name="address" rows="2">${esc(c.address)}</textarea>`, 'Printed on payslips.')}
          <div class="form-grid">
            ${field('co-pf', 'PF establishment code', `<input class="input mono" id="co-pf" name="pfCode" value="${esc(c.pfCode)}">`)}
            ${field('co-esi', 'ESI code', `<input class="input mono" id="co-esi" name="esiCode" value="${esc(c.esiCode)}">`)}
          </div>
          <div><button class="btn btn-primary" type="submit">Save company details</button></div>
        </form>
      </section>

        <section class="panel">
          <div class="panel-head"><h2>Leave policy</h2><span class="small muted">days per year</span></div>
          <form class="form" data-form="leave-policy" data-id="${c.id}">
            <div class="edit-head cols-2"><span>Leave type</span><span>Days per year</span><span></span></div>
            <div class="edit-list" data-list="leave">${Object.entries(c.leavePolicy).map(([name, days]) => ROW_TEMPLATES.leave({ name, days })).join('')}</div>
            <div><button class="btn btn-sm" type="button" data-action="add-row" data-kind="leave" data-list="leave">Add leave type</button></div>
            <span class="small muted">Unpaid leave is always available and is deducted from pay.</span>
            <div><button class="btn btn-primary" type="submit">Save leave policy</button></div>
          </form>
        </section>
      <section class="panel span-2">
        <div class="panel-head"><h2>Working time</h2></div>
        <form class="form" data-form="worktime" data-id="${c.id}">
          <div class="field"><span class="field-label">Default weekly off</span>
            <div class="days">${DAYS.map((d, i) => `<label class="day-check" for="wo-${i}"><input type="checkbox" id="wo-${i}" name="wo" value="${i}" ${c.weeklyOff.includes(i) ? 'checked' : ''}><span>${d}</span></label>`).join('')}</div>
            <span class="small muted">Each employee can have their own weekly off instead (set on their profile).</span></div>
          ${field('co-grace', 'Late after (minutes past shift start)', numIn('co-grace', 'graceMin', c.graceMin, 1, 'max="240"'))}
          <div class="field"><span class="field-label">Shifts</span>
            <div class="edit-head cols-shift"><span>Name</span><span>Start</span><span>End</span><span>Overtime after (h)</span><span></span></div>
            <div class="edit-list" data-list="shifts">${c.shifts.map((s) => ROW_TEMPLATES.shift(s)).join('')}</div>
            <div><button class="btn btn-sm" type="button" data-action="add-row" data-kind="shift" data-list="shifts">Add shift</button></div>
            <span class="small muted">Overnight shifts are fine (e.g. 22:00 to 06:00). Hours worked beyond “Overtime after” count as overtime.</span></div>
          <div><button class="btn btn-primary" type="submit">Save working time</button></div>
        </form>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Payroll rules</h2></div>
        <form class="form" data-form="rules" data-id="${c.id}">
          <div class="form-section">Provident fund</div>
          <div class="form-grid">
            ${field('r-pf', 'Employee share (% of basic)', numIn('r-pf', 'pfRate', R.pfRate, 0.01))}
            ${field('r-pfer', 'Company share (% of basic)', numIn('r-pfer', 'pfErRate', R.pfErRate, 0.01))}
            ${field('r-pfcap', 'Wage ceiling (₹ per month)', numIn('r-pfcap', 'pfCeiling', R.pfCeiling))}
            <div class="field field-end">${check('r-pfcapon', 'pfCeilingOn', R.pfCeilingOn, 'Apply the wage ceiling')}</div>
          </div>
          <div class="form-section">ESI</div>
          <div class="form-grid">
            ${field('r-esi', 'Employee share (% of gross)', numIn('r-esi', 'esiRate', R.esiRate, 0.01))}
            ${field('r-esier', 'Company share (% of gross)', numIn('r-esier', 'esiErRate', R.esiErRate, 0.01))}
            ${field('r-esilim', 'Applies up to (₹ per month)', numIn('r-esilim', 'esiLimit', R.esiLimit), 'Set to 0 to switch ESI off.')}
          </div>
          <div class="form-section">Professional tax</div>
          <div class="field">
            <div class="edit-head cols-2"><span>Monthly wages from (₹)</span><span>Tax per month (₹)</span><span></span></div>
            <div class="edit-list" data-list="slabs">${[...R.ptSlabs].sort((a, b) => a.from - b.from).map((s) => ROW_TEMPLATES.slab(s)).join('')}</div>
            <div><button class="btn btn-sm" type="button" data-action="add-row" data-kind="slab" data-list="slabs">Add slab</button></div>
            <span class="small muted">The highest slab the month’s wages reach is used.</span></div>
          <div class="form-section">Overtime</div>
          <div class="form-grid">
            ${field('r-otx', 'Pay rate (× hourly rate)', numIn('r-otx', 'otMultiplier', R.otMultiplier, 0.05))}
            ${field('r-otmin', 'Ignore overtime under (minutes)', numIn('r-otmin', 'otMinMinutes', R.otMinMinutes))}
            ${field('r-otbasis', 'Hourly rate for monthly staff from', `<select class="input" id="r-otbasis" name="otBasis"><option value="basic" ${R.otBasis === 'basic' ? 'selected' : ''}>Basic salary</option><option value="gross" ${R.otBasis === 'gross' ? 'selected' : ''}>Gross salary</option></select>`)}
            ${field('r-otdays', 'Working days per month', numIn('r-otdays', 'otDays', R.otDays, 1, 'max="31"'), 'Hourly rate = salary ÷ days ÷ shift hours.')}
          </div>
          <div class="form-section">Loss of pay</div>
          <div class="field">${check('r-lop', 'absentLop', R.absentLop, 'Deduct unexplained absences from monthly salary')}
            ${check('r-hol', 'holidayPaidDaily', R.holidayPaidDaily, 'Pay daily-wage workers for company holidays')}</div>
          <div><button class="btn btn-primary" type="submit">Save payroll rules</button></div>
        </form>
      </section>

        <section class="panel">
          <div class="panel-head"><h2>Holidays</h2><span class="small muted">${plural(hols.length, 'day')}</span></div>
          <div class="list">${hols.map((h) => `
            <div class="row"><div class="grow"><b>${esc(h.name)}</b><div class="small muted">${esc(fmtDay(h.date))}</div></div>
            <button class="btn btn-sm btn-ghost" data-action="remove-holiday" data-date="${h.date}" aria-label="Remove ${esc(h.name)}">Remove</button></div>`).join('')}</div>
          <form class="toolbar" data-form="holiday" data-id="${c.id}" style="margin-top:12px">
            <input class="input" id="hol-date" name="date" type="date" required aria-label="Holiday date">
            <input class="input search" id="hol-name" name="name" placeholder="Holiday name" required aria-label="Holiday name">
            <button class="btn" type="submit">Add</button>
          </form>
          ${db.companies.length > 1 ? `<div style="margin-top:12px"><button class="btn btn-sm" data-action="copy-holidays">Copy this list to other companies</button></div>` : ''}
        </section>
    </div>
    <section class="panel">
      <div class="panel-head"><h2>Demo data</h2></div>
      <p class="small muted" style="margin-bottom:12px">Everything in this demo is saved in this browser only. Resetting brings back the sample companies and employees and deletes any changes you made.</p>
      <button class="btn btn-bad" data-action="reset">Reset demo data</button>
    </section>`;
  }

  /* ================= Modals ================= */

  const modalRoot = () => document.getElementById('modal-root');
  function openModal(title, body, foot = '') {
    modalRoot().innerHTML = `
      <div class="modal-backdrop" data-action="modal-bg">
        <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
          <div class="modal-head"><h2>${esc(title)}</h2><button class="x" data-action="close-modal" aria-label="Close">×</button></div>
          ${body}${foot ? `<div class="modal-foot">${foot}</div>` : ''}
        </div>
      </div>`;
    const first = modalRoot().querySelector('input, select, textarea');
    if (first) first.focus();
  }
  function closeModal() { modalRoot().innerHTML = ''; state.confirm = null; }

  function confirmBox(title, message, label, fn, danger) {
    state.confirm = fn;
    openModal(title, `<p>${message}</p>`,
      `<button class="btn" data-action="close-modal">Cancel</button><button class="btn ${danger ? 'btn-bad' : 'btn-primary'}" data-action="confirm-yes">${esc(label)}</button>`);
  }

  const shiftOptions = (c, selected) => c.shifts.map((s) => `<option value="${s.id}" ${s.id === selected ? 'selected' : ''}>${esc(shiftText(s))}</option>`).join('');
  const offOptions = (c, selected) => `<option value="">Company default (${esc(daysText(c.weeklyOff))})</option>`
    + DAYS_LONG.map((d, i) => `<option value="${i}" ${selected && selected.length === 1 && selected[0] === i ? 'selected' : ''}>${d}</option>`).join('');

  function employeeForm(e) {
    const isNew = !e;
    const defCo = state.scope !== 'all' ? state.scope : db.companies[0].id;
    e = e || { name: '', email: '', phone: '', dept: '', title: '', companyId: defCo, managerId: '', role: 'employee', payType: 'monthly', shiftId: '', weeklyOff: null, joinDate: todayISO(), dob: '', salary: { basic: 15000, hra: 6000, allowances: 3000, tds: 0, dailyRate: 600 } };
    const c = coOf(e);
    const depts = [...new Set(db.employees.map((x) => x.dept))].sort();
    const managers = activeEmployees().filter((x) => x.id !== e.id && x.role !== 'employee');
    const f = (id, label, input) => `<div class="field"><label for="${id}">${label}</label>${input}</div>`;
    const daily = e.payType === 'daily';
    openModal(isNew ? 'Add employee' : `Edit ${e.name}`, `
      <form class="form" data-form="employee" data-id="${e.id || ''}" id="employee-form">
        <div class="form-grid">
          ${f('emp-name', 'Full name', `<input class="input" id="emp-name" name="name" value="${esc(e.name)}" required>`)}
          ${f('emp-title', 'Job title', `<input class="input" id="emp-title" name="title" value="${esc(e.title)}" required>`)}
          ${f('emp-co', 'Company', `<select class="input" id="emp-co" name="companyId">${db.companies.map((x) => `<option value="${x.id}" ${x.id === e.companyId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`)}
          ${f('emp-dept', 'Department', `<input class="input" id="emp-dept" name="dept" list="dept-list" value="${esc(e.dept)}" required><datalist id="dept-list">${depts.map((d) => `<option value="${esc(d)}">`).join('')}</datalist>`)}
          ${f('emp-email', 'Email', `<input class="input" id="emp-email" name="email" type="email" value="${esc(e.email)}" placeholder="Optional for factory staff">`)}
          ${f('emp-phone', 'Phone', `<input class="input" id="emp-phone" name="phone" value="${esc(e.phone)}">`)}
          ${f('emp-mgr', 'Reports to', `<select class="input" id="emp-mgr" name="managerId"><option value="">No one</option>${managers.map((m) => `<option value="${m.id}" ${m.id === e.managerId ? 'selected' : ''}>${esc(m.name)} (${esc(coOf(m).short)})</option>`).join('')}</select>`)}
          ${f('emp-role', 'App access', `<select class="input" id="emp-role" name="role">${['employee', 'manager', 'hr'].map((r) => `<option value="${r}" ${r === e.role ? 'selected' : ''}>${roleText[r]}</option>`).join('')}</select>`)}
          ${f('emp-join', 'Joining date', `<input class="input" id="emp-join" name="joinDate" type="date" value="${esc(e.joinDate)}" required>`)}
          ${f('emp-dob', 'Date of birth', `<input class="input" id="emp-dob" name="dob" type="date" value="${esc(e.dob)}">`)}
          <div class="form-section">Shift</div>
          ${f('emp-shift', 'Shift', `<select class="input" id="emp-shift" name="shiftId">${shiftOptions(c, e.shiftId)}</select>`)}
          ${f('emp-off', 'Weekly off', `<select class="input" id="emp-off" name="weeklyOff">${offOptions(c, e.weeklyOff)}</select>`)}
          <div class="form-section">Pay</div>
          ${f('emp-pay', 'Pay type', `<select class="input" id="emp-pay" name="payType"><option value="monthly" ${!daily ? 'selected' : ''}>Monthly salary</option><option value="daily" ${daily ? 'selected' : ''}>Daily wage</option></select>`)}
          <div class="field" id="emp-daily" ${daily ? '' : 'hidden'}><label for="emp-rate">Daily rate (₹)</label><input class="input" id="emp-rate" name="dailyRate" type="number" min="0" step="1" value="${e.salary.dailyRate || 0}"></div>
          <div class="pay-monthly full" id="emp-monthly" ${daily ? 'hidden' : ''}>
            ${f('emp-basic', 'Basic (₹ / month)', `<input class="input" id="emp-basic" name="basic" type="number" min="0" step="100" value="${e.salary.basic}">`)}
            ${f('emp-hra', 'HRA', `<input class="input" id="emp-hra" name="hra" type="number" min="0" step="100" value="${e.salary.hra}">`)}
            ${f('emp-allow', 'Other allowances', `<input class="input" id="emp-allow" name="allowances" type="number" min="0" step="100" value="${e.salary.allowances}">`)}
            ${f('emp-tds', 'TDS per month', `<input class="input" id="emp-tds" name="tds" type="number" min="0" step="100" value="${e.salary.tds}">`)}
          </div>
        </div>
        <div class="modal-foot"><button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn btn-primary" type="submit">${isNew ? 'Add employee' : 'Save changes'}</button></div>
      </form>`);
  }

  function companyForm() {
    const src = co(state.setCompany) || db.companies[0];
    openModal('Add company', `
      <form class="form" data-form="new-company">
        <div class="field"><label for="nc-name">Registered name</label><input class="input" id="nc-name" name="name" required></div>
        <div class="field"><label for="nc-short">Short name</label><input class="input" id="nc-short" name="short" maxlength="20" required></div>
        <p class="note">Shifts, payroll rules, leave policy and holidays are copied from ${esc(src.name)}. You can change them afterwards.</p>
        <div class="modal-foot"><button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn btn-primary" type="submit">Add company</button></div>
      </form>`);
  }

  function applyLeaveForm() {
    openModal('Apply for leave', `
      <form class="form" data-form="leave" id="leave-form">
        <div class="field"><label for="lv-type">Leave type</label>
          <select class="input" id="lv-type" name="type">${leaveTypes(me()).map((t) => `<option>${esc(t)}</option>`).join('')}</select></div>
        <div class="form-grid">
          <div class="field"><label for="lv-from">From</label><input class="input" id="lv-from" name="from" type="date" value="${todayISO()}" required></div>
          <div class="field"><label for="lv-to">To</label><input class="input" id="lv-to" name="to" type="date" value="${todayISO()}" required></div>
        </div>
        <div class="field"><label for="lv-reason">Reason</label><textarea class="input" id="lv-reason" name="reason" placeholder="Optional, but it helps your manager"></textarea></div>
        <div class="note" id="lv-info"></div>
        <div class="modal-foot"><button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn btn-primary" type="submit">Send request</button></div>
      </form>`);
    updateLeaveInfo();
  }

  // Validates the leave form; returns an error string or null.
  function leaveProblem(type, from, to) {
    if (!from || !to) return 'Choose both dates.';
    if (to < from) return 'The end date is before the start date.';
    const u = me();
    const days = workingDays(u, from, to);
    if (days === 0) return 'Those dates are all weekly offs or holidays, so no leave is needed.';
    const clash = db.leaves.find((l) => l.empId === u.id && l.status !== 'Rejected' && l.from <= to && l.to >= from);
    if (clash) return `You already have ${clash.type.toLowerCase()} leave from ${fmtShort(clash.from)} to ${fmtShort(clash.to)}.`;
    if (type !== 'Unpaid') {
      const b = balances(u.id).find((x) => x.type === type);
      const avail = b ? b.left - b.pending : 0;
      if (days > avail) return `You have ${plural(avail, type.toLowerCase() + ' day')} available (after pending requests). Choose fewer days or use unpaid leave.`;
    }
    return null;
  }

  function updateLeaveInfo() {
    const form = document.getElementById('leave-form'); const info = document.getElementById('lv-info');
    if (!form || !info) return;
    const { type, from, to } = Object.fromEntries(new FormData(form));
    const problem = leaveProblem(type, from, to);
    if (problem) { info.className = 'note bad'; info.textContent = problem; return; }
    const days = workingDays(me(), from, to);
    const b = balances(me().id).find((x) => x.type === type);
    info.className = 'note';
    info.textContent = `${plural(days, 'working day')}` + (b ? `. You’ll have ${num(b.left - b.pending - days)} ${type.toLowerCase()} days left.` : '. Unpaid leave is deducted from pay.');
  }

  function attendanceForm(empId, date) {
    const e = emp(empId); const rec = attOf(empId, date);
    openModal(`Attendance for ${e.name}`, `
      <form class="form" data-form="attendance" data-id="${empId}" data-date="${date}">
        <p class="small muted">${esc(fmtDay(date))} · ${esc(shiftText(shiftOf(e)))}. Use this to correct a missed or wrong check-in.</p>
        <div class="form-grid">
          <div class="field"><label for="att-in">Check-in</label><input class="input" id="att-in" name="in" type="time" value="${rec?.in ?? ''}"></div>
          <div class="field"><label for="att-out">Check-out</label><input class="input" id="att-out" name="out" type="time" value="${rec?.out ?? ''}"></div>
        </div>
        <p class="small muted">Leave check-in empty to remove the record. A check-out earlier than check-in is read as the next morning.</p>
        <div class="modal-foot"><button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn btn-primary" type="submit">Save</button></div>
      </form>`);
  }

  /* ================= Toast ================= */

  let toastTimer;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  /* ================= Render ================= */

  function render() {
    const root = document.getElementById('app');
    if (!me()) { root.innerHTML = viewLogin(); return; }
    if (state.route === 'settings' && !isHR()) state.route = 'dashboard';
    if (!isHR()) state.scope = 'all';
    const views = { dashboard: viewDashboard, people: viewPeople, leave: viewLeave, attendance: viewAttendance, payroll: viewPayroll, settings: viewSettings };
    root.innerHTML = viewShell((views[state.route] || viewDashboard)());
  }

  function go(route, opts = {}) {
    state.route = route;
    state.profileId = opts.profileId ?? null;
    try { history.replaceState(null, '', '#' + route); } catch (e) { /* ignore */ }
    render();
    window.scrollTo(0, 0);
  }

  // Sets an attendance record's overtime status after its times change.
  function refreshOt(rec) {
    const ot = otHours(rec, emp(rec.empId));
    if (!ot) delete rec.otStatus;
    else if (!rec.otStatus || rec.otStatus === 'Rejected') rec.otStatus = 'Pending';
  }

  /* ================= Events ================= */

  const actions = {
    login(el) { state.userId = el.dataset.id; storage.set(SESSION_KEY, state.userId); state.tabs = { leave: 'mine', attendance: 'mine' }; state.scope = 'all'; go('dashboard'); },
    logout() { state.userId = null; storage.del(SESSION_KEY); render(); },
    tab(el) { state.tabs[el.dataset.view] = el.dataset.tab; render(); },
    'pay-company'(el) { state.payCompany = el.dataset.id; render(); },
    'set-company'(el) { state.setCompany = el.dataset.id; render(); },
    'open-profile'(el) { go('people', { profileId: el.dataset.id }); },
    'close-profile'() { go('people'); },
    'new-employee'() { employeeForm(null); },
    'edit-employee'(el) { employeeForm(emp(el.dataset.id)); },
    'new-company'() { companyForm(); },
    'toggle-status'(el) {
      const e = emp(el.dataset.id);
      if (e.status === 'Active') {
        if (e.id === me().id) { toast('You can’t mark yourself as left.'); return; }
        confirmBox('Mark as left?', `${esc(e.name)} will be removed from attendance, leave approvals and future payroll. Their past records are kept.`, 'Mark as left', () => {
          e.status = 'Inactive';
          db.employees.forEach((x) => { if (x.managerId === e.id) x.managerId = e.managerId; });
          save(); toast(`${e.name} marked as left`);
        }, true);
      } else { e.status = 'Active'; save(); render(); toast(`${e.name} reactivated`); }
    },
    'apply-leave'() { applyLeaveForm(); },
    'cancel-leave'(el) {
      confirmBox('Cancel this request?', 'Your manager will no longer see it.', 'Cancel request', () => {
        db.leaves = db.leaves.filter((l) => l.id !== el.dataset.id); save(); toast('Request cancelled');
      }, true);
    },
    decide(el) {
      const l = db.leaves.find((x) => x.id === el.dataset.id);
      if (!l || !canApprove(l)) return;
      l.status = el.dataset.status; l.decidedBy = me().id; save(); render();
      toast(`${l.status} ${emp(l.empId).name.split(' ')[0]}’s ${l.type.toLowerCase()} leave`);
    },
    'decide-ot'(el) {
      const rec = attOf(el.dataset.id, el.dataset.date);
      if (!rec || !canManage(emp(rec.empId))) return;
      rec.otStatus = el.dataset.status; rec.otBy = me().id; save(); render();
      toast(`${rec.otStatus} ${num(otHours(rec, emp(rec.empId)))} h overtime for ${emp(rec.empId).name.split(' ')[0]}`);
    },
    'approve-all-ot'() {
      const list = otApprovals();
      confirmBox('Approve all overtime?', `This approves ${plural(list.length, 'overtime entry')}, ${num(list.reduce((a, r) => a + otHours(r, emp(r.empId)), 0))} hours in total.`, 'Approve all', () => {
        list.forEach((r) => { r.otStatus = 'Approved'; r.otBy = me().id; }); save(); toast('Overtime approved');
      });
    },
    'leave-filter'(el) { state.leaveFilter = el.dataset.status; render(); },
    checkin() {
      const s = todayISO();
      if (!attOf(me().id, s)) db.attendance.push({ empId: me().id, date: s, in: nowHM(), out: null });
      save(); render(); toast(`Checked in at ${nowHM()}`);
    },
    checkout() {
      const rec = openRecord(me());
      if (!rec) return;
      rec.out = nowHM(); refreshOt(rec); save(); render();
      const ot = otHours(rec, me());
      toast(`Checked out at ${rec.out}${ot ? ` · ${num(ot)} h overtime sent for approval` : ''}`);
    },
    'edit-att'(el) { attendanceForm(el.dataset.id, el.dataset.date); },
    'run-payroll'() {
      const c = co(state.payCompany); const ym = state.payMonth;
      const slips = payrollFor(c.id, ym);
      confirmBox(`Run payroll for ${monthLabel(ym)}?`, `This issues payslips to ${plural(slips.length, 'employee')} of ${esc(c.name)} for a total net pay of <b>${money(slips.reduce((a, x) => a + x.net, 0))}</b>. Employees can see their payslips right away.`, 'Run payroll', () => {
        db.payruns.push({ companyId: c.id, month: ym, processedOn: todayISO(), slips }); save(); toast(`Payroll for ${monthLabel(ym)} processed`);
      });
    },
    'rerun-payroll'() {
      const c = co(state.payCompany); const ym = state.payMonth;
      confirmBox(`Recalculate ${monthLabel(ym)}?`, 'Payslips for this month are replaced using current salaries, attendance, approved overtime and the current payroll rules.', 'Recalculate', () => {
        const run = payrunFor(c.id, ym); run.slips = payrollFor(c.id, ym); run.processedOn = todayISO(); save(); toast('Payroll recalculated');
      });
    },
    'view-slip'(el) {
      openModal('Payslip', slipHTML(el.dataset.month, el.dataset.id), '<button class="btn" data-action="close-modal">Close</button>');
    },
    'add-row'(el) {
      const list = el.closest('form').querySelector(`[data-list="${el.dataset.list}"]`);
      list.insertAdjacentHTML('beforeend', ROW_TEMPLATES[el.dataset.kind]());
      list.lastElementChild.querySelector('input').focus();
    },
    'remove-row'(el) { el.closest('[data-row]').remove(); },
    'remove-holiday'(el) {
      const c = co(state.setCompany);
      c.holidays = c.holidays.filter((h) => h.date !== el.dataset.date); save(); render(); toast('Holiday removed');
    },
    'copy-holidays'() {
      const c = co(state.setCompany);
      confirmBox('Copy holidays?', `The holiday list of every other company is replaced with ${esc(c.short)}’s ${plural(c.holidays.length, 'holiday')}.`, 'Copy holidays', () => {
        db.companies.forEach((x) => { if (x.id !== c.id) x.holidays = c.holidays.map((h) => ({ ...h })); }); save(); toast('Holidays copied');
      });
    },
    reset() {
      confirmBox('Reset demo data?', 'All changes in this browser are deleted and the sample companies are restored.', 'Reset', () => {
        db = seed(); save(); state.scope = 'all'; state.payCompany = state.setCompany = db.companies[0].id;
        if (!emp(state.userId)) { state.userId = null; storage.del(SESSION_KEY); }
        toast('Demo data restored');
      }, true);
    },
    'confirm-yes'() { const fn = state.confirm; closeModal(); if (fn) fn(); render(); },
    'close-modal'() { closeModal(); },
    'modal-bg'(el, ev) { if (ev.target === el) closeModal(); },
  };

  document.addEventListener('click', (ev) => {
    const routeEl = ev.target.closest('[data-route]');
    if (routeEl && !ev.target.closest('[data-action]')) {
      ev.preventDefault();
      if (routeEl.dataset.tab) state.tabs[routeEl.dataset.route] = routeEl.dataset.tab;
      if (routeEl.dataset.company) state.setCompany = routeEl.dataset.company;
      go(routeEl.dataset.route);
      return;
    }
    const el = ev.target.closest('[data-action]');
    if (!el || !actions[el.dataset.action]) return;
    if (el.tagName === 'A') ev.preventDefault();
    actions[el.dataset.action](el, ev);
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && modalRoot().innerHTML) closeModal();
    if (ev.key === 'Enter' && ev.target.matches('tr[data-action]')) actions[ev.target.dataset.action](ev.target, ev);
  });

  document.addEventListener('input', (ev) => {
    if (ev.target.id === 'people-search') {
      state.peopleQuery = ev.target.value;
      const pos = ev.target.selectionStart;
      render();
      const input = document.getElementById('people-search');
      input.focus(); input.setSelectionRange(pos, pos);
    }
    if (ev.target.closest('#leave-form')) updateLeaveInfo();
  });

  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.id === 'scope') {
      state.scope = t.value;
      if (t.value !== 'all') { state.payCompany = t.value; state.setCompany = t.value; }
      state.profileId = null; state.peopleDept = '';
      render();
    }
    if (t.id === 'people-dept') { state.peopleDept = t.value; render(); }
    if (t.id === 'att-month' && t.value) { state.attMonth = t.value; render(); }
    if (t.id === 'pay-month' && t.value) { state.payMonth = t.value; render(); }
    if (t.id === 'emp-pay') {
      document.getElementById('emp-daily').hidden = t.value !== 'daily';
      document.getElementById('emp-monthly').hidden = t.value === 'daily';
    }
    if (t.id === 'emp-co') {
      const c = co(t.value);
      document.getElementById('emp-shift').innerHTML = shiftOptions(c, '');
      document.getElementById('emp-off').innerHTML = offOptions(c, null);
    }
  });

  document.addEventListener('submit', (ev) => {
    const form = ev.target.closest('form[data-form]');
    if (!form) return;
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const kind = form.dataset.form;
    const c = co(form.dataset.id);

    if (kind === 'employee') {
      const id = form.dataset.id;
      const email = (data.email || '').trim().toLowerCase();
      if (email && db.employees.some((x) => (x.email || '').toLowerCase() === email && x.id !== id)) { toast('Another employee already uses that email.'); return; }
      const daily = data.payType === 'daily';
      if (daily && !(+data.dailyRate > 0)) { toast('Enter a daily rate above zero.'); return; }
      if (!daily && !(+data.basic > 0)) { toast('Enter a basic salary above zero.'); return; }
      const fields = {
        name: data.name.trim(), title: data.title.trim(), email, phone: data.phone.trim(), dept: data.dept.trim(),
        companyId: data.companyId, managerId: data.managerId || null, joinDate: data.joinDate, dob: data.dob, role: data.role,
        shiftId: data.shiftId, weeklyOff: data.weeklyOff === '' ? null : [Number(data.weeklyOff)], payType: data.payType,
        salary: daily ? { basic: 0, hra: 0, allowances: 0, tds: 0, dailyRate: +data.dailyRate }
          : { basic: +data.basic, hra: +data.hra || 0, allowances: +data.allowances || 0, tds: +data.tds || 0, dailyRate: 0 },
      };
      if (id) {
        if (id === me().id && fields.role !== 'hr') { toast('You can’t remove your own HR access.'); return; }
        Object.assign(emp(id), fields); save(); closeModal(); render(); toast('Changes saved');
      } else {
        const next = Math.max(0, ...db.employees.map((x) => parseInt(x.id.slice(1), 10) || 0)) + 1;
        const e = { id: 'E' + String(next).padStart(3, '0'), status: 'Active', ...fields };
        db.employees.push(e); save(); closeModal(); go('people', { profileId: e.id }); toast(`${e.name} added`);
      }
    }

    if (kind === 'leave') {
      const problem = leaveProblem(data.type, data.from, data.to);
      if (problem) { updateLeaveInfo(); return; }
      db.leaves.push({ id: uid('L'), empId: me().id, type: data.type, from: data.from, to: data.to, reason: data.reason.trim(), status: 'Pending', appliedOn: todayISO(), decidedBy: null });
      save(); closeModal(); render();
      const mgr = emp(me().managerId);
      toast(`Request sent${mgr ? ' to ' + mgr.name.split(' ')[0] : ' to HR'}`);
    }

    if (kind === 'attendance') {
      const { id, date } = form.dataset;
      const old = attOf(id, date);
      db.attendance = db.attendance.filter((a) => !(a.empId === id && a.date === date));
      if (data.in) {
        const rec = { empId: id, date, in: data.in, out: data.out || null, otStatus: old?.otStatus };
        refreshOt(rec);
        if (!rec.otStatus) delete rec.otStatus;
        db.attendance.push(rec);
      }
      save(); closeModal(); render(); toast('Attendance updated');
    }

    if (kind === 'company') {
      Object.assign(c, { name: data.name.trim(), short: data.short.trim(), address: data.address.trim(), pfCode: data.pfCode.trim(), esiCode: data.esiCode.trim() });
      save(); render(); toast('Company details saved');
    }

    if (kind === 'worktime') {
      const shifts = readRows(form, 'shifts');
      if (!shifts.length) { toast('Keep at least one shift.'); return; }
      if (shifts.some((s) => !s.name || !s.start || !s.end || !(s.otAfter > 0))) { toast('Fill in every shift’s name, times and overtime hours.'); return; }
      c.shifts = shifts.map((s) => ({ id: s.id || uid('S'), name: s.name, start: s.start, end: s.end, otAfter: s.otAfter }));
      c.weeklyOff = new FormData(form).getAll('wo').map(Number);
      c.graceMin = Math.max(0, +data.graceMin || 0);
      // Anyone on a removed shift moves to the first one.
      let moved = 0;
      db.employees.forEach((e) => { if (e.companyId === c.id && !c.shifts.some((s) => s.id === e.shiftId)) { e.shiftId = c.shifts[0].id; moved++; } });
      save(); render(); toast(moved ? `Working time saved. ${plural(moved, 'person')} moved to ${c.shifts[0].name}.` : 'Working time saved');
    }

    if (kind === 'rules') {
      const slabs = readRows(form, 'slabs').filter((s) => !isNaN(s.from) && !isNaN(s.amount));
      const n = (k) => Math.max(0, parseFloat(data[k]) || 0);
      c.rules = {
        ...c.rules,
        pfRate: n('pfRate'), pfErRate: n('pfErRate'), pfCeiling: n('pfCeiling'), pfCeilingOn: !!data.pfCeilingOn,
        esiRate: n('esiRate'), esiErRate: n('esiErRate'), esiLimit: n('esiLimit'),
        ptSlabs: slabs.map((s) => ({ from: Math.max(0, s.from), amount: Math.max(0, s.amount) })),
        otMultiplier: n('otMultiplier'), otMinMinutes: n('otMinMinutes'), otBasis: data.otBasis, otDays: Math.max(1, n('otDays')),
        absentLop: !!data.absentLop, holidayPaidDaily: !!data.holidayPaidDaily,
      };
      save(); render(); toast('Payroll rules saved. They apply to the next payroll run.');
    }

    if (kind === 'leave-policy') {
      const rows = readRows(form, 'leave').filter((r) => r.name);
      const names = rows.map((r) => r.name.toLowerCase());
      if (names.includes('unpaid')) { toast('Unpaid leave is built in, so leave it out of this list.'); return; }
      if (new Set(names).size !== names.length) { toast('Two leave types have the same name.'); return; }
      c.leavePolicy = Object.fromEntries(rows.map((r) => [r.name, Math.max(0, r.days || 0)]));
      save(); render(); toast('Leave policy saved');
    }

    if (kind === 'holiday') {
      if (c.holidays.some((h) => h.date === data.date)) { toast('There’s already a holiday on that date.'); return; }
      c.holidays.push({ date: data.date, name: data.name.trim() }); save(); render(); toast('Holiday added');
    }

    if (kind === 'new-company') {
      const src = co(state.setCompany) || db.companies[0];
      const next = Math.max(0, ...db.companies.map((x) => parseInt(x.id.slice(1), 10) || 0)) + 1;
      const nc = JSON.parse(JSON.stringify({ ...src, id: 'C' + next, name: data.name.trim(), short: data.short.trim(), address: '', pfCode: '', esiCode: '' }));
      db.companies.push(nc); state.setCompany = nc.id; save(); closeModal(); render(); toast(`${nc.short} added. Review its settings below.`);
    }
  });

  // Keep the dashboard clock ticking without re-rendering the page.
  setInterval(() => { const el = document.getElementById('clock-time'); if (el) el.textContent = nowHM(); }, 15000);

  render();
})();
