# Putting PeopleDesk online for your team

This takes about 15 minutes. You need a free Supabase account (it stores the data and handles logins) and your GitHub account (it hosts the app).

Your app's address will be: **https://spandey000722.github.io/my-first-app/**

---

## Step 1: Create the database (Supabase)

1. Go to **supabase.com** and sign up (signing in with GitHub is easiest).
2. Click **New project**.
   - **Name:** `peopledesk`
   - **Database password:** click *Generate*, then save it somewhere safe (you won't need it day to day).
   - **Region:** *South Asia (Mumbai)*, the closest to Gujarat.
3. Click **Create new project** and wait a minute or two until it's ready.

## Step 2: Install PeopleDesk's tables and security rules

1. In your Supabase project, open **SQL Editor** (left menu) and click **New query**.
2. Open [`supabase/schema.sql`](supabase/schema.sql) in this repo, click the **copy** button, and paste everything into the query box.
3. Click **Run**. You should see *Success. No rows returned*.

Running it again later is safe: it doesn't delete data.

## Step 3: Point logins at your app

In Supabase, go to **Authentication → URL Configuration**:

- **Site URL:** `https://spandey000722.github.io/my-first-app/`
- **Redirect URLs:** add the same address.

Then go to **Authentication → Sign In / Providers → Email** and make sure **Confirm email** is **on**. This makes sure nobody can create a password for someone else's email address.

## Step 4: Connect the app to the database

In Supabase, open **Project Settings → API** (or click **Connect** at the top). Copy:

- **Project URL**, which looks like `https://abcdefgh.supabase.co`
- **anon public** key, a long text starting with `eyJ`

Send both to Claude and it will add them to `config.js` for you. Or edit [`config.js`](config.js) on GitHub yourself (pencil icon), paste them between the quotes, and click **Commit changes**.

The *anon public* key is designed to be public. The database's security rules decide what each person can see. **Never** share the *service_role* key.

## Step 5: Publish the app (GitHub Pages)

1. In this GitHub repo, go to **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**, then **main** and **/ (root)**, and click **Save**.
3. Wait a minute, then open https://spandey000722.github.io/my-first-app/

## Step 6: Set yourself up as HR

1. Open the app and click **First time here? Create your password**. Use your own email.
2. Open the confirmation email from Supabase and click the link.
3. Sign in. Because you're the first person, you'll see **Set up PeopleDesk**. Enter your name and your first company.
4. Go to **Settings** and check the shifts, holidays, leave policy and payroll rules. Add your other companies with **Add company**.

## Step 7: Add your team

1. **People → Add employee.** Put in each person's **email address**: that's how they sign in.
2. Send them the app address and tell them to click **First time here? Create your password** using that same email.
3. Give other HR staff **App access: HR**, and supervisors **App access: Manager**.

**Factory workers without email** don't need to sign in. Their supervisor (a Manager in the app) marks their attendance under **Attendance → Team today → Mark**.

---

## Good to know

- **Confirmation emails are limited.** Supabase's free built-in email only sends a few emails per hour. To add many people at once, create their logins yourself instead. In Supabase, go to **Authentication → Users → Add user → Create new user**, enter their email and a temporary password, and tick **Auto confirm**. They can sign in straight away. Or connect your own email service under **Authentication → Emails → SMTP settings**.
- **Free projects pause after a week with no activity.** Daily use keeps it awake. If it pauses, open Supabase and click **Restore**.
- **Backups:** the free plan doesn't include downloadable daily backups. Once you rely on PeopleDesk for payroll, consider Supabase's Pro plan, which includes daily backups.
- **The code is public; your data is not.** This GitHub repo is public, so anyone can read the app's code, but the data lives in Supabase behind logins and security rules.
- **Check-in is honour-based.** Employees check themselves in on their phone or computer. A biometric device or location check would be a later addition.
