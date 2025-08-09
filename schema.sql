create table if not exists users (
  id bigserial primary key,
  discord_id text unique not null,
  created_at timestamptz default now()
);

create table if not exists competitions (
  id bigserial primary key,
  week_number int not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  scoring_mode text default 'yolo',
  unique (week_number)
);

create table if not exists entries (
  id bigserial primary key,
  competition_id bigint references competitions(id) on delete cascade,
  user_id bigint references users(id) on delete cascade,
  joined_at timestamptz default now(),
  unique (competition_id, user_id)
);

create table if not exists trades (
  id bigserial primary key,
  entry_id bigint references entries(id) on delete cascade,
  ticker text not null,
  side text default 'long',
  entry_price numeric,
  entry_time timestamptz,
  exit_price numeric,
  exit_time timestamptz,
  pnl_pct numeric,
  comment text,
  status text default 'open'
);