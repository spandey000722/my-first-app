-- PeopleDesk database for Supabase.
-- Run this once in Supabase: SQL Editor → New query → paste → Run.
--
-- Security model (enforced by the database, not just hidden in the app):
--   * A signed-in user is linked to an employee by matching email address.
--     People without an employee record can see nothing.
--   * HR can read and change everything.
--   * Managers see and act on their direct reports (leave, attendance, overtime).
--   * Employees see their own pay, leave, attendance and payslips, plus the
--     directory of their own company. They cannot see anyone else's pay.

-- ============ Tables ============

create table if not exists public.companies (
  id            text primary key,
  name          text not null,
  short         text not null,
  address       text not null default '',
  pf_code       text not null default '',
  esi_code      text not null default '',
  weekly_off    int[] not null default '{0}',
  grace_min     int  not null default 10,
  shifts        jsonb not null default '[]',
  leave_policy  jsonb not null default '{}',
  holidays      jsonb not null default '[]',
  rules         jsonb not null default '{}'
);

create table if not exists public.employees (
  id          text primary key,
  company_id  text not null references public.companies(id),
  name        text not null,
  title       text not null default '',
  dept        text not null default '',
  role        text not null default 'employee' check (role in ('hr', 'manager', 'employee')),
  manager_id  text references public.employees(id) on delete set null,
  join_date   date not null,
  dob         date,
  status      text not null default 'Active' check (status in ('Active', 'Inactive')),
  pay_type    text not null default 'monthly' check (pay_type in ('monthly', 'daily')),
  shift_id    text,
  weekly_off  int[],
  phone       text not null default '',
  email       text not null default ''
);
create unique index if not exists employees_email_key on public.employees (lower(email)) where email <> '';

-- Pay lives in its own table so it can be locked down separately from the directory.
create table if not exists public.employee_pay (
  employee_id text primary key references public.employees(id) on delete cascade,
  basic       numeric not null default 0,
  hra         numeric not null default 0,
  allowances  numeric not null default 0,
  tds         numeric not null default 0,
  daily_rate  numeric not null default 0
);

create table if not exists public.leaves (
  id          text primary key,
  emp_id      text not null references public.employees(id) on delete cascade,
  type        text not null,
  from_date   date not null,
  to_date     date not null,
  status      text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected')),
  reason      text not null default '',
  applied_on  date not null default current_date,
  decided_by  text references public.employees(id) on delete set null,
  check (to_date >= from_date)
);

create table if not exists public.attendance (
  emp_id     text not null references public.employees(id) on delete cascade,
  date       date not null,
  in_time    text not null check (in_time ~ '^\d{2}:\d{2}$'),
  out_time   text check (out_time ~ '^\d{2}:\d{2}$'),
  ot_status  text check (ot_status in ('Pending', 'Approved', 'Rejected')),
  ot_by      text references public.employees(id) on delete set null,
  primary key (emp_id, date)
);

create table if not exists public.payruns (
  company_id    text not null references public.companies(id) on delete cascade,
  month         text not null check (month ~ '^\d{4}-\d{2}$'),
  processed_on  date not null default current_date,
  primary key (company_id, month)
);

create table if not exists public.payslips (
  company_id  text not null,
  month       text not null,
  emp_id      text not null references public.employees(id) on delete cascade,
  data        jsonb not null,
  primary key (company_id, month, emp_id),
  foreign key (company_id, month) references public.payruns(company_id, month) on delete cascade
);

create index if not exists leaves_emp_idx on public.leaves (emp_id);
create index if not exists attendance_date_idx on public.attendance (date);
create index if not exists employees_manager_idx on public.employees (manager_id);

-- ============ Who is signed in ============

-- The employee record whose email matches the signed-in user (active staff only).
create or replace function public.my_emp_id() returns text
language sql stable security definer set search_path = public as $$
  select id from employees
  where email <> '' and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and status = 'Active'
  limit 1
$$;

create or replace function public.my_company() returns text
language sql stable security definer set search_path = public as $$
  select company_id from employees where id = public.my_emp_id()
$$;

create or replace function public.is_hr() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from employees where id = public.my_emp_id() and role = 'hr')
$$;

-- True when the signed-in user is this employee's direct manager.
create or replace function public.manages(target text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from employees where id = target and manager_id = public.my_emp_id())
$$;

create or replace function public.can_see(target text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_hr() or target = public.my_emp_id() or public.manages(target)
$$;

-- ============ First-time setup ============

-- True until the first HR person has set PeopleDesk up.
create or replace function public.setup_needed() returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from employees)
$$;

