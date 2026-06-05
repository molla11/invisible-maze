alter table public.games
  add column if not exists state jsonb;

create table if not exists public.presence_connections (
  id text primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.presence_connections enable row level security;

create index if not exists presence_connections_profile_id_idx on public.presence_connections (profile_id);
create index if not exists presence_connections_updated_at_idx on public.presence_connections (updated_at);

create or replace function public.stats_snapshot(p_active_since timestamptz)
returns table(online integer, waiting_in_queue integer, active_games integer)
language sql
security definer
set search_path = public
as $$
  delete from public.presence_connections
   where updated_at < p_active_since;

  with online_profiles as (
    select distinct profile_id
      from public.presence_connections
     where updated_at >= p_active_since
  ),
  queued_profiles as (
    select count(*)::integer as count
      from public.match_queue queue
     where exists (
       select 1
         from online_profiles online
        where online.profile_id = queue.profile_id
     )
  ),
  active_game_rows as (
    select count(distinct game.id)::integer as count
      from public.games game
      join public.game_players player on player.game_id = game.id
     where game.status <> 'finished'
       and exists (
         select 1
           from online_profiles online
          where online.profile_id = player.profile_id
       )
  )
  select
    (select count(*)::integer from online_profiles) as online,
    (select count from queued_profiles) as waiting_in_queue,
    (select count from active_game_rows) as active_games;
$$;

create or replace function public.dequeue_match(requesting_profile uuid)
returns table(opponent_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  waiting_profile uuid;
begin
  delete from public.match_queue queue
  where not exists (
    select 1
      from public.presence_connections connection
     where connection.profile_id = queue.profile_id
       and connection.updated_at >= now() - interval '25 seconds'
  );

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
