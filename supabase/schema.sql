create extension if not exists pgcrypto;

create table if not exists public.users (
  id text primary key,
  given_id text not null unique,
  name text not null,
  username text not null unique,
  phone text unique,
  email text unique,
  city text not null default '',
  gender text not null default '',
  password_hash text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  lifetime_fp integer not null default 0,
  weekly_fp integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  draws integer not null default 0,
  total_correct integer not null default 0,
  logic_correct integer not null default 0,
  geography_correct integer not null default 0,
  technology_correct integer not null default 0,
  general_correct integer not null default 0,
  health_correct integer not null default 0,
  psychology_correct integer not null default 0,
  character_correct integer not null default 0,
  economy_correct integer not null default 0,
  bible_correct integer not null default 0,
  english_correct integer not null default 0,
  total_answer_time_ms integer not null default 0,
  total_answers integer not null default 0,
  current_win_streak integer not null default 0,
  fire_streak_days integer not null default 0,
  last_fire_date date,
  constraint users_username_format check (username ~ '^[a-z0-9_]{3,24}$'),
  constraint users_gender_format check (gender in ('', 'male', 'female'))
);

create table if not exists public.sessions (
  token_hash text primary key,
  user_id text not null references public.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  user_agent text,
  ip_hint text
);

create unique index if not exists idx_sessions_one_active_per_user
  on public.sessions (user_id);


create table if not exists public.password_reset_codes (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id text primary key references public.users(id) on delete cascade,
  music_enabled boolean not null default true,
  sfx_enabled boolean not null default true
);

create table if not exists public.system_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.relationships (
  owner_id text not null references public.users(id) on delete cascade,
  target_id text not null references public.users(id) on delete cascade,
  is_favourite boolean not null default true,
  primary key (owner_id, target_id),
  constraint relationships_not_self check (owner_id <> target_id)
);

create table if not exists public.questions (
  id text primary key,
  category text not null,
  question text not null,
  option_a text not null,
  option_b text not null,
  option_c text not null,
  option_d text not null,
  correct_option text not null check (correct_option in ('A', 'B', 'C', 'D')),
  image_url text,
  question_type text not null default 'text' check (question_type in ('text', 'image')),
  active boolean not null default true
);

create table if not exists public.daily_question_pool (
  pool_date date not null,
  category_key text not null default '',
  question_id text not null references public.questions(id) on delete cascade,
  primary key (pool_date, question_id)
);

