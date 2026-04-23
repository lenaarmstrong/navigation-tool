create table if not exists public.users (
  id text primary key,
  display_name text not null,
  display_name_normalized text not null unique,
  created_at timestamptz not null,
  last_seen_at timestamptz not null
);

create table if not exists public.previews (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  title text not null,
  annotations_json text not null,
  preview_png_path text not null,
  thumbnail_png_path text,
  drive_backup_status text not null default 'pending',
  drive_file_ids text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists idx_previews_user_id on public.previews(user_id);
create index if not exists idx_previews_created_at on public.previews(created_at desc);

