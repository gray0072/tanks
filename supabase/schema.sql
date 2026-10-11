-- Cloud sync for player-made maps (SPEC §6.4, src/cloud/mapSync.ts).
-- Run in the Supabase SQL editor of the project in VITE_SUPABASE_URL; running it again is safe.
-- The project is shared with other apps (swedish, world-aviation), so every table carries its
-- app's prefix: this one is tanks_custom_maps.
--
-- One row per map. A deleted map stays as a tombstone row (deleted = true, empty
-- name/template) so the delete reaches the user's other devices instead of the map being
-- pulled back down. Times are the client's own epoch milliseconds: the merge compares an
-- edit time with a deletion time, both set by the device that made the change.

create table if not exists public.tanks_custom_maps (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null check (id like 'custom-%' and length(id) <= 64),
  name text not null check (length(name) <= 64),
  template text not null check (length(template) <= 65536),
  origin jsonb not null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted boolean not null default false,
  primary key (user_id, id)
);

alter table public.tanks_custom_maps enable row level security;

drop policy if exists "read own maps" on public.tanks_custom_maps;
create policy "read own maps" on public.tanks_custom_maps
  for select using (auth.uid() = user_id);

drop policy if exists "insert own maps" on public.tanks_custom_maps;
create policy "insert own maps" on public.tanks_custom_maps
  for insert with check (auth.uid() = user_id);

drop policy if exists "update own maps" on public.tanks_custom_maps;
create policy "update own maps" on public.tanks_custom_maps
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
