create table if not exists public.chess_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists chess_profiles_username_lower_idx
  on public.chess_profiles (lower(username));

create table if not exists public.chess_rooms (
  id text primary key check (id ~ '^[0-9A-F]{8}$'),
  created_by uuid not null references auth.users (id) on delete cascade,
  white_player uuid not null references auth.users (id) on delete cascade,
  black_player uuid references auth.users (id) on delete set null,
  white_name text not null,
  black_name text,
  status text not null default 'waiting' check (status in ('waiting', 'playing', 'finished')),
  fen text not null default 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  turn text not null default 'w' check (turn in ('w', 'b')),
  moves jsonb not null default '[]'::jsonb check (jsonb_typeof(moves) = 'array'),
  version integer not null default 0 check (version >= 0),
  created_at timestamptz not null default now()
);

alter table public.chess_profiles enable row level security;
alter table public.chess_rooms enable row level security;

drop policy if exists chess_profiles_read_self on public.chess_profiles;
create policy chess_profiles_read_self
  on public.chess_profiles for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists chess_rooms_read_players on public.chess_rooms;
create policy chess_rooms_read_players
  on public.chess_rooms for select to authenticated
  using ((select auth.uid()) = white_player or (select auth.uid()) = black_player);

revoke all on public.chess_profiles from anon, authenticated;
grant select on public.chess_profiles to authenticated;
revoke all on public.chess_rooms from anon, authenticated;
grant select on public.chess_rooms to authenticated;

create or replace function public.create_chess_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text;
begin
  requested_username := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  if requested_username !~ '^[a-z0-9_]{3,20}$' then
    requested_username := 'guest_' || left(replace(new.id::text, '-', ''), 8);
  end if;

  insert into public.chess_profiles (id, username)
  values (new.id, requested_username);
  return new;
end;
$$;

drop trigger if exists create_chess_profile_after_signup on auth.users;
create trigger create_chess_profile_after_signup
  after insert on auth.users
  for each row execute function public.create_chess_profile();

revoke all on function public.create_chess_profile() from public, anon, authenticated;

create or replace function public.create_chess_room()
returns setof public.chess_rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
  player_name text;
  room public.chess_rooms;
  attempts integer := 0;
begin
  if player_id is null then
    raise exception 'Sign in before creating a room';
  end if;

  select username into player_name
  from public.chess_profiles
  where id = player_id;

  if player_name is null then
    raise exception 'Player profile is missing';
  end if;

  while attempts < 5 loop
    attempts := attempts + 1;
    begin
      insert into public.chess_rooms (id, created_by, white_player, white_name)
      values (
        upper(left(replace(gen_random_uuid()::text, '-', ''), 8)),
        player_id,
        player_id,
        player_name
      )
      returning * into room;
      return next room;
      return;
    exception when unique_violation then
      null;
    end;
  end loop;

  raise exception 'Could not allocate a room code; please try again';
end;
$$;

create or replace function public.join_chess_room(p_room_id text)
returns setof public.chess_rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
  player_name text;
  room public.chess_rooms;
begin
  if player_id is null then
    raise exception 'Sign in before joining a room';
  end if;

  select * into room
  from public.chess_rooms
  where id = upper(trim(p_room_id))
  for update;

  if not found then
    raise exception 'Room not found';
  end if;

  if room.white_player = player_id or room.black_player = player_id then
    return next room;
    return;
  end if;

  if room.status <> 'waiting' or room.black_player is not null then
    raise exception 'Room is already full';
  end if;

  select username into player_name
  from public.chess_profiles
  where id = player_id;

  update public.chess_rooms
  set black_player = player_id,
      black_name = coalesce(player_name, 'Guest'),
      status = 'playing'
  where id = room.id
  returning * into room;

  return next room;
end;
$$;

create or replace function public.make_chess_move(
  p_room_id text,
  p_expected_version integer,
  p_fen text,
  p_move jsonb
)
returns setof public.chess_rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
  room public.chess_rooms;
  next_turn text;
begin
  if player_id is null then
    raise exception 'Sign in before playing';
  end if;

  select * into room
  from public.chess_rooms
  where id = upper(trim(p_room_id))
  for update;

  if not found or room.status <> 'playing' then
    raise exception 'Room is not in a playable state';
  end if;

  if room.version <> p_expected_version then
    raise exception 'The board changed; syncing the latest position';
  end if;

  if (room.turn = 'w' and room.white_player <> player_id)
     or (room.turn = 'b' and room.black_player <> player_id) then
    raise exception 'It is not your turn';
  end if;

  if p_move is null
     or jsonb_typeof(p_move) <> 'object'
     or p_move ->> 'color' is distinct from room.turn
     or p_move ->> 'from' is null
     or p_move ->> 'to' is null
     or p_fen is null
     or array_length(string_to_array(trim(p_fen), ' '), 1) <> 6 then
    raise exception 'Invalid move payload';
  end if;

  next_turn := split_part(trim(p_fen), ' ', 2);
  if next_turn not in ('w', 'b') or next_turn = room.turn then
    raise exception 'Invalid next turn';
  end if;

  update public.chess_rooms
  set fen = trim(p_fen),
      turn = next_turn,
      moves = moves || jsonb_build_array(p_move),
      version = version + 1
  where id = room.id
  returning * into room;

  return next room;
end;
$$;

create or replace function public.leave_chess_room(p_room_id text)
returns setof public.chess_rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
  room public.chess_rooms;
begin
  update public.chess_rooms
  set status = 'finished'
  where id = upper(trim(p_room_id))
    and status in ('waiting', 'playing')
    and (white_player = player_id or black_player = player_id)
  returning * into room;

  if found then
    return next room;
  end if;
end;
$$;

revoke all on function public.create_chess_room() from public, anon;
revoke all on function public.join_chess_room(text) from public, anon;
revoke all on function public.make_chess_move(text, integer, text, jsonb) from public, anon;
revoke all on function public.leave_chess_room(text) from public, anon;
grant execute on function public.create_chess_room() to authenticated;
grant execute on function public.join_chess_room(text) to authenticated;
grant execute on function public.make_chess_move(text, integer, text, jsonb) to authenticated;
grant execute on function public.leave_chess_room(text) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chess_rooms'
  ) then
    alter publication supabase_realtime add table public.chess_rooms;
  end if;
end;
$$;
