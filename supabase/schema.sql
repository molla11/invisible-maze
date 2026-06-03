create extension if not exists pgcrypto;

create type public.player_slot as enum ('A', 'B');
create type public.game_status as enum ('waiting', 'coin', 'playing', 'finished');

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id) on delete set null,
  anonymous_token text unique,
  display_name text not null default 'Player',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.match_queue (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (profile_id)
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_id uuid not null references public.profiles(id) on delete cascade,
  guest_id uuid references public.profiles(id) on delete set null,
  game_id uuid,
  created_at timestamptz not null default now()
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references public.rooms(id) on delete set null,
  status public.game_status not null default 'playing',
  state jsonb not null,
  maze jsonb not null,
  current_turn public.player_slot not null,
  turn_started_at timestamptz not null default now(),
  turn_deadline_at timestamptz not null,
  winner public.player_slot,
  win_reason text,
  revealed_walls jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rooms
  add constraint rooms_game_id_fkey foreign key (game_id) references public.games(id) on delete set null;

create table public.game_players (
  game_id uuid not null references public.games(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  slot public.player_slot not null,
  position jsonb not null,
  goal jsonb not null,
  connected_at timestamptz not null default now(),
  missed_turns integer not null default 0,
  primary key (game_id, slot),
  unique (game_id, profile_id)
);

create table public.game_events (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  event_type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.match_queue enable row level security;
alter table public.rooms enable row level security;
alter table public.games enable row level security;
alter table public.game_players enable row level security;
alter table public.game_events enable row level security;

create index game_events_game_id_created_at_idx on public.game_events (game_id, created_at);
create index rooms_code_idx on public.rooms (code);
create index game_players_profile_id_idx on public.game_players (profile_id);

create or replace function public.dequeue_match(requesting_profile uuid)
returns table(opponent_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  waiting_profile uuid;
begin
  delete from public.match_queue where profile_id = requesting_profile;

  select profile_id
    into waiting_profile
    from public.match_queue
   where profile_id <> requesting_profile
   order by created_at asc
   limit 1
   for update skip locked;

  if waiting_profile is null then
    insert into public.match_queue (profile_id)
    values (requesting_profile)
    on conflict (profile_id) do update set created_at = now();
    return;
  end if;

  delete from public.match_queue where profile_id in (requesting_profile, waiting_profile);
  opponent_id := waiting_profile;
  return next;
end;
$$;
