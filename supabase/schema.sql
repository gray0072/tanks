-- Cloud sync for player-made maps (SPEC §6.4, src/cloud/mapSync.ts).
-- Run once in the Supabase SQL editor of this project.
--
-- One row per map. A deleted map stays as a tombstone row (deleted = true, empty
-- name/template) so the delete reaches the user's other devices instead of the map being
-- pulled back down. Times are the client's own epoch milliseconds: the merge compares an
-- edit time with a deletion time, both set by the device that made the change.

create table if not exists public.custom_maps (
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

alter table public.custom_maps enable row level security;

create policy "read own maps" on public.custom_maps
  for select using (auth.uid() = user_id);

create policy "insert own maps" on public.custom_maps
  for insert with check (auth.uid() = user_id);

create policy "update own maps" on public.custom_maps
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
