-- BHUMI SURVEY: PUBLIC REVIEWS + ADMIN APPROVAL
-- Run in Supabase Dashboard -> SQL Editor.
-- First create your admin Auth user in Authentication -> Users.

create extension if not exists pgcrypto;

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  name varchar(80) not null,
  project varchar(120),
  rating integer not null check (rating between 1 and 5),
  message varchar(1200) not null,
  status varchar(20) not null default 'pending'
    check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  ip_hash text,
  content_hash text
);

create table if not exists public.review_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table if not exists public.review_rate_limits (
  key text primary key,
  window_started_at timestamptz not null default now(),
  submissions integer not null default 0
);

alter table public.reviews enable row level security;
alter table public.review_admins enable row level security;
alter table public.review_rate_limits enable row level security;

create or replace function public.is_review_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.review_admins
    where user_id = auth.uid()
  );
$$;

revoke all on function public.is_review_admin() from public;
grant execute on function public.is_review_admin() to authenticated;

drop policy if exists "Public can read approved reviews" on public.reviews;
create policy "Public can read approved reviews"
on public.reviews for select
to anon, authenticated
using (status = 'approved' or public.is_review_admin());

drop policy if exists "Admins can update reviews" on public.reviews;
create policy "Admins can update reviews"
on public.reviews for update
to authenticated
using (public.is_review_admin())
with check (public.is_review_admin());

drop policy if exists "Admins can delete reviews" on public.reviews;
create policy "Admins can delete reviews"
on public.reviews for delete
to authenticated
using (public.is_review_admin());

-- Public visitors never get direct INSERT access.
-- The Edge Function inserts using the server-side service role.
revoke insert, update, delete on public.reviews from anon;
revoke insert on public.reviews from authenticated;
revoke all on public.review_rate_limits from anon, authenticated;

create index if not exists reviews_status_created_idx
on public.reviews(status, created_at desc);

create index if not exists reviews_content_hash_idx
on public.reviews(content_hash);

-- AFTER creating your Supabase Auth admin account, run:
-- insert into public.review_admins(user_id)
-- values ('YOUR_ADMIN_AUTH_USER_UUID')
-- on conflict do nothing;
