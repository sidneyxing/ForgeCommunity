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
  active boolean not null default true,
  used_in_pool boolean not null default false,
  last_pooled_date date
);

create table if not exists public.daily_question_pool (
  pool_date date not null,
  category_key text not null default '',
  question_id text not null references public.questions(id) on delete cascade,
  created_at timestamptz not null default now(),
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
create index if not exists idx_daily_question_pool_question on public.daily_question_pool (question_id);
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

-- Daily question pool helper.
-- Target: 10 FORGE categories x 5 questions/category = 50 questions/day.
-- active = admin control. used_in_pool = rotation marker.
create or replace function public.forge_daily_categories()
returns table(category_key text, sort_order integer)
language sql
stable
as $$
  values
    ('Logika & Matematika'::text, 1),
    ('Geografi'::text, 2),
    ('Teknologi'::text, 3),
    ('Pengetahuan Umum'::text, 4),
    ('Kesehatan'::text, 5),
    ('Psikologi'::text, 6),
    ('Karakter & Moral'::text, 7),
    ('Ekonomi'::text, 8),
    ('Alkitab'::text, 9),
    ('Bahasa Inggris'::text, 10);
$$;

create or replace function public.forge_question_category_key(p_category text)
returns text
language sql
immutable
as $$
  select case
    when lower(trim(coalesce(p_category, ''))) in ('logika & matematika', 'logika dan matematika')
      or lower(coalesce(p_category, '')) like '%logika%'
      or lower(coalesce(p_category, '')) like '%matematika%'
      or lower(coalesce(p_category, '')) like '%logic%'
      or lower(coalesce(p_category, '')) like '%math%'
      then 'Logika & Matematika'
    when lower(coalesce(p_category, '')) like '%geografi%'
      or lower(coalesce(p_category, '')) like '%geography%'
      or lower(coalesce(p_category, '')) like '%nations%'
      then 'Geografi'
    when lower(coalesce(p_category, '')) like '%teknologi%'
      or lower(coalesce(p_category, '')) like '%technology%'
      or lower(coalesce(p_category, '')) like '%tech%'
      then 'Teknologi'
    when lower(coalesce(p_category, '')) like '%pengetahuan umum%'
      or lower(coalesce(p_category, '')) like '%general%'
      or lower(coalesce(p_category, '')) like '%knowledge%'
      or lower(coalesce(p_category, '')) like '%sains%'
      or lower(coalesce(p_category, '')) like '%sejarah%'
      then 'Pengetahuan Umum'
    when lower(coalesce(p_category, '')) like '%kesehatan%'
      or lower(coalesce(p_category, '')) like '%health%'
      or lower(coalesce(p_category, '')) like '%medical%'
      or lower(coalesce(p_category, '')) like '%wellness%'
      then 'Kesehatan'
    when lower(coalesce(p_category, '')) like '%psikologi%'
      or lower(coalesce(p_category, '')) like '%psychology%'
      or lower(coalesce(p_category, '')) like '%komunikasi%'
      or lower(coalesce(p_category, '')) like '%mind%'
      then 'Psikologi'
    when lower(coalesce(p_category, '')) like '%karakter%'
      or lower(coalesce(p_category, '')) like '%moral%'
      or lower(coalesce(p_category, '')) like '%character%'
      or lower(coalesce(p_category, '')) like '%refleksi%'
      or lower(coalesce(p_category, '')) like '%kepemimpinan%'
      or lower(coalesce(p_category, '')) like '%situational%'
      or lower(coalesce(p_category, '')) like '%leadership%'
      then 'Karakter & Moral'
    when lower(coalesce(p_category, '')) like '%ekonomi%'
      or lower(coalesce(p_category, '')) like '%economy%'
      or lower(coalesce(p_category, '')) like '%keuangan%'
      or lower(coalesce(p_category, '')) like '%finance%'
      or lower(coalesce(p_category, '')) like '%financial%'
      then 'Ekonomi'
    when lower(coalesce(p_category, '')) like '%alkitab%'
      or lower(coalesce(p_category, '')) like '%bible%'
      then 'Alkitab'
    when lower(coalesce(p_category, '')) like '%bahasa inggris%'
      or lower(coalesce(p_category, '')) like '%english%'
      or lower(coalesce(p_category, '')) like '%grammar%'
      or lower(coalesce(p_category, '')) like '%vocabulary%'
      then 'Bahasa Inggris'
    else null
  end;
$$;

drop function if exists public.get_daily_duel_question_ids(date, integer);
drop function if exists public.generate_daily_question_pool(date, integer);
drop function if exists public.generate_daily_question_pool(date, integer, boolean);

create or replace function public.reset_used_in_pool_if_exhausted(p_per_category integer default 5)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_missing_count integer;
begin
  select count(*)
    into v_missing_count
    from public.forge_daily_categories() c
    left join (
      select public.forge_question_category_key(category) as category_key, count(*) as available
        from public.questions
       where active = true
         and used_in_pool = false
       group by public.forge_question_category_key(category)
    ) a on a.category_key = c.category_key
   where coalesce(a.available, 0) < p_per_category;

  if v_missing_count = 0 then
    return false;
  end if;

  update public.questions
     set used_in_pool = false,
         last_pooled_date = null
   where active = true;

  return true;
end;
$$;

create or replace function public.generate_daily_question_pool(
  p_pool_date date default (now() at time zone 'Asia/Makassar')::date,
  p_per_category integer default 5,
  p_force_regenerate boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category_count integer;
  v_expected integer;
  v_existing integer;
  v_inserted integer;
  v_missing text;
begin
  if p_pool_date is null then
    raise exception 'POOL_DATE_REQUIRED';
  end if;

  if p_per_category <= 0 then
    raise exception 'PER_CATEGORY_MUST_BE_POSITIVE';
  end if;

  perform pg_advisory_xact_lock(hashtext('forge_daily_question_pool_' || p_pool_date::text));

  select count(*) into v_category_count from public.forge_daily_categories();
  v_expected := v_category_count * p_per_category;

  select count(*) into v_existing
    from public.daily_question_pool
   where pool_date = p_pool_date;

  if not p_force_regenerate and v_existing >= v_expected then
    return v_existing;
  end if;

  if p_force_regenerate or (v_existing > 0 and v_existing < v_expected) then
    update public.questions q
       set used_in_pool = false,
           last_pooled_date = null
      from public.daily_question_pool d
     where d.pool_date = p_pool_date
       and d.question_id = q.id
       and q.last_pooled_date = p_pool_date;

    delete from public.daily_question_pool
     where pool_date = p_pool_date;
  end if;

  -- If the unused stock is exhausted, start a new rotation cycle automatically.
  perform public.reset_used_in_pool_if_exhausted(p_per_category);

  select string_agg(c.category_key || ' tersedia ' || coalesce(a.available, 0)::text || ' soal aktif belum pernah masuk pool', '; ' order by c.sort_order)
    into v_missing
    from public.forge_daily_categories() c
    left join (
      select public.forge_question_category_key(category) as category_key, count(*) as available
        from public.questions
       where active = true
         and used_in_pool = false
         and public.forge_question_category_key(category) is not null
       group by public.forge_question_category_key(category)
    ) a on a.category_key = c.category_key
   where coalesce(a.available, 0) < p_per_category;

  if v_missing is not null then
    raise exception 'NOT_ENOUGH_ACTIVE_QUESTIONS: %', v_missing;
  end if;

  with picked as (
    select id, category_key
      from (
        select
          q.id,
          public.forge_question_category_key(q.category) as category_key,
          row_number() over (partition by public.forge_question_category_key(q.category) order by random()) as rn
        from public.questions q
        join public.forge_daily_categories() c
          on c.category_key = public.forge_question_category_key(q.category)
       where q.active = true
         and q.used_in_pool = false
      ) ranked
     where rn <= p_per_category
  ), inserted as (
    insert into public.daily_question_pool (pool_date, category_key, question_id)
    select p_pool_date, category_key, id
      from picked
    returning question_id
  )
  update public.questions q
     set used_in_pool = true,
         last_pooled_date = p_pool_date
    from inserted i
   where q.id = i.question_id;

  get diagnostics v_inserted = row_count;

  if v_inserted <> v_expected then
    raise exception 'DAILY_POOL_GENERATION_FAILED: expected %, inserted %', v_expected, v_inserted;
  end if;

  return v_inserted;
end;
$$;

create or replace function public.get_daily_duel_question_ids(
  p_pool_date date default (now() at time zone 'Asia/Makassar')::date,
  p_limit integer default 5
)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_question_ids text[];
  v_pool_count integer;
begin
  if p_pool_date is null then
    raise exception 'POOL_DATE_REQUIRED';
  end if;

  if p_limit <= 0 then
    raise exception 'QUESTION_LIMIT_MUST_BE_POSITIVE';
  end if;

  perform public.generate_daily_question_pool(p_pool_date, 5, false);

  select count(*) into v_pool_count
    from public.daily_question_pool
   where pool_date = p_pool_date;

  if v_pool_count < p_limit then
    raise exception 'QUESTION_POOL_NOT_READY: only % questions available', v_pool_count;
  end if;

  select array_agg(question_id order by picked_order)
    into v_question_ids
    from (
      select question_id,
             row_number() over (order by random()) as picked_order
        from public.daily_question_pool
       where pool_date = p_pool_date
       order by random()
       limit p_limit
    ) picked;

  if coalesce(array_length(v_question_ids, 1), 0) < p_limit then
    raise exception 'QUESTION_POOL_NOT_READY';
  end if;

  return v_question_ids;
end;
$$;

create or replace function public.match_duel_queue(
  p_user_id text,
  p_question_ids text[] default array[]::text[],
  p_day_start timestamptz default date_trunc('day', now()),
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
  v_pool_date date;
begin
  -- Asia/Makassar keeps FORGE's Sulut daily rotation aligned with local midnight.
  v_pool_date := coalesce((p_day_start at time zone 'Asia/Makassar')::date, (now() at time zone 'Asia/Makassar')::date);
  p_question_ids := public.get_daily_duel_question_ids(v_pool_date, 5);

  v_question_count := coalesce(array_length(p_question_ids, 1), 0);
  if v_question_count < 5 then
    raise exception 'QUESTION_POOL_NOT_READY';
  end if;

  perform pg_advisory_xact_lock(hashtext('forge_duel_queue_matchmaking'));

  select count(*) into v_user_today
    from public.duels
   where status <> 'cancelled'
     and started_at >= p_day_start
     and (user_id = p_user_id or opponent_id = p_user_id);

  if v_user_today >= p_daily_limit then
    raise exception 'LIMIT_REACHED';
  end if;

  update public.users set last_seen_at = now() where id = p_user_id;

  update public.duel_queue
     set status = 'cancelled', updated_at = now()
   where (status = 'waiting' and last_seen_at < now() - interval '15 seconds')
      or (status = 'matched' and updated_at < now() - interval '2 minutes');

  select q.duel_id into v_existing_duel_id
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
     set status = 'waiting', duel_id = null, last_seen_at = now(), updated_at = now()
   where public.duel_queue.status <> 'matched'
      or public.duel_queue.updated_at < now() - interval '2 minutes';

  select q.user_id into v_opponent_id
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

  insert into public.duels (id, user_id, opponent_id, opponent_name, status, started_at, starts_at)
  select v_duel_id, p_user_id, u.id, u.username, 'active', now(), now() + interval '5 seconds'
    from public.users u
   where u.id = v_opponent_id;

  insert into public.duel_questions (duel_id, question_id, position)
  select v_duel_id, question_id, position
    from unnest(p_question_ids) with ordinality as picked(question_id, position)
   where position <= 5;

  update public.duel_queue
     set status = 'matched', duel_id = v_duel_id, updated_at = now(), last_seen_at = now()
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
