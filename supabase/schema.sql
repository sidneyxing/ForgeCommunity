create table if not exists public.users (
  id text primary key,
  given_id text not null unique,
  name text not null,
  username text not null unique,
  phone text unique,
  city text not null default '',
  gender text not null default '',
  password_hash text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  is_admin boolean not null default false,
  lifetime_fp integer not null default 0,
  weekly_fp integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  draws integer not null default 0,
  total_correct integer not null default 0,
  total_answer_time_ms integer not null default 0,
  total_answers integer not null default 0,
  current_win_streak integer not null default 0,
  fire_streak_days integer not null default 0,
  last_fire_date date,
  first_duel_at timestamptz,
  profile_color text not null default '#d4af37',
  constraint users_username_format check (username ~ '^[a-z0-9_]{3,24}$'),
  constraint users_gender_format check (gender in ('', 'male', 'female')),
  constraint users_profile_color_format check (profile_color ~ '^#[0-9a-fA-F]{6}$')
);

create table if not exists public.sessions (
  token_hash text primary key,
  user_id text not null references public.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  user_agent text,
  ip_hint text
);

create table if not exists public.user_settings (
  user_id text primary key references public.users(id) on delete cascade,
  sound_enabled boolean not null default true,
  music_enabled boolean not null default true,
  sfx_enabled boolean not null default true,
  show_online_status boolean not null default true,
  allow_duel_invites boolean not null default true,
  notifications_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.system_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.relationships (
  owner_id text not null references public.users(id) on delete cascade,
  target_id text not null references public.users(id) on delete cascade,
  is_friend boolean not null default false,
  is_favourite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, target_id),
  constraint relationships_not_self check (owner_id <> target_id)
);

create table if not exists public.questions (
  id text primary key,
  category text not null,
  subcategory text,
  question text not null,
  option_a text not null,
  option_b text not null,
  option_c text not null,
  option_d text not null,
  correct_option text not null check (correct_option in ('A', 'B', 'C', 'D')),
  explanation text,
  difficulty text not null default 'easy',
  question_type text not null default 'text' check (question_type in ('text', 'image')),
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.daily_question_pool (
  pool_date date not null,
  question_id text not null references public.questions(id) on delete cascade,
  position integer not null,
  created_at timestamptz not null default now(),
  primary key (pool_date, question_id),
  constraint daily_question_pool_position_positive check (position > 0)
);

create table if not exists public.duels (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  opponent_id text references public.users(id) on delete set null,
  opponent_name text not null,
  status text not null default 'active' check (status in ('active', 'finished', 'cancelled')),
  result text check (result in ('win', 'lose', 'draw')),
  user_score integer not null default 0,
  opponent_score integer not null default 0,
  user_avg_time_ms integer not null default 0,
  opponent_avg_time_ms integer not null default 0,
  fp_awarded integer not null default 0,
  opponent_fp_awarded integer not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  settled_at timestamptz
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
  created_at timestamptz not null default now(),
  primary key (duel_id, question_id, user_id)
);

create table if not exists public.badges (
  id text primary key,
  name text not null,
  description text not null,
  unlock_rule text not null,
  tier text not null default 'bronze',
  icon text not null default 'shield',
  sort_order integer not null default 0
);

create table if not exists public.user_badges (
  user_id text not null references public.users(id) on delete cascade,
  badge_id text not null references public.badges(id) on delete cascade,
  earned_at timestamptz not null default now(),
  primary key (user_id, badge_id)
);

create table if not exists public.weekly_rank_snapshots (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  week_key text not null,
  rank integer not null,
  weekly_fp integer not null,
  prize_label text,
  created_at timestamptz not null default now()
);

create table if not exists public.duel_requests (
  id text primary key,
  requester_id text not null references public.users(id) on delete cascade,
  target_id text not null references public.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 seconds'),
  responded_at timestamptz,
  duel_id text references public.duels(id) on delete set null,
  constraint duel_requests_not_self check (requester_id <> target_id)
);

create index if not exists idx_users_weekly on public.users (weekly_fp desc, lifetime_fp desc);
create index if not exists idx_users_seen on public.users (last_seen_at);
create index if not exists idx_users_lower_username on public.users (lower(username));
create index if not exists idx_questions_active on public.questions (active, category);
create index if not exists idx_daily_question_pool_date_position on public.daily_question_pool (pool_date, position);
create index if not exists idx_duels_user_started on public.duels (user_id, started_at desc);
create index if not exists idx_weekly_rank_snapshots_user_rank on public.weekly_rank_snapshots (user_id, rank);
create index if not exists idx_weekly_rank_snapshots_week_rank on public.weekly_rank_snapshots (week_key, rank);
create index if not exists idx_duel_requests_target on public.duel_requests (target_id, status, created_at desc);
create index if not exists idx_duel_requests_requester on public.duel_requests (requester_id, target_id, status);
create index if not exists idx_duel_requests_expiry on public.duel_requests (status, expires_at);
create index if not exists idx_duels_opponent_started on public.duels (opponent_id, started_at desc);

alter table public.users add column if not exists city text not null default '';
alter table public.users add column if not exists gender text not null default '';
alter table public.user_settings add column if not exists music_enabled boolean not null default true;
alter table public.user_settings add column if not exists sfx_enabled boolean not null default true;
alter table public.questions add column if not exists question_type text not null default 'text';
alter table public.questions add column if not exists image_url text;
alter table public.duels add column if not exists opponent_fp_awarded integer not null default 0;
alter table public.duels add column if not exists settled_at timestamptz;
alter table public.duel_requests add column if not exists expires_at timestamptz not null default (now() + interval '10 seconds');
alter table public.duel_requests add column if not exists duel_id text references public.duels(id) on delete set null;

-- Legacy table from the previous question rotation system.
-- After the updated code is deployed and working, you may remove it manually:
-- drop table if exists public.question_daily_usage cascade;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_gender_format'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users add constraint users_gender_format check (gender in ('', 'male', 'female'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'questions_question_type_format'
      and conrelid = 'public.questions'::regclass
  ) then
    alter table public.questions
      add constraint questions_question_type_format check (question_type in ('text', 'image'));
  end if;
end $$;

alter table public.users enable row level security;
alter table public.sessions enable row level security;
alter table public.user_settings enable row level security;
alter table public.system_settings enable row level security;
alter table public.relationships enable row level security;
alter table public.questions enable row level security;
alter table public.daily_question_pool enable row level security;
alter table public.duels enable row level security;
alter table public.duel_questions enable row level security;
alter table public.duel_answers enable row level security;
alter table public.badges enable row level security;
alter table public.user_badges enable row level security;
alter table public.weekly_rank_snapshots enable row level security;
alter table public.duel_requests enable row level security;
