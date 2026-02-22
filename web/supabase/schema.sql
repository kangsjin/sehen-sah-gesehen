-- Run in Supabase SQL editor

create table if not exists public.verbs (
  id text primary key,
  infinitive text not null,
  praeteritum text not null,
  partizip2 text not null,
  english_meaning text not null default '',
  korean_meaning text not null default '',
  verb_level text not null default '' check (verb_level in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2', '')),
  created_at timestamptz not null default now()
);

create index if not exists verbs_infinitive_idx on public.verbs (infinitive);
create index if not exists verbs_level_idx on public.verbs (verb_level);

create table if not exists public.user_cards (
  user_id uuid not null references auth.users(id) on delete cascade,
  verb_id text not null references public.verbs(id) on delete cascade,
  target_form text not null check (target_form in ('infinitive', 'praeteritum', 'partizip2')),
  due_at timestamptz not null default now(),
  stability double precision not null default 0,
  difficulty double precision not null default 5,
  reps integer not null default 0,
  lapses integer not null default 0,
  state text not null default 'new' check (state in ('new', 'learning', 'review', 'relearning')),
  last_review_at timestamptz,
  next_interval_days double precision not null default 0,
  total_reviews integer not null default 0,
  correct_reviews integer not null default 0,
  last_input text,
  last_answer text,
  primary key (user_id, verb_id, target_form)
);

create index if not exists user_cards_due_idx on public.user_cards (user_id, due_at);

create table if not exists public.user_learning_cards (
  user_id uuid not null references auth.users(id) on delete cascade,
  verb_id text not null references public.verbs(id) on delete cascade,
  target_form text not null check (target_form in ('infinitive', 'praeteritum', 'partizip2')),
  due_at timestamptz not null default now(),
  stability double precision not null default 0,
  difficulty double precision not null default 5,
  reps integer not null default 0,
  lapses integer not null default 0,
  state text not null default 'new' check (state in ('new', 'learning', 'review', 'relearning')),
  last_review_at timestamptz,
  next_interval_days double precision not null default 0,
  total_reviews integer not null default 0,
  correct_reviews integer not null default 0,
  last_input text,
  last_answer text,
  primary key (user_id, verb_id, target_form)
);

create index if not exists user_learning_cards_due_idx on public.user_learning_cards (user_id, due_at);

create table if not exists public.review_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  verb_id text not null references public.verbs(id) on delete cascade,
  target_form text not null check (target_form in ('infinitive', 'praeteritum', 'partizip2')),
  client_source text not null default 'unknown',
  rating integer not null,
  correct boolean not null,
  reviewed_at timestamptz not null default now(),
  scheduled_days double precision not null,
  elapsed_days double precision not null,
  stability double precision not null,
  difficulty double precision not null,
  user_input text,
  answer_expected text
);

create index if not exists review_logs_user_time_idx on public.review_logs (user_id, reviewed_at desc);

create table if not exists public.learning_review_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  verb_id text not null references public.verbs(id) on delete cascade,
  target_form text not null check (target_form in ('infinitive', 'praeteritum', 'partizip2')),
  client_source text not null default 'web_learning',
  rating integer not null,
  correct boolean not null,
  reviewed_at timestamptz not null default now(),
  scheduled_days double precision not null,
  elapsed_days double precision not null,
  stability double precision not null,
  difficulty double precision not null,
  user_input text,
  answer_expected text
);

create index if not exists learning_review_logs_user_time_idx on public.learning_review_logs (user_id, reviewed_at desc);

alter table public.review_logs
  add column if not exists client_source text not null default 'unknown';

alter table public.learning_review_logs
  add column if not exists client_source text not null default 'web_learning';

grant select on public.verbs to anon, authenticated;
grant select, insert, update, delete on public.user_cards to authenticated;
grant select, insert, update, delete on public.user_learning_cards to authenticated;
grant select, insert on public.review_logs to authenticated;
grant select, insert on public.learning_review_logs to authenticated;
grant usage, select on all sequences in schema public to authenticated;
alter table public.verbs enable row level security;
alter table public.user_cards enable row level security;
alter table public.user_learning_cards enable row level security;
alter table public.review_logs enable row level security;
alter table public.learning_review_logs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'verbs' and policyname = 'verbs_read_all'
  ) then
    create policy verbs_read_all on public.verbs for select using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_cards' and policyname = 'user_cards_owner_all'
  ) then
    create policy user_cards_owner_all on public.user_cards
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_learning_cards' and policyname = 'user_learning_cards_owner_all'
  ) then
    create policy user_learning_cards_owner_all on public.user_learning_cards
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'review_logs' and policyname = 'review_logs_owner_all'
  ) then
    create policy review_logs_owner_all on public.review_logs
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'learning_review_logs' and policyname = 'learning_review_logs_owner_all'
  ) then
    create policy learning_review_logs_owner_all on public.learning_review_logs
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

create or replace function public.init_user_cards(p_user_id uuid default auth.uid())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
begin
  if p_user_id is null then
    raise exception 'user id is required';
  end if;

  if auth.uid() is distinct from p_user_id then
    raise exception 'cannot initialize cards for another user';
  end if;

  insert into public.user_cards (
    user_id,
    verb_id,
    target_form,
    due_at,
    stability,
    difficulty,
    reps,
    lapses,
    state,
    next_interval_days
  )
  select
    p_user_id,
    v.id,
    f.target_form,
    now(),
    0,
    5,
    0,
    0,
    'new',
    0
  from public.verbs v
  cross join (
    values
      ('infinitive'::text),
      ('praeteritum'::text),
      ('partizip2'::text)
  ) as f(target_form)
  on conflict (user_id, verb_id, target_form) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function public.init_user_cards(uuid) from public;
grant execute on function public.init_user_cards(uuid) to authenticated;

create or replace function public.init_user_learning_cards(p_user_id uuid default auth.uid())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
begin
  if p_user_id is null then
    raise exception 'user id is required';
  end if;

  if auth.uid() is distinct from p_user_id then
    raise exception 'cannot initialize cards for another user';
  end if;

  insert into public.user_learning_cards (
    user_id,
    verb_id,
    target_form,
    due_at,
    stability,
    difficulty,
    reps,
    lapses,
    state,
    next_interval_days
  )
  select
    p_user_id,
    v.id,
    f.target_form,
    now(),
    0,
    5,
    0,
    0,
    'new',
    0
  from public.verbs v
  cross join (
    values
      ('infinitive'::text),
      ('praeteritum'::text),
      ('partizip2'::text)
  ) as f(target_form)
  on conflict (user_id, verb_id, target_form) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function public.init_user_learning_cards(uuid) from public;
grant execute on function public.init_user_learning_cards(uuid) to authenticated;
