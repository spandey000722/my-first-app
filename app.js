/*
 * PeopleDesk — a small HR app that runs entirely in the browser.
 * Data is kept in localStorage (demo mode). Every read/write of the data
 * goes through `db` + `save()`, so swapping in a real backend later only
 * touches the storage section at the top of this file.
 */
(function () {
  'use strict';

  /* ================= Storage ================= */

  const STORE_KEY = 'peopledesk.v1';
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
  const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
  const daysInMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
  const prevMonth = (ym) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 2, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
  const fmtDate = (s) => parse(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const fmtShort = (s) => parse(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const fmtDay = (s) => parse(s).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  const monthLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }); };
  const initials = (name) => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const minutes = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
  const hoursBetween = (a, b) => (a && b ? Math.max(0, (minutes(b) - minutes(a)) / 60) : 0);

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

  /* ================= Demo data ================= */

  function seed() {
    const today = new Date();
    const y = today.getFullYear();
    const settings = {
      company: 'Acme Industries Pvt. Ltd.',
      workStart: '09:45',
      leavePolicy: { Annual: 18, Sick: 10, Casual: 6 },
      holidays: [
        { date: `${y}-01-26`, name: 'Republic Day' },
        { date: `${y}-03-04`, name: 'Holi' },
        { date: `${y}-04-03`, name: 'Good Friday' },
        { date: `${y}-08-15`, name: 'Independence Day' },
        { date: `${y}-10-02`, name: 'Gandhi Jayanti' },
        { date: `${y}-11-09`, name: 'Diwali' },
        { date: `${y}-12-25`, name: 'Christmas' },
      ],
    };

    const E = (id, name, title, dept, role, managerId, joinDate, dob, basic, hra, allowances, tds, phone) => ({
      id, name, title, dept, role, managerId, joinDate, dob, status: 'Active', phone,
      email: name.toLowerCase().split(' ')[0] + '.' + name.toLowerCase().split(' ').slice(-1)[0] + '@acme.example',
      salary: { basic, hra, allowances, tds },
    });
    const employees = [
      E('E001', 'Ananya Rao', 'HR Manager', 'Human Resources', 'hr', null, '2019-04-01', '1988-07-14', 60000, 24000, 16000, 7500, '98450 11201'),
      E('E002', 'Rohan Kapoor', 'Engineering Manager', 'Engineering', 'manager', null, '2018-08-16', '1985-02-03', 90000, 36000, 24000, 15800, '98450 11202'),
      E('E003', 'Priya Nair', 'Senior Developer', 'Engineering', 'employee', 'E002', '2020-01-06', '1992-11-21', 65000, 26000, 14000, 8200, '98450 11203'),
      E('E004', 'Arjun Singh', 'Developer', 'Engineering', 'employee', 'E002', '2022-06-13', '1996-05-09', 40000, 16000, 9000, 2600, '98450 11204'),
      E('E005', 'Sneha Iyer', 'QA Engineer', 'Engineering', 'employee', 'E002', '2021-09-01', '1994-10-30', 36000, 14400, 8000, 1800, '98450 11205'),
      E('E006', 'Kabir Malhotra', 'Sales Manager', 'Sales', 'manager', null, '2019-11-11', '1987-03-27', 70000, 28000, 20000, 10400, '98450 11206'),
      E('E007', 'Meera Joshi', 'Account Executive', 'Sales', 'employee', 'E006', '2021-02-15', '1995-12-05', 38000, 15200, 9000, 2100, '98450 11207'),
      E('E008', 'Aditya Verma', 'Sales Associate', 'Sales', 'employee', 'E006', '2023-07-03', '1998-08-18', 26000, 10400, 6000, 0, '98450 11208'),
      E('E009', 'Fatima Sheikh', 'Finance Lead', 'Finance', 'employee', 'E001', '2020-05-18', '1990-01-25', 58000, 23200, 12000, 6900, '98450 11209'),
      E('E010', 'Rahul Gupta', 'Operations Executive', 'Operations', 'employee', 'E001', '2022-11-21', '1993-06-11', 30000, 12000, 7000, 600, '98450 11210'),
      E('E011', 'Divya Menon', 'HR Executive', 'Human Resources', 'hr', 'E001', '2023-03-01', '1997-10-24', 32000, 12800, 7000, 900, '98450 11211'),
      E('E012', 'Ishaan Chawla', 'Developer (Intern)', 'Engineering', 'employee', 'E002', '2025-07-01', '2003-09-02', 18000, 7200, 2800, 0, '98450 11212'),
    ];

    const isHol = (s) => settings.holidays.some((h) => h.date === s);
    const working = (d) => !isWeekend(d) && !isHol(iso(d));
    // Nth working day from today (negative = past).
    const wd = (n) => {
      let d = new Date(today); const step = n < 0 ? -1 : 1; let left = Math.abs(n);
      if (n === 0) { while (!working(d)) d = addDays(d, 1); return iso(d); }
      while (left > 0) { d = addDays(d, step); if (working(d)) left--; }
      return iso(d);
    };
    const L = (empId, type, from, to, status, reason, decidedBy) => ({
      id: uid('L'), empId, type, from, to, status, reason, appliedOn: iso(addDays(parse(from), -7)), decidedBy: decidedBy || null,
    });
    const leaves = [
      L('E007', 'Casual', wd(0), wd(0), 'Approved', 'Family function', 'E006'),
      L('E004', 'Sick', wd(-12), wd(-11), 'Approved', 'Fever', 'E002'),
      L('E005', 'Unpaid', wd(-25), wd(-25), 'Approved', 'Personal work', 'E002'),
      L('E009', 'Annual', wd(-18), wd(-15), 'Approved', 'Trip to Kerala', 'E001'),
      L('E010', 'Casual', wd(-6), wd(-6), 'Rejected', 'Personal', 'E001'),
      L('E003', 'Annual', wd(5), wd(7), 'Pending', 'Sister’s wedding'),
      L('E008', 'Annual', wd(10), wd(14), 'Pending', 'Vacation with family'),
      L('E012', 'Sick', wd(1), wd(1), 'Pending', 'Dentist appointment'),
      L('E011', 'Casual', wd(3), wd(3), 'Pending', 'Bank work'),
    ];
    leaves.forEach((l) => { if (l.appliedOn > todayISO()) l.appliedOn = todayISO(); });

    // Attendance for the last ~35 days, plus this morning's check-ins.
    const r = rng(42);
    const attendance = [];
    const onLeaveSeed = (id, s) => leaves.some((l) => l.empId === id && l.status === 'Approved' && s >= l.from && s <= l.to);
    const t = (base, spread) => { const m = base + Math.floor(r() * spread); return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
    for (let i = 35; i >= 0; i--) {
      const d = addDays(today, -i); const s = iso(d);
      if (!working(d)) continue;
      employees.forEach((e) => {
        if (s < e.joinDate || onLeaveSeed(e.id, s)) return;
        const roll = r();
        if (i === 0) {
          if (roll < 0.8) attendance.push({ empId: e.id, date: s, in: t(9 * 60 + 5, 50), out: null });
          return;
        }
        if (roll < 0.04) return; // absent
        attendance.push({ empId: e.id, date: s, in: t(9 * 60, roll < 0.2 ? 75 : 45), out: t(17 * 60 + 50, 80) });
      });
    }

    const data = { settings, employees, leaves, attendance, payruns: [] };
    // Last month's payroll has already been processed.
    const lm = prevMonth(thisMonth());
    data.payruns.push({ month: lm, processedOn: iso(addDays(parse(lm + '-01'), daysInMonth(lm))), slips: payrollFor(data, lm) });
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
  const activeEmployees = () => db.employees.filter((e) => e.status === 'Active');
  const reportsOf = (id) => activeEmployees().filter((e) => e.managerId === id);
  const isHoliday = (s, data = db) => data.settings.holidays.some((h) => h.date === s);
  const holidayName = (s) => db.settings.holidays.find((h) => h.date === s)?.name;
  const attOf = (id, s) => db.attendance.find((a) => a.empId === id && a.date === s);
  const leaveTypes = () => [...Object.keys(db.settings.leavePolicy), 'Unpaid'];

  function workingDays(from, to, data = db) {
    let n = 0;
    for (let d = parse(from); d <= parse(to); d = addDays(d, 1)) {
      if (!isWeekend(d) && !isHoliday(iso(d), data)) n++;
    }
    return n;
  }
  const leaveDays = (l) => workingDays(l.from, l.to);
  const leaveOn = (id, s) => db.leaves.find((l) => l.empId === id && l.status === 'Approved' && s >= l.from && s <= l.to);

  function balances(id) {
    const year = todayISO().slice(0, 4);
    return Object.entries(db.settings.leavePolicy).map(([type, total]) => {
      const mine = db.leaves.filter((l) => l.empId === id && l.type === type && l.from.startsWith(year));
      const used = mine.filter((l) => l.status === 'Approved').reduce((s, l) => s + leaveDays(l), 0);
      const pending = mine.filter((l) => l.status === 'Pending').reduce((s, l) => s + leaveDays(l), 0);
      return { type, total, used, pending, left: total - used };
    });
  }

  // present | late | leave | absent | holiday | weekend | notyet | null (before joining)
  function dayStatus(e, s) {
    if (s < e.joinDate) return null;
    const d = parse(s);
    if (isHoliday(s)) return 'holiday';
    if (isWeekend(d)) return 'weekend';
    const rec = attOf(e.id, s);
    if (rec) return minutes(rec.in) > minutes(db.settings.workStart) ? 'late' : 'present';
    if (leaveOn(e.id, s)) return 'leave';
    return s < todayISO() ? 'absent' : 'notyet';
  }

  function monthSummary(e, ym) {
    const out = { present: 0, late: 0, leave: 0, absent: 0, workdays: 0, hours: 0 };
    const today = todayISO();
    for (let i = 1; i <= daysInMonth(ym); i++) {
      const s = `${ym}-${pad(i)}`;
      if (s > today) break;
      const st = dayStatus(e, s);
      if (!st || st === 'weekend' || st === 'holiday') continue;
      if (st === 'notyet') continue;
      out.workdays++;
      if (st in out) out[st]++;
      const rec = attOf(e.id, s);
      if (rec) out.hours += hoursBetween(rec.in, rec.out);
    }
    out.rate = out.workdays ? Math.round(((out.present + out.late) / out.workdays) * 100) : 0;
    return out;
  }

  /* ================= Payroll ================= */

  // Unpaid ("loss of pay") working days inside a month.
  function lopDays(data, empId, ym) {
    let n = 0;
    data.leaves.filter((l) => l.empId === empId && l.type === 'Unpaid' && l.status === 'Approved').forEach((l) => {
      for (let d = parse(l.from); d <= parse(l.to); d = addDays(d, 1)) {
        const s = iso(d);
        if (s.startsWith(ym) && !isWeekend(d) && !isHoliday(s, data)) n++;
      }
    });
    return n;
  }

  function payslip(data, e, ym) {
    const s = e.salary;
    const gross = s.basic + s.hra + s.allowances;
    const month = Number(ym.slice(5, 7));
    const lop = lopDays(data, e.id, ym);
    const lopAmt = Math.round((gross / daysInMonth(ym)) * lop);
    const pf = Math.round(Math.min(s.basic, 15000) * 0.12);           // EPF: 12% of basic, wage ceiling ₹15,000
    const pt = gross > 15000 ? (month === 2 ? 300 : 200) : 0;          // Professional tax (Maharashtra slab)
    const tds = s.tds || 0;
    const deductions = pf + pt + tds + lopAmt;
    return {
      empId: e.id, name: e.name, title: e.title, dept: e.dept,
      basic: s.basic, hra: s.hra, allowances: s.allowances, gross,
      lop, lopAmt, pf, pt, tds, deductions, net: gross - deductions,
    };
  }

  function payrollFor(data, ym) {
    const monthEnd = `${ym}-${pad(daysInMonth(ym))}`;
    return data.employees
      .filter((e) => e.status === 'Active' && e.joinDate <= monthEnd)
      .map((e) => payslip(data, e, ym));
  }
  const payrunFor = (ym) => db.payruns.find((p) => p.month === ym);

  db = load();

  /* ================= App state ================= */

  const ROUTES = ['dashboard', 'people', 'leave', 'attendance', 'payroll', 'settings'];
  const state = {
    userId: storage.get(SESSION_KEY),
    route: ROUTES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'dashboard',
    profileId: null,
    tabs: { leave: 'mine', attendance: 'mine' },
    peopleQuery: '',
    peopleDept: '',
    leaveFilter: 'All',
    attMonth: thisMonth(),
    payMonth: prevMonth(thisMonth()),
    confirm: null,
  };
  if (state.userId && !emp(state.userId)) state.userId = null;

  const me = () => emp(state.userId);
  const isHR = () => me()?.role === 'hr';
  const isManager = () => me()?.role === 'manager';
  const team = () => (isHR() ? activeEmployees() : isManager() ? reportsOf(me().id) : []);
  const hasTeam = () => team().length > 0;
  function canApprove(l) {
    const u = me();
    if (!u || l.empId === u.id) return false;
    return u.role === 'hr' || emp(l.empId)?.managerId === u.id;
  }
  const canSeePrivate = (e) => isHR() || e.id === me().id || e.managerId === me().id;
  const approvals = () => db.leaves.filter((l) => l.status === 'Pending' && canApprove(l));

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
  const STATUS_PILL = {
    Pending: 'warn', Approved: 'good', Rejected: 'bad', Active: 'good', Inactive: '',
    present: 'good', late: 'warn', leave: 'info', absent: 'bad', holiday: 'accent', weekend: '', notyet: '',
  };
  const STATUS_TEXT = { present: 'Present', late: 'Late', leave: 'On leave', absent: 'Absent', holiday: 'Holiday', weekend: 'Weekend', notyet: 'Not in yet' };
  const pill = (status, text) => `<span class="pill ${STATUS_PILL[status] ?? ''}">${esc(text ?? STATUS_TEXT[status] ?? status)}</span>`;
  const roleText = { hr: 'HR', manager: 'Manager', employee: 'Employee' };
  const empty = (text) => `<div class="empty">${esc(text)}</div>`;
  const pageHead = (title, sub, actions = '') => `
    <div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>
    <div class="actions">${actions}</div></div>`;

  /* ================= Views ================= */

  function viewLogin() {
    const groups = [['hr', 'HR team'], ['manager', 'Managers'], ['employee', 'Employees']];
    return `
    <div class="login"><div class="login-card">
      <div class="brand"><span class="brand-mark">P</span><div><div class="brand-name">PeopleDesk</div><div class="brand-co">${esc(db.settings.company)}</div></div></div>
      <div class="login-hero">
        <h1>Sign in to PeopleDesk</h1>
        <p>This is a demo with sample employees. Pick a person to see the app the way they would. HR sees everything, managers see their team, and employees see their own records.</p>
      </div>
      ${groups.map(([role, label]) => `
        <div class="user-pick"><div class="label">${label}</div>
          ${activeEmployees().filter((e) => e.role === role).slice(0, role === 'employee' ? 4 : 3).map((e) => `
            <button class="user-btn" data-action="login" data-id="${e.id}">${avatar(e)}
              <span class="who"><b>${esc(e.name)}</b><span>${esc(e.title)} · ${esc(e.dept)}</span></span>
              <span class="pill">${roleText[e.role]}</span>
            </button>`).join('')}
        </div>`).join('')}
    </div></div>`;
  }

  function viewShell(content) {
    const u = me();
    const pending = approvals().length;
    const links = [
      ['dashboard', 'Dashboard'],
      ['people', 'People'],
      ['leave', 'Leave', pending],
      ['attendance', 'Attendance'],
      ['payroll', isHR() ? 'Payroll' : 'Payslips'],
      ...(isHR() ? [['settings', 'Settings']] : []),
    ];
    return `
    <div class="shell">
      <aside class="nav">
        <div class="brand"><span class="brand-mark">P</span><div><div class="brand-name">PeopleDesk</div><div class="brand-co">${esc(db.settings.company)}</div></div></div>
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

  function clockCard() {
    const u = me(); const s = todayISO(); const rec = attOf(u.id, s); const lv = leaveOn(u.id, s);
    const d = parse(s);
    let body;
    if (isHoliday(s)) body = `<p class="muted">Today is a holiday: ${esc(holidayName(s))}.</p>`;
    else if (isWeekend(d)) body = `<p class="muted">It’s the weekend. Enjoy your day off.</p>`;
    else if (lv && !rec) body = `<p class="muted">You’re on ${esc(lv.type.toLowerCase())} leave today.</p>`;
    else if (!rec) body = `<button class="btn btn-primary btn-lg" data-action="checkin">Check in</button>`;
    else if (!rec.out) body = `<button class="btn btn-lg" data-action="checkout">Check out</button>`;
    else body = pill('present', `Done for today · ${hoursBetween(rec.in, rec.out).toFixed(1)} h`);
    return `
    <section class="panel">
      <div class="clock">
        <div>
          <div class="label">${esc(fmtDay(s))}</div>
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
      <div class="grow">${person(e, `${l.type} · ${fmtShort(l.from)}${l.to !== l.from ? ' – ' + fmtShort(l.to) : ''} · ${days} day${days === 1 ? '' : 's'}`)}</div>
      <div class="small muted grow">${esc(l.reason || '')}</div>
      <div class="actions">
        <button class="btn btn-sm btn-good" data-action="decide" data-id="${l.id}" data-status="Approved">Approve</button>
        <button class="btn btn-sm btn-bad" data-action="decide" data-id="${l.id}" data-status="Rejected">Reject</button>
      </div>
    </div>`;
  }

  function holidaysPanel() {
    const t = todayISO();
    const next = db.settings.holidays.filter((h) => h.date >= t).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4);
    return `
    <section class="panel">
      <div class="panel-head"><h2>Upcoming holidays</h2></div>
      <div class="list">${next.length ? next.map((h) => `
        <div class="row"><div class="grow"><b>${esc(h.name)}</b></div><span class="small muted num">${esc(fmtDay(h.date))}</span></div>`).join('') : empty('No more holidays this year.')}</div>
    </section>`;
  }

  function balancesBlock(id) {
    return `<div class="balances">${balances(id).map((b) => `
      <div class="balance">
        <div class="label">${esc(b.type)}</div>
        <div><span class="big">${b.left}</span> <span class="of">of ${b.total} left</span></div>
        ${b.pending ? `<div class="small" style="color:var(--warn)">${b.pending} pending</div>` : ''}
        <div class="meter"><i style="width:${b.total ? Math.max(0, (b.left / b.total) * 100) : 0}%"></i></div>
      </div>`).join('')}</div>`;
  }

  function viewDashboard() {
    const u = me();
    const s = todayISO();
    const first = u.name.split(' ')[0];
    if (isHR()) {
      const all = activeEmployees();
      const statuses = all.map((e) => dayStatus(e, s));
      const present = statuses.filter((x) => x === 'present' || x === 'late').length;
      const late = statuses.filter((x) => x === 'late').length;
      const out = all.filter((e) => leaveOn(e.id, s));
      const pend = db.leaves.filter((l) => l.status === 'Pending').length;
      const lastRun = [...db.payruns].sort((a, b) => b.month.localeCompare(a.month))[0];
      const depts = {};
      all.forEach((e) => { depts[e.dept] = (depts[e.dept] || 0) + 1; });
      const maxDept = Math.max(...Object.values(depts));
      const weekEnd = iso(addDays(parse(s), 7));
      const away = db.leaves.filter((l) => l.status === 'Approved' && l.to >= s && l.from <= weekEnd).sort((a, b) => a.from.localeCompare(b.from));
      return `
      ${pageHead(`Good ${greeting()}, ${first}`, esc(parse(s).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })),
        `<button class="btn" data-action="new-employee">Add employee</button><button class="btn btn-primary" data-route="payroll">Run payroll</button>`)}
      <div class="stats">
        <div class="stat"><div class="label">Headcount</div><div class="value">${all.length}</div><div class="hint">${Object.keys(depts).length} departments</div></div>
        <div class="stat"><div class="label">In today</div><div class="value">${present}<span class="muted" style="font-size:1rem"> / ${all.length - out.length}</span></div><div class="hint">${late} came in late</div></div>
        <div class="stat"><div class="label">On leave today</div><div class="value">${out.length}</div><div class="hint">${out.map((e) => esc(e.name.split(' ')[0])).join(', ') || 'Everyone’s in'}</div></div>
        <div class="stat ${pend ? 'attn' : ''}"><div class="label">Pending leave</div><div class="value">${pend}</div><div class="hint">${pend ? 'Waiting for a decision' : 'All caught up'}</div></div>
      </div>
      <div class="grid grid-main">
        <div class="grid">
          ${approvalsPanel()}
          <section class="panel">
            <div class="panel-head"><h2>Away in the next 7 days</h2></div>
            <div class="list">${away.length ? away.map((l) => `<div class="row"><div class="grow">${person(emp(l.empId), emp(l.empId).dept)}</div>${pill('leave', l.type)}<span class="small muted num">${fmtShort(l.from)}${l.to !== l.from ? ' – ' + fmtShort(l.to) : ''}</span></div>`).join('') : empty('No one has approved leave this week.')}</div>
          </section>
        </div>
        <div class="grid">
          <section class="panel">
            <div class="panel-head"><h2>Payroll</h2></div>
            ${lastRun ? `<div class="kv"><dt>Last run</dt><dd>${monthLabel(lastRun.month)}</dd><dt>Net paid</dt><dd class="num">${money(lastRun.slips.reduce((a, x) => a + x.net, 0))}</dd><dt>Employees</dt><dd>${lastRun.slips.length}</dd></div>` : empty('Payroll has not been run yet.')}
          </section>
          <section class="panel">
            <div class="panel-head"><h2>People by department</h2></div>
            <div class="bars">${Object.entries(depts).sort((a, b) => b[1] - a[1]).map(([d, n]) => `
              <div class="bar"><span>${esc(d)}</span><span class="track"><i style="width:${(n / maxDept) * 100}%"></i></span><b class="num r">${n}</b></div>`).join('')}</div>
          </section>
          ${holidaysPanel()}
        </div>
      </div>`;
    }

    const myLeaves = db.leaves.filter((l) => l.empId === u.id).sort((a, b) => b.from.localeCompare(a.from)).slice(0, 4);
    const mySlip = [...db.payruns].sort((a, b) => b.month.localeCompare(a.month)).map((p) => ({ month: p.month, slip: p.slips.find((x) => x.empId === u.id) })).find((x) => x.slip);
    const sum = monthSummary(u, thisMonth());
    return `
    ${pageHead(`Good ${greeting()}, ${first}`, `${esc(u.title)} · ${esc(u.dept)}`, `<button class="btn btn-primary" data-action="apply-leave">Apply for leave</button>`)}
    ${clockCard()}
    <div class="grid grid-main">
      <div class="grid">
        ${isManager() ? approvalsPanel() : ''}
        <section class="panel">
          <div class="panel-head"><h2>My leave balance</h2><span class="small muted">${todayISO().slice(0, 4)}</span></div>
          ${balancesBlock(u.id)}
        </section>
        <section class="panel">
          <div class="panel-head"><h2>My recent requests</h2><a href="#leave" data-route="leave" class="small">All requests</a></div>
          <div class="list">${myLeaves.length ? myLeaves.map(leaveRow).join('') : empty('You haven’t applied for leave yet.')}</div>
        </section>
      </div>
      <div class="grid">
        <section class="panel">
          <div class="panel-head"><h2>This month</h2></div>
          <div class="kv"><dt>Attendance</dt><dd class="num">${sum.rate}%</dd><dt>Days present</dt><dd class="num">${sum.present + sum.late} of ${sum.workdays}</dd><dt>Late arrivals</dt><dd class="num">${sum.late}</dd><dt>Hours logged</dt><dd class="num">${sum.hours.toFixed(1)}</dd></div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Latest payslip</h2></div>
          ${mySlip ? `<div class="kv"><dt>Month</dt><dd>${monthLabel(mySlip.month)}</dd><dt>Net pay</dt><dd class="num">${money(mySlip.slip.net)}</dd></div>
            <div style="margin-top:12px"><button class="btn btn-sm" data-action="view-slip" data-month="${mySlip.month}" data-id="${u.id}">View payslip</button></div>` : empty('No payslips yet.')}
        </section>
        ${holidaysPanel()}
      </div>
    </div>`;
  }

  function greeting() { const h = new Date().getHours(); return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'; }

  /* ----- People ----- */

  function viewPeople() {
    if (state.profileId && emp(state.profileId)) return viewProfile(emp(state.profileId));
    const q = state.peopleQuery.toLowerCase();
    const depts = [...new Set(db.employees.map((e) => e.dept))].sort();
    const list = db.employees
      .filter((e) => isHR() || e.status === 'Active')
      .filter((e) => !state.peopleDept || e.dept === state.peopleDept)
      .filter((e) => !q || [e.name, e.title, e.dept, e.email, e.id].join(' ').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
    return `
    ${pageHead('People', `${activeEmployees().length} active employees`, isHR() ? `<button class="btn btn-primary" data-action="new-employee">Add employee</button>` : '')}
    <section class="panel">
      <div class="toolbar" style="margin-bottom:12px">
        <input class="input search" id="people-search" type="search" placeholder="Search by name, role, email or ID" value="${esc(state.peopleQuery)}" aria-label="Search people">
        <select class="input" id="people-dept" aria-label="Department">
          <option value="">All departments</option>
          ${depts.map((d) => `<option ${d === state.peopleDept ? 'selected' : ''}>${esc(d)}</option>`).join('')}
        </select>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Department</th><th>Email</th><th>Phone</th><th>Status</th></tr></thead>
        <tbody>${list.map((e) => `
          <tr class="click" data-action="open-profile" data-id="${e.id}" tabindex="0">
            <td>${person(e)}</td><td>${esc(e.dept)}</td><td>${esc(e.email)}</td><td class="num">${esc(e.phone)}</td><td>${pill(e.status)}</td>
          </tr>`).join('')}</tbody>
      </table></div>
      ${list.length ? '' : empty('No one matches that search.')}
    </section>`;
  }

  function viewProfile(e) {
    const mgr = emp(e.managerId);
    const priv = canSeePrivate(e);
    const sum = monthSummary(e, thisMonth());
    const s = e.salary; const gross = s.basic + s.hra + s.allowances;
    const reports = reportsOf(e.id);
    return `
    <div><button class="btn btn-ghost btn-sm" data-action="close-profile">← Back to people</button></div>
    <section class="panel">
      <div class="profile-head">
        ${avatar(e, 'lg')}
        <div class="who"><h1>${esc(e.name)}</h1><p class="muted">${esc(e.title)} · ${esc(e.dept)}</p></div>
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
          <dt>Email</dt><dd>${esc(e.email)}</dd>
          <dt>Phone</dt><dd class="num">${esc(e.phone)}</dd>
          <dt>Reports to</dt><dd>${mgr ? `<a href="#people" data-action="open-profile" data-id="${mgr.id}">${esc(mgr.name)}</a>` : '—'}</dd>
          <dt>Joined</dt><dd>${fmtDate(e.joinDate)}</dd>
          ${priv ? `<dt>Birthday</dt><dd>${e.dob ? parse(e.dob).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' }) : '—'}</dd>` : ''}
          <dt>App access</dt><dd>${roleText[e.role]}</dd>
          ${reports.length ? `<dt>Team</dt><dd>${reports.map((r) => esc(r.name)).join(', ')}</dd>` : ''}
        </dl>
      </section>
      ${priv ? `
      <section class="panel">
        <div class="panel-head"><h2>Salary</h2><span class="small muted">per month</span></div>
        ${isHR() || e.id === me().id ? `<dl class="kv">
          <dt>Basic</dt><dd class="num">${money(s.basic)}</dd>
          <dt>HRA</dt><dd class="num">${money(s.hra)}</dd>
          <dt>Other allowances</dt><dd class="num">${money(s.allowances)}</dd>
          <dt>Gross</dt><dd class="num"><b>${money(gross)}</b></dd>
          <dt>Annual CTC (approx.)</dt><dd class="num">${money(gross * 12 + Math.min(s.basic, 15000) * 0.12 * 12)}</dd>
          <dt>TDS per month</dt><dd class="num">${money(s.tds)}</dd>
        </dl>` : empty('Only HR and the employee can see salary details.')}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Leave balance</h2></div>
        ${balancesBlock(e.id)}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Attendance · ${monthLabel(thisMonth())}</h2></div>
        ${monthStrip(e, thisMonth())}
        <p class="small muted" style="margin-top:10px">${sum.rate}% attendance · ${sum.late} late · ${sum.absent} absent · ${sum.hours.toFixed(1)} h logged</p>
      </section>` : ''}
    </div>`;
  }

  /* ----- Leave ----- */

  function leaveRow(l, showPerson) {
    const days = leaveDays(l); const e = emp(l.empId);
    const decider = l.decidedBy && emp(l.decidedBy);
    return `
    <div class="row">
      <div class="grow">${showPerson ? person(e, `${l.type} leave`) : `<b>${esc(l.type)} leave</b><div class="small muted">${esc(l.reason || 'No reason given')}</div>`}</div>
      <div class="small num">${fmtShort(l.from)}${l.to !== l.from ? ' – ' + fmtShort(l.to) : ''}<div class="muted">${days} day${days === 1 ? '' : 's'}</div></div>
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
      const list = db.leaves.filter((l) => f === 'All' || l.status === f).sort((a, b) => b.from.localeCompare(a.from));
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
    const cells = [];
    for (let i = 1; i <= daysInMonth(ym); i++) {
      const s = `${ym}-${pad(i)}`;
      const st = dayStatus(e, s) || 'notyet';
      const rec = attOf(e.id, s);
      const tip = `${fmtDay(s)}: ${STATUS_TEXT[st]}${rec ? ` (${rec.in}–${rec.out ?? '…'})` : ''}${st === 'holiday' ? ' · ' + holidayName(s) : ''}`;
      cells.push(`<div class="day ${st}" title="${esc(tip)}">${i}</div>`);
    }
    return `<div class="strip">${cells.join('')}</div>
      <div class="legend">${['present', 'late', 'leave', 'absent', 'holiday'].map((k) => `<span><i class="day ${k}" style="aspect-ratio:auto"></i>${STATUS_TEXT[k]}</span>`).join('')}</div>`;
  }

  function viewAttendance() {
    const u = me();
    const tabs = [['mine', 'My attendance']];
    if (hasTeam()) tabs.push(['today', 'Team today'], ['summary', 'Monthly summary']);
    let tab = state.tabs.attendance;
    if (!tabs.some(([k]) => k === tab)) tab = 'mine';
    const ym = state.attMonth;
    const monthPicker = `<input class="input" type="month" id="att-month" value="${ym}" max="${thisMonth()}" aria-label="Month">`;
    let body;
    if (tab === 'mine') {
      const sum = monthSummary(u, ym);
      const rows = [];
      for (let i = daysInMonth(ym); i >= 1; i--) {
        const s = `${ym}-${pad(i)}`;
        if (s > todayISO()) continue;
        const st = dayStatus(u, s);
        if (!st || st === 'weekend') continue;
        const rec = attOf(u.id, s);
        rows.push(`<tr><td>${fmtDay(s)}</td><td class="num">${rec?.in ?? '—'}</td><td class="num">${rec?.out ?? '—'}</td><td class="num r">${rec?.out ? hoursBetween(rec.in, rec.out).toFixed(1) : '—'}</td><td>${pill(st, st === 'holiday' ? holidayName(s) : undefined)}</td></tr>`);
      }
      body = `
      ${ym === thisMonth() ? clockCard() : ''}
      <section class="panel">
        <div class="panel-head"><h2>${monthLabel(ym)}</h2>${monthPicker}</div>
        ${monthStrip(u, ym)}
        <p class="small muted" style="margin-top:10px">${sum.rate}% attendance · ${sum.present + sum.late} of ${sum.workdays} working days · ${sum.late} late · ${sum.hours.toFixed(1)} h logged</p>
      </section>
      <section class="panel"><div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>In</th><th>Out</th><th class="r">Hours</th><th>Status</th></tr></thead>
        <tbody>${rows.join('')}</tbody></table></div>${rows.length ? '' : empty('No working days recorded for this month yet.')}</section>`;
    } else if (tab === 'today') {
      const s = todayISO();
      const people = team().sort((a, b) => a.name.localeCompare(b.name));
      body = `<section class="panel">
        <div class="panel-head"><h2>${esc(fmtDay(s))}</h2><span class="small muted">Office starts ${db.settings.workStart}</span></div>
        <div class="table-wrap"><table>
        <thead><tr><th>Employee</th><th>Status</th><th>In</th><th>Out</th>${isHR() ? '<th></th>' : ''}</tr></thead>
        <tbody>${people.map((e) => {
          const rec = attOf(e.id, s); const st = dayStatus(e, s);
          return `<tr><td>${person(e, e.dept)}</td><td>${st ? pill(st) : '—'}</td><td class="num">${rec?.in ?? '—'}</td><td class="num">${rec?.out ?? '—'}</td>
          ${isHR() ? `<td class="r"><button class="btn btn-sm" data-action="edit-att" data-id="${e.id}" data-date="${s}">Edit</button></td>` : ''}</tr>`;
        }).join('')}</tbody></table></div></section>`;
    } else {
      const people = team().sort((a, b) => a.name.localeCompare(b.name));
      body = `<section class="panel">
        <div class="panel-head"><h2>${monthLabel(ym)}</h2>${monthPicker}</div>
        <div class="table-wrap"><table>
        <thead><tr><th>Employee</th><th class="r">Present</th><th class="r">Late</th><th class="r">Leave</th><th class="r">Absent</th><th class="r">Hours</th><th class="r">Rate</th></tr></thead>
        <tbody>${people.map((e) => { const m = monthSummary(e, ym); return `
          <tr class="click" data-action="open-profile" data-id="${e.id}"><td>${person(e, e.dept)}</td>
          <td class="num r">${m.present + m.late}</td><td class="num r">${m.late}</td><td class="num r">${m.leave}</td>
          <td class="num r" ${m.absent ? 'style="color:var(--bad);font-weight:700"' : ''}>${m.absent}</td><td class="num r">${m.hours.toFixed(0)}</td>
          <td class="r">${pill(m.rate >= 90 ? 'present' : m.rate >= 75 ? 'late' : 'absent', m.rate + '%')}</td></tr>`; }).join('')}</tbody>
        </table></div></section>`;
    }
    return `
    ${pageHead('Attendance', 'Daily check-ins and monthly records.')}
    ${tabs.length > 1 ? `<div class="tabs" role="tablist">${tabs.map(([k, label]) => `<button class="tab" role="tab" aria-selected="${k === tab}" data-action="tab" data-view="attendance" data-tab="${k}">${label}</button>`).join('')}</div>` : ''}
    ${body}`;
  }

  /* ----- Payroll ----- */

  function viewPayroll() {
    const u = me();
    if (!isHR()) {
      const mine = [...db.payruns].sort((a, b) => b.month.localeCompare(a.month))
        .map((p) => ({ month: p.month, slip: p.slips.find((x) => x.empId === u.id) })).filter((x) => x.slip);
      return `
      ${pageHead('Payslips', 'Your monthly salary statements.')}
      <section class="panel"><div class="list">${mine.length ? mine.map((x) => `
        <div class="row"><div class="grow"><b>${monthLabel(x.month)}</b><div class="small muted">Gross ${money(x.slip.gross)} · Deductions ${money(x.slip.deductions)}</div></div>
        <b class="num">${money(x.slip.net)}</b><button class="btn btn-sm" data-action="view-slip" data-month="${x.month}" data-id="${u.id}">View</button></div>`).join('')
        : empty('No payslips yet. They appear here once HR runs payroll.')}</div></section>`;
    }
    const ym = state.payMonth;
    const run = payrunFor(ym);
    const slips = run ? run.slips : payrollFor(db, ym);
    const tot = (k) => slips.reduce((a, x) => a + x[k], 0);
    const future = ym > thisMonth();
    return `
    ${pageHead('Payroll', 'Calculate salaries and issue payslips each month.',
      `<input class="input" type="month" id="pay-month" value="${ym}" aria-label="Payroll month">
       ${run ? `<button class="btn" data-action="rerun-payroll">Recalculate</button>` : `<button class="btn btn-primary" data-action="run-payroll" ${future || !slips.length ? 'disabled' : ''}>Run payroll for ${monthLabel(ym)}</button>`}`)}
    <div class="stats">
      <div class="stat"><div class="label">Status</div><div class="value" style="font-size:1.1rem;margin-top:12px">${run ? pill('Approved', 'Processed') : pill('Pending', 'Not run yet')}</div><div class="hint">${run ? 'on ' + fmtDate(run.processedOn) : 'Showing a preview'}</div></div>
      <div class="stat"><div class="label">Gross pay</div><div class="value">${money(tot('gross'))}</div><div class="hint">${slips.length} employees</div></div>
      <div class="stat"><div class="label">Deductions</div><div class="value">${money(tot('deductions'))}</div><div class="hint">PF ${money(tot('pf'))} · TDS ${money(tot('tds'))}</div></div>
      <div class="stat"><div class="label">Net pay</div><div class="value">${money(tot('net'))}</div><div class="hint">To be credited</div></div>
    </div>
    <section class="panel">
      <div class="panel-head"><h2>${monthLabel(ym)}</h2>${run ? '' : '<span class="small muted">Preview: payslips are issued when you run payroll</span>'}</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Employee</th><th class="r">Gross</th><th class="r">PF</th><th class="r">Prof. tax</th><th class="r">TDS</th><th class="r">Loss of pay</th><th class="r">Net pay</th>${run ? '<th></th>' : ''}</tr></thead>
        <tbody>${slips.map((x) => `<tr>
          <td>${person(emp(x.empId) || { name: x.name }, x.title)}</td>
          <td class="num r">${money(x.gross)}</td><td class="num r">${money(x.pf)}</td><td class="num r">${money(x.pt)}</td><td class="num r">${money(x.tds)}</td>
          <td class="num r">${x.lop ? `${money(x.lopAmt)} <span class="muted">(${x.lop}d)</span>` : '—'}</td>
          <td class="num r"><b>${money(x.net)}</b></td>
          ${run ? `<td class="r"><button class="btn btn-sm" data-action="view-slip" data-month="${ym}" data-id="${x.empId}">Payslip</button></td>` : ''}
        </tr>`).join('')}</tbody>
        <tfoot><tr><td>Total</td><td class="num r">${money(tot('gross'))}</td><td class="num r">${money(tot('pf'))}</td><td class="num r">${money(tot('pt'))}</td><td class="num r">${money(tot('tds'))}</td><td class="num r">${money(tot('lopAmt'))}</td><td class="num r">${money(tot('net'))}</td>${run ? '<td></td>' : ''}</tr></tfoot>
      </table></div>
      ${slips.length ? '' : empty('No active employees had joined by this month.')}
      <p class="small muted" style="margin-top:12px">PF is 12% of basic up to the ₹15,000 wage ceiling. Professional tax uses the Maharashtra slab (₹200, ₹300 in February). Loss of pay comes from approved unpaid leave. Edit salaries on each employee’s profile.</p>
    </section>`;
  }

  function slipHTML(ym, empId) {
    const run = payrunFor(ym); const x = run?.slips.find((s) => s.empId === empId);
    if (!x) return empty('Payslip not found.');
    const e = emp(empId);
    const line = (k, v) => `<div class="slip-line"><span>${k}</span><span class="num">${money(v)}</span></div>`;
    return `<div class="slip">
      <div class="slip-head">
        <div><div class="label">Payslip · ${monthLabel(ym)}</div><h2 style="margin-top:4px">${esc(db.settings.company)}</h2></div>
        <div class="small" style="text-align:right"><b>${esc(x.name)}</b><div class="muted">${esc(x.title)} · <span class="mono">${esc(x.empId)}</span></div>${e ? `<div class="muted">Joined ${fmtDate(e.joinDate)}</div>` : ''}</div>
      </div>
      <div class="slip-cols">
        <div><div class="label" style="margin-bottom:6px">Earnings</div>
          ${line('Basic', x.basic)}${line('House rent allowance', x.hra)}${line('Other allowances', x.allowances)}
          <div class="slip-line total"><span>Gross earnings</span><span class="num">${money(x.gross)}</span></div></div>
        <div><div class="label" style="margin-bottom:6px">Deductions</div>
          ${line('Provident fund (12%)', x.pf)}${line('Professional tax', x.pt)}${line('Income tax (TDS)', x.tds)}${x.lop ? line(`Loss of pay (${x.lop} day${x.lop === 1 ? '' : 's'})`, x.lopAmt) : ''}
          <div class="slip-line total"><span>Total deductions</span><span class="num">${money(x.deductions)}</span></div></div>
      </div>
      <div class="slip-net"><div><div class="label">Net pay</div><div class="small">Rupees ${inWords(x.net)} only</div></div><div class="amt">${money(x.net)}</div></div>
    </div>`;
  }

  /* ----- Settings ----- */

  function viewSettings() {
    const st = db.settings;
    const hols = [...st.holidays].sort((a, b) => a.date.localeCompare(b.date));
    return `
    ${pageHead('Settings', 'Company details, leave policy and holidays.')}
    <div class="grid grid-2">
      <section class="panel">
        <div class="panel-head"><h2>Company</h2></div>
        <form class="form" data-form="settings">
          <div class="field"><label for="set-company">Company name</label><input class="input" id="set-company" name="company" value="${esc(st.company)}" required></div>
          <div class="field"><label for="set-start">Office start time</label><input class="input" id="set-start" name="workStart" type="time" value="${esc(st.workStart)}" required>
            <span class="small muted">Check-ins after this time are marked late.</span></div>
          <div class="form-section">Leave per year</div>
          <div class="form-grid">${Object.entries(st.leavePolicy).map(([k, v]) => `
            <div class="field"><label for="set-lv-${k}">${esc(k)} leave (days)</label><input class="input" id="set-lv-${k}" name="lv-${esc(k)}" type="number" min="0" max="365" value="${v}" required></div>`).join('')}</div>
          <div><button class="btn btn-primary" type="submit">Save settings</button></div>
        </form>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Holidays</h2><span class="small muted">${hols.length} days</span></div>
        <div class="list">${hols.map((h) => `
          <div class="row"><div class="grow"><b>${esc(h.name)}</b><div class="small muted">${esc(fmtDay(h.date))}</div></div>
          <button class="btn btn-sm btn-ghost" data-action="remove-holiday" data-date="${h.date}" aria-label="Remove ${esc(h.name)}">Remove</button></div>`).join('')}</div>
        <form class="toolbar" data-form="holiday" style="margin-top:12px">
          <input class="input" id="hol-date" name="date" type="date" required aria-label="Holiday date">
          <input class="input search" id="hol-name" name="name" placeholder="Holiday name" required aria-label="Holiday name">
          <button class="btn" type="submit">Add</button>
        </form>
      </section>
    </div>
    <section class="panel">
      <div class="panel-head"><h2>Demo data</h2></div>
      <p class="small muted" style="margin-bottom:12px">Everything in this demo is saved in this browser only. Resetting brings back the sample employees and deletes any changes you made.</p>
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

  function employeeForm(e) {
    const isNew = !e;
    e = e || { name: '', email: '', phone: '', dept: '', title: '', managerId: '', role: 'employee', joinDate: todayISO(), dob: '', salary: { basic: 25000, hra: 10000, allowances: 5000, tds: 0 } };
    const depts = [...new Set(db.employees.map((x) => x.dept))].sort();
    const managers = activeEmployees().filter((x) => x.id !== e.id && x.role !== 'employee');
    const f = (id, label, input, full) => `<div class="field ${full ? 'full' : ''}"><label for="${id}">${label}</label>${input}</div>`;
    openModal(isNew ? 'Add employee' : `Edit ${e.name}`, `
      <form class="form" data-form="employee" data-id="${e.id || ''}" id="employee-form">
        <div class="form-grid">
          ${f('emp-name', 'Full name', `<input class="input" id="emp-name" name="name" value="${esc(e.name)}" required>`)}
          ${f('emp-title', 'Job title', `<input class="input" id="emp-title" name="title" value="${esc(e.title)}" required>`)}
          ${f('emp-email', 'Work email', `<input class="input" id="emp-email" name="email" type="email" value="${esc(e.email)}" required>`)}
          ${f('emp-phone', 'Phone', `<input class="input" id="emp-phone" name="phone" value="${esc(e.phone)}">`)}
          ${f('emp-dept', 'Department', `<input class="input" id="emp-dept" name="dept" list="dept-list" value="${esc(e.dept)}" required><datalist id="dept-list">${depts.map((d) => `<option value="${esc(d)}">`).join('')}</datalist>`)}
          ${f('emp-mgr', 'Reports to', `<select class="input" id="emp-mgr" name="managerId"><option value="">No one</option>${managers.map((m) => `<option value="${m.id}" ${m.id === e.managerId ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>`)}
          ${f('emp-join', 'Joining date', `<input class="input" id="emp-join" name="joinDate" type="date" value="${esc(e.joinDate)}" required>`)}
          ${f('emp-dob', 'Date of birth', `<input class="input" id="emp-dob" name="dob" type="date" value="${esc(e.dob)}">`)}
          ${f('emp-role', 'App access', `<select class="input" id="emp-role" name="role">${['employee', 'manager', 'hr'].map((r) => `<option value="${r}" ${r === e.role ? 'selected' : ''}>${roleText[r]}</option>`).join('')}</select>`)}
          <div class="form-section">Monthly salary (₹)</div>
          ${f('emp-basic', 'Basic', `<input class="input" id="emp-basic" name="basic" type="number" min="0" step="100" value="${e.salary.basic}" required>`)}
          ${f('emp-hra', 'HRA', `<input class="input" id="emp-hra" name="hra" type="number" min="0" step="100" value="${e.salary.hra}" required>`)}
          ${f('emp-allow', 'Other allowances', `<input class="input" id="emp-allow" name="allowances" type="number" min="0" step="100" value="${e.salary.allowances}" required>`)}
          ${f('emp-tds', 'TDS per month', `<input class="input" id="emp-tds" name="tds" type="number" min="0" step="100" value="${e.salary.tds}" required>`)}
        </div>
        <div class="modal-foot"><button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn btn-primary" type="submit">${isNew ? 'Add employee' : 'Save changes'}</button></div>
      </form>`);
  }

  function applyLeaveForm() {
    openModal('Apply for leave', `
      <form class="form" data-form="leave" id="leave-form">
        <div class="field"><label for="lv-type">Leave type</label>
          <select class="input" id="lv-type" name="type">${leaveTypes().map((t) => `<option>${esc(t)}</option>`).join('')}</select></div>
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
    const days = workingDays(from, to);
    if (days === 0) return 'Those dates are all weekends or holidays, so no leave is needed.';
    const u = me();
    const clash = db.leaves.find((l) => l.empId === u.id && l.status !== 'Rejected' && l.from <= to && l.to >= from);
    if (clash) return `You already have ${clash.type.toLowerCase()} leave from ${fmtShort(clash.from)} to ${fmtShort(clash.to)}.`;
    if (type !== 'Unpaid') {
      const b = balances(u.id).find((x) => x.type === type);
      if (b && days > b.left - b.pending) return `You have ${b.left - b.pending} ${type.toLowerCase()} day${b.left - b.pending === 1 ? '' : 's'} available (after pending requests). Choose fewer days or use unpaid leave.`;
    }
    return null;
  }

  function updateLeaveInfo() {
    const form = document.getElementById('leave-form'); const info = document.getElementById('lv-info');
    if (!form || !info) return;
    const { type, from, to } = Object.fromEntries(new FormData(form));
    const problem = leaveProblem(type, from, to);
    if (problem) { info.className = 'note bad'; info.textContent = problem; return; }
    const days = workingDays(from, to);
    const b = balances(me().id).find((x) => x.type === type);
    info.className = 'note';
    info.textContent = `${days} working day${days === 1 ? '' : 's'}` + (b ? `. You’ll have ${b.left - b.pending - days} ${type.toLowerCase()} days left.` : '. Unpaid leave is deducted from salary.');
  }

  function attendanceForm(empId, date) {
    const e = emp(empId); const rec = attOf(empId, date);
    openModal(`Attendance for ${e.name}`, `
      <form class="form" data-form="attendance" data-id="${empId}" data-date="${date}">
        <p class="small muted">${esc(fmtDay(date))}. Use this to correct a missed or wrong check-in.</p>
        <div class="form-grid">
          <div class="field"><label for="att-in">Check-in</label><input class="input" id="att-in" name="in" type="time" value="${rec?.in ?? ''}"></div>
          <div class="field"><label for="att-out">Check-out</label><input class="input" id="att-out" name="out" type="time" value="${rec?.out ?? ''}"></div>
        </div>
        <p class="small muted">Leave check-in empty to remove the record.</p>
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
    const views = { dashboard: viewDashboard, people: viewPeople, leave: viewLeave, attendance: viewAttendance, payroll: viewPayroll, settings: viewSettings };
    root.innerHTML = viewShell((views[state.route] || viewDashboard)());
  }

  function go(route, opts = {}) {
    state.route = route;
    if (route !== 'people' || !opts.keepProfile) state.profileId = opts.profileId ?? null;
    try { history.replaceState(null, '', '#' + route); } catch (e) { /* ignore */ }
    render();
    window.scrollTo(0, 0);
  }

  /* ================= Events ================= */

  const actions = {
    login(el) { state.userId = el.dataset.id; storage.set(SESSION_KEY, state.userId); state.tabs = { leave: 'mine', attendance: 'mine' }; go('dashboard'); },
    logout() { state.userId = null; storage.del(SESSION_KEY); render(); },
    tab(el) { state.tabs[el.dataset.view] = el.dataset.tab; render(); },
    'open-profile'(el) { go('people', { profileId: el.dataset.id }); },
    'close-profile'() { go('people'); },
    'new-employee'() { employeeForm(null); },
    'edit-employee'(el) { employeeForm(emp(el.dataset.id)); },
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
    'leave-filter'(el) { state.leaveFilter = el.dataset.status; render(); },
    checkin() {
      const s = todayISO();
      if (!attOf(me().id, s)) db.attendance.push({ empId: me().id, date: s, in: nowHM(), out: null });
      save(); render(); toast(`Checked in at ${nowHM()}`);
    },
    checkout() {
      const rec = attOf(me().id, todayISO());
      if (rec) { rec.out = nowHM(); save(); render(); toast(`Checked out at ${rec.out}`); }
    },
    'edit-att'(el) { attendanceForm(el.dataset.id, el.dataset.date); },
    'run-payroll'() {
      const ym = state.payMonth;
      const slips = payrollFor(db, ym);
      confirmBox(`Run payroll for ${monthLabel(ym)}?`, `This issues payslips to ${slips.length} employees for a total net pay of <b>${money(slips.reduce((a, x) => a + x.net, 0))}</b>. Employees can see their payslips right away.`, 'Run payroll', () => {
        db.payruns.push({ month: ym, processedOn: todayISO(), slips }); save(); toast(`Payroll for ${monthLabel(ym)} processed`);
      });
    },
    'rerun-payroll'() {
      const ym = state.payMonth;
      confirmBox(`Recalculate ${monthLabel(ym)}?`, 'Payslips for this month are replaced using current salaries and approved unpaid leave.', 'Recalculate', () => {
        const run = payrunFor(ym); run.slips = payrollFor(db, ym); run.processedOn = todayISO(); save(); toast('Payroll recalculated');
      });
    },
    'view-slip'(el) {
      openModal('Payslip', slipHTML(el.dataset.month, el.dataset.id), '<button class="btn" data-action="close-modal">Close</button>');
    },
    'remove-holiday'(el) {
      db.settings.holidays = db.settings.holidays.filter((h) => h.date !== el.dataset.date); save(); render(); toast('Holiday removed');
    },
    reset() {
      confirmBox('Reset demo data?', 'All changes in this browser are deleted and the sample company is restored.', 'Reset', () => {
        db = seed(); save(); toast('Demo data restored');
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
    if (t.id === 'people-dept') { state.peopleDept = t.value; render(); }
    if (t.id === 'att-month' && t.value) { state.attMonth = t.value; render(); }
    if (t.id === 'pay-month' && t.value) { state.payMonth = t.value; render(); }
  });

  document.addEventListener('submit', (ev) => {
    const form = ev.target.closest('form[data-form]');
    if (!form) return;
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const kind = form.dataset.form;

    if (kind === 'employee') {
      const id = form.dataset.id;
      const email = data.email.trim().toLowerCase();
      if (db.employees.some((x) => x.email.toLowerCase() === email && x.id !== id)) { toast('Another employee already uses that email.'); return; }
      const fields = {
        name: data.name.trim(), title: data.title.trim(), email, phone: data.phone.trim(), dept: data.dept.trim(),
        managerId: data.managerId || null, joinDate: data.joinDate, dob: data.dob, role: data.role,
        salary: { basic: +data.basic, hra: +data.hra, allowances: +data.allowances, tds: +data.tds },
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
      if (data.in && data.out && data.out < data.in) { toast('Check-out must be after check-in.'); return; }
      db.attendance = db.attendance.filter((a) => !(a.empId === id && a.date === date));
      if (data.in) db.attendance.push({ empId: id, date, in: data.in, out: data.out || null });
      save(); closeModal(); render(); toast('Attendance updated');
    }

    if (kind === 'settings') {
      db.settings.company = data.company.trim();
      db.settings.workStart = data.workStart;
      Object.keys(db.settings.leavePolicy).forEach((k) => { db.settings.leavePolicy[k] = Math.max(0, +data['lv-' + k] || 0); });
      save(); render(); toast('Settings saved');
    }

    if (kind === 'holiday') {
      if (db.settings.holidays.some((h) => h.date === data.date)) { toast('There’s already a holiday on that date.'); return; }
      db.settings.holidays.push({ date: data.date, name: data.name.trim() }); save(); render(); toast('Holiday added');
    }
  });

  // Keep the dashboard clock ticking without re-rendering the page.
  setInterval(() => { const el = document.getElementById('clock-time'); if (el) el.textContent = nowHM(); }, 15000);

  render();
})();
