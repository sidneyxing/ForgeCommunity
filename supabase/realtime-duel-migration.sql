alter table public.questions add column if not exists question_type text not null default 'text';
alter table public.questions add column if not exists image_url text;

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

alter table public.duels add column if not exists opponent_fp_awarded integer not null default 0;
alter table public.duels add column if not exists settled_at timestamptz;

alter table public.duel_requests
  add column if not exists expires_at timestamptz not null default (now() + interval '10 seconds');

alter table public.duel_requests
  add column if not exists duel_id text references public.duels(id) on delete set null;

create index if not exists idx_duel_requests_expiry
  on public.duel_requests (status, expires_at);

create index if not exists idx_duels_opponent_started
  on public.duels (opponent_id, started_at desc);

update public.duel_requests
set expires_at = coalesce(expires_at, created_at + interval '10 seconds')
where expires_at is null;