-- Creates the first company and makes the signed-in user its HR admin.
-- Only works while the database has no employees.
create or replace function public.bootstrap(company jsonb, your_name text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_email text := auth.jwt() ->> 'email';
begin
  lock table employees in exclusive mode;
  if exists (select 1 from employees) then
    raise exception 'PeopleDesk is already set up. Ask HR to add you as an employee.';
  end if;
  if v_email is null or v_email = '' then
    raise exception 'Sign in before setting up PeopleDesk.';
  end if;
  insert into companies (id, name, short, address, pf_code, esi_code, weekly_off, grace_min, shifts, leave_policy, holidays, rules)
  values (
    company ->> 'id', company ->> 'name', company ->> 'short',
    coalesce(company ->> 'address', ''), coalesce(company ->> 'pf_code', ''), coalesce(company ->> 'esi_code', ''),
    coalesce((select array_agg(d::int) from jsonb_array_elements_text(company -> 'weekly_off') d), '{0}'),
    coalesce((company ->> 'grace_min')::int, 10),
    coalesce(company -> 'shifts', '[]'), coalesce(company -> 'leave_policy', '{}'),
    coalesce(company -> 'holidays', '[]'), coalesce(company -> 'rules', '{}'));
  insert into employees (id, company_id, name, title, dept, role, join_date, email, shift_id)
    values ('E001', company ->> 'id', your_name, 'HR', 'Human Resources', 'hr', current_date, v_email,
            (company -> 'shifts' -> 0 ->> 'id'));
  insert into employee_pay (employee_id) values ('E001');
  return 'E001';
end
$$;

-- ============ Attendance guard ============

-- Employees may only check themselves out (once) and cannot change times
-- afterwards or approve their own overtime. HR and managers can correct records.
create or replace function public.attendance_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_hr() or public.manages(old.emp_id) then
    return new;
  end if;
  if new.emp_id is distinct from old.emp_id or new.date is distinct from old.date
     or new.in_time is distinct from old.in_time
     or old.out_time is not null
     or new.ot_by is distinct from old.ot_by
     or coalesce(new.ot_status, 'Pending') <> 'Pending' then
    raise exception 'You can only check out of your own attendance. Ask HR or your manager to correct it.';
  end if;
  return new;
end
$$;

drop trigger if exists attendance_guard on public.attendance;
create trigger attendance_guard before update on public.attendance
  for each row execute function public.attendance_guard();

-- ============ Row level security ============

alter table public.companies    enable row level security;
alter table public.employees    enable row level security;
alter table public.employee_pay enable row level security;
alter table public.leaves       enable row level security;
alter table public.attendance   enable row level security;
alter table public.payruns      enable row level security;
alter table public.payslips     enable row level security;

-- Companies: every staff member can read (their app needs shifts, holidays, rules); HR edits.
drop policy if exists companies_read on public.companies;
create policy companies_read on public.companies for select to authenticated
  using (public.my_emp_id() is not null);
drop policy if exists companies_hr on public.companies;
create policy companies_hr on public.companies for all to authenticated
  using (public.is_hr()) with check (public.is_hr());

-- Employees: HR sees everyone; others see their own company and their direct reports.
drop policy if exists employees_read on public.employees;
create policy employees_read on public.employees for select to authenticated
  using (public.is_hr() or company_id = public.my_company() or manager_id = public.my_emp_id());
drop policy if exists employees_hr on public.employees;
create policy employees_hr on public.employees for all to authenticated
  using (public.is_hr()) with check (public.is_hr());

-- Pay: HR and the employee themself only.
drop policy if exists pay_read on public.employee_pay;
create policy pay_read on public.employee_pay for select to authenticated
  using (public.is_hr() or employee_id = public.my_emp_id());
drop policy if exists pay_hr on public.employee_pay;
create policy pay_hr on public.employee_pay for all to authenticated
  using (public.is_hr()) with check (public.is_hr());

-- Leave: you, your manager and HR. You apply and cancel; your manager or HR decides.
drop policy if exists leaves_read on public.leaves;
create policy leaves_read on public.leaves for select to authenticated
  using (public.can_see(emp_id));
drop policy if exists leaves_apply on public.leaves;
create policy leaves_apply on public.leaves for insert to authenticated
  with check (public.is_hr() or (emp_id = public.my_emp_id() and status = 'Pending' and decided_by is null));
drop policy if exists leaves_decide on public.leaves;
create policy leaves_decide on public.leaves for update to authenticated
  using (public.is_hr() or public.manages(emp_id))
  with check (public.is_hr() or public.manages(emp_id));
drop policy if exists leaves_cancel on public.leaves;
create policy leaves_cancel on public.leaves for delete to authenticated
  using (public.is_hr() or (emp_id = public.my_emp_id() and status = 'Pending'));

-- Attendance: you check in for today; your manager or HR can mark and correct.
drop policy if exists attendance_read on public.attendance;
create policy attendance_read on public.attendance for select to authenticated
  using (public.can_see(emp_id));
drop policy if exists attendance_add on public.attendance;
create policy attendance_add on public.attendance for insert to authenticated
  with check (public.is_hr() or public.manages(emp_id)
    or (emp_id = public.my_emp_id() and out_time is null and ot_status is null and ot_by is null
        and date between current_date - 1 and current_date + 1));
drop policy if exists attendance_change on public.attendance;
create policy attendance_change on public.attendance for update to authenticated
  using (public.can_see(emp_id)) with check (public.can_see(emp_id));
drop policy if exists attendance_remove on public.attendance;
create policy attendance_remove on public.attendance for delete to authenticated
  using (public.is_hr() or public.manages(emp_id));

-- Payroll: HR runs it. Staff see which months were run for their company and only their own payslip.
drop policy if exists payruns_read on public.payruns;
create policy payruns_read on public.payruns for select to authenticated
  using (public.is_hr() or company_id = public.my_company());
drop policy if exists payruns_hr on public.payruns;
create policy payruns_hr on public.payruns for all to authenticated
  using (public.is_hr()) with check (public.is_hr());
drop policy if exists payslips_read on public.payslips;
create policy payslips_read on public.payslips for select to authenticated
  using (public.is_hr() or emp_id = public.my_emp_id());
drop policy if exists payslips_hr on public.payslips;
create policy payslips_hr on public.payslips for all to authenticated
  using (public.is_hr()) with check (public.is_hr());

-- ============ Access for the app ============

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on function public.my_emp_id(), public.setup_needed(), public.bootstrap(jsonb, text) to authenticated;
grant execute on function public.my_company(), public.is_hr(), public.manages(text), public.can_see(text) to authenticated;
