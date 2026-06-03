alter table public.games
  add column if not exists state jsonb;

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
