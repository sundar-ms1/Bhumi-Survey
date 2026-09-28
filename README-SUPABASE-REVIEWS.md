# Bhumi Survey — Supabase Public Reviews

This package contains the changed website and Supabase files for the public review system.

## Files
- `index.html` — website with Supabase approved-review loading and public review submission.
- `review-admin.html` — admin login and approve/reject/delete dashboard.
- `supabase_reviews_schema.sql` — tables, RLS policies and admin authorization.
- `supabase/functions/submit-review/index.ts` — server-side Edge Function with validation, honeypot, duplicate detection and IP-hash rate limiting.
- `project-01-total-station-survey.jpg` — current project photo referenced by the website.

## Supabase project
Project URL is already configured in the HTML files.
The publishable key is also configured for browser use. Do not add a Supabase secret/service-role key to the website.

## 1. Run database SQL
Supabase Dashboard → SQL Editor → New query.
Open `supabase_reviews_schema.sql`, paste the complete contents and Run.

## 2. Create admin user
Supabase Dashboard → Authentication → Users → Add user.
Create your email/password admin account and copy its User UID.
Then run:

insert into public.review_admins(user_id)
values ('YOUR_ADMIN_AUTH_USER_UUID')
on conflict do nothing;

## 3. Deploy Edge Function
Install/login to the Supabase CLI, then from this package folder:

supabase login
supabase projects list
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set RATE_LIMIT_SALT="PUT-A-LONG-RANDOM-SECRET-HERE"
supabase functions deploy submit-review --use-api

Supabase documents CLI and dashboard deployment of Edge Functions.

## 4. Website
Copy `index.html` and `project-01-total-station-survey.jpg` into your Bhumi Survey website folder.
Copy `review-admin.html` to the website root or another admin-only/unlinked path.

## 5. Test
1. Open the public site.
2. Submit a review.
3. It should remain pending.
4. Open `review-admin.html`.
5. Sign in with the admin account.
6. Approve the review.
7. Refresh the public site.

## Spam protection
- Server-side validation
- Honeypot field
- Minimum completion-time check
- Duplicate detection
- Maximum 3 submissions per IP hash per hour
- Admin approval before public display