create table if not exists public.duels (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  opponent_id text references public.users(id) on delete set null,
  opponent_name text not null,
  status text not null default 'active' check (status in ('active', 'finished', 'cancelled')),
  user_score integer not null default 0,
  opponent_score integer not null default 0,
  user_avg_time_ms integer not null default 0,
  opponent_avg_time_ms integer not null default 0,
  fp_awarded integer not null default 0,
  opponent_fp_awarded integer not null default 0,
  started_at timestamptz not null default now(),
  starts_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.duel_questions (
  duel_id text not null references public.duels(id) on delete cascade,
  question_id text not null references public.questions(id) on delete cascade,
  position integer not null check (position between 1 and 5),
  primary key (duel_id, position)
);

create table if not exists public.duel_answers (
  duel_id text not null references public.duels(id) on delete cascade,
  question_id text not null references public.questions(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  selected_option text check (selected_option in ('A', 'B', 'C', 'D')),
  is_correct boolean not null,
  answer_time_ms integer not null default 0,
  answered_at timestamptz not null default now(),
  primary key (duel_id, question_id, user_id)
);

create table if not exists public.duel_queue (
  user_id text primary key references public.users(id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting', 'matched', 'cancelled')),
  duel_id text references public.duels(id) on delete set null,
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.duel_requests (
  id text primary key,
  requester_id text not null references public.users(id) on delete cascade,
  target_id text not null references public.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  duel_id text references public.duels(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '20 seconds'),
  responded_at timestamptz,
  constraint duel_requests_not_self check (requester_id <> target_id)
);

create table if not exists public.badges (
  id text primary key,
  name text not null,
  description text not null,
  img_url text
);

create table if not exists public.user_badges (
  user_id text not null references public.users(id) on delete cascade,
  badge_id text not null references public.badges(id) on delete cascade,
  earned_at timestamptz not null default now(),
  primary key (user_id, badge_id)
);

create table if not exists public.weekly_rank_snapshots (
  week_key text not null,
  user_id text not null references public.users(id) on delete cascade,
  rank integer not null,
  weekly_fp integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (week_key, rank)
);

create index if not exists idx_users_weekly on public.users (weekly_fp desc, lifetime_fp desc);
create index if not exists idx_users_seen on public.users (last_seen_at);
create index if not exists idx_users_lower_username on public.users (lower(username));
create unique index if not exists idx_users_lower_email on public.users (lower(email)) where email is not null and email <> '';
create index if not exists idx_questions_active on public.questions (active, category);
create index if not exists idx_daily_question_pool_date on public.daily_question_pool (pool_date);
create index if not exists idx_daily_question_pool_date_category on public.daily_question_pool (pool_date, category_key);
create index if not exists idx_duels_user_started on public.duels (user_id, started_at desc);
create index if not exists idx_duels_opponent_started on public.duels (opponent_id, started_at desc);
create index if not exists idx_duels_started_status on public.duels (started_at desc, status);
create index if not exists idx_duel_answers_duel_user on public.duel_answers (duel_id, user_id);
create index if not exists idx_duel_answers_user_answered on public.duel_answers (user_id, answered_at desc);
create index if not exists idx_duel_queue_waiting on public.duel_queue (status, updated_at, last_seen_at);
create index if not exists idx_duel_requests_target on public.duel_requests (target_id, status, created_at desc);
create index if not exists idx_duel_requests_requester on public.duel_requests (requester_id, target_id, status);
create index if not exists idx_duel_requests_expiry on public.duel_requests (status, expires_at);
create index if not exists idx_password_reset_codes_user_expiry on public.password_reset_codes (user_id, expires_at desc);
create index if not exists idx_weekly_rank_snapshots_user_rank on public.weekly_rank_snapshots (user_id, rank);
create index if not exists idx_weekly_rank_snapshots_week_rank on public.weekly_rank_snapshots (week_key, rank);

alter table public.users enable row level security;
alter table public.sessions enable row level security;
alter table public.user_settings enable row level security;
alter table public.password_reset_codes enable row level security;
alter table public.system_settings enable row level security;
alter table public.relationships enable row level security;
alter table public.questions enable row level security;
alter table public.daily_question_pool enable row level security;
alter table public.duels enable row level security;
alter table public.duel_questions enable row level security;
alter table public.duel_answers enable row level security;
alter table public.duel_queue enable row level security;
alter table public.duel_requests enable row level security;
alter table public.badges enable row level security;
alter table public.user_badges enable row level security;
alter table public.weekly_rank_snapshots enable row level security;

create or replace function public.match_duel_queue(
  p_user_id text,
  p_question_ids text[],
  p_day_start timestamptz,
  p_daily_limit integer default 7
)
returns table(matched boolean, duel_id text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_duel_id text;
  v_existing_duel_id text;
  v_opponent_id text;
  v_question_count integer;
  v_user_today integer;
begin
  v_question_count := coalesce(array_length(p_question_ids, 1), 0);
  if v_question_count < 5 then
    raise exception 'QUESTION_POOL_NOT_READY';
  end if;

  perform pg_advisory_xact_lock(hashtext('forge_duel_queue_matchmaking'));

  select count(*)
    into v_user_today
    from public.duels
   where status <> 'cancelled'
     and started_at >= p_day_start
     and (user_id = p_user_id or opponent_id = p_user_id);

  if v_user_today >= p_daily_limit then
    raise exception 'LIMIT_REACHED';
  end if;

  update public.users
     set last_seen_at = now()
   where id = p_user_id;

  update public.duel_queue
     set status = 'cancelled',
         updated_at = now()
   where (status = 'waiting' and last_seen_at < now() - interval '15 seconds')
      or (status = 'matched' and updated_at < now() - interval '2 minutes');

  select q.duel_id
    into v_existing_duel_id
    from public.duel_queue q
    join public.duels d on d.id = q.duel_id
   where q.user_id = p_user_id
     and q.status = 'matched'
     and d.status = 'active'
   limit 1;

  if v_existing_duel_id is not null then
    return query select true, v_existing_duel_id;
    return;
  end if;

  insert into public.duel_queue (user_id, status, duel_id, last_seen_at, updated_at)
  values (p_user_id, 'waiting', null, now(), now())
  on conflict (user_id) do update
     set status = 'waiting',
         duel_id = null,
         last_seen_at = now(),
         updated_at = now()
   where public.duel_queue.status <> 'matched'
      or public.duel_queue.updated_at < now() - interval '2 minutes';

  select q.user_id
    into v_opponent_id
    from public.duel_queue q
    join public.users u on u.id = q.user_id
   where q.status = 'waiting'
     and q.user_id <> p_user_id
     and q.last_seen_at > now() - interval '15 seconds'
     and coalesce(u.last_seen_at, '-infinity'::timestamptz) > now() - interval '2 minutes'
     and (
       select count(*)
         from public.duels d
        where d.status <> 'cancelled'
          and d.started_at >= p_day_start
          and (d.user_id = q.user_id or d.opponent_id = q.user_id)
     ) < p_daily_limit
   order by q.updated_at asc
   for update skip locked
   limit 1;

  if v_opponent_id is null then
    return query select false, null::text;
    return;
  end if;

  v_duel_id := 'duel_' || replace(gen_random_uuid()::text, '-', '');

  insert into public.duels (
    id,
    user_id,
    opponent_id,
    opponent_name,
    status,
    started_at,
    starts_at
  )
  select
    v_duel_id,
    p_user_id,
    u.id,
    u.username,
    'active',
    now(),
    now() + interval '3 seconds'
  from public.users u
  where u.id = v_opponent_id;

  insert into public.duel_questions (duel_id, question_id, position)
  select v_duel_id, question_id, position
  from unnest(p_question_ids) with ordinality as picked(question_id, position)
  where position <= 5;

  update public.duel_queue
     set status = 'matched',
         duel_id = v_duel_id,
         updated_at = now(),
         last_seen_at = now()
   where user_id in (p_user_id, v_opponent_id);

  return query select true, v_duel_id;
end;
$$;

-- Weekly Hall of Legends retention helper: keep only the latest 2 weeks of weekly snapshots.
create or replace function public.cleanup_old_weekly_rank_snapshots()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.weekly_rank_snapshots
  where week_key ~ '^\d{4}-\d{2}-\d{2}$'
    and week_key::date < (current_date - interval '14 days');
  return null;
end;
$$;

drop trigger if exists trg_cleanup_old_weekly_rank_snapshots on public.weekly_rank_snapshots;
create trigger trg_cleanup_old_weekly_rank_snapshots
after insert or update on public.weekly_rank_snapshots
for each statement
execute function public.cleanup_old_weekly_rank_snapshots();
