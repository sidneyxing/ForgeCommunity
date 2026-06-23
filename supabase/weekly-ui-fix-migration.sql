create table if not exists public.system_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.daily_question_pool (
  pool_date date not null,
  question_id text not null references public.questions(id) on delete cascade,
  position integer not null,
  created_at timestamptz not null default now(),
  primary key (pool_date, question_id),
  constraint daily_question_pool_position_positive check (position > 0)
);

create index if not exists idx_daily_question_pool_date_position
  on public.daily_question_pool (pool_date, position);

alter table public.users add column if not exists city text not null default '';
alter table public.users add column if not exists gender text not null default '';
alter table public.user_settings add column if not exists music_enabled boolean not null default true;
alter table public.user_settings add column if not exists sfx_enabled boolean not null default true;

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

alter table public.system_settings enable row level security;
alter table public.daily_question_pool enable row level security;
