create extension if not exists "pgcrypto";

create type shift_status as enum ('planned', 'active', 'closed');
create type team_member_role as enum ('admin', 'shift_lead', 'sales');
create type sales_location as enum ('truck', 'tent');
create type payment_method as enum ('cash', 'card', 'other');
create type inventory_movement_type as enum ('inbound', 'outbound', 'adjustment');

create table shifts (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  status shift_status not null default 'planned',
  location_name text,
  notes text,
  created_at timestamptz not null default now()
);

create table team_members (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  role team_member_role not null default 'sales',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table shift_assignments (
  shift_id uuid not null references shifts(id) on delete cascade,
  team_member_id uuid not null references team_members(id) on delete restrict,
  primary key (shift_id, team_member_id)
);

create table sales (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references shifts(id) on delete cascade,
  sales_location sales_location not null,
  amount_cents integer not null check (amount_cents >= 0),
  payment_method payment_method not null default 'cash',
  created_at timestamptz not null default now()
);

create table soft_serve_counters (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references shifts(id) on delete cascade,
  sales_location sales_location not null,
  count integer not null default 0 check (count >= 0),
  updated_at timestamptz not null default now(),
  unique (shift_id, sales_location)
);

create table inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table inventory_movements (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid references shifts(id) on delete set null,
  item_id uuid not null references inventory_items(id) on delete restrict,
  movement_type inventory_movement_type not null,
  quantity numeric(12, 3) not null,
  created_at timestamptz not null default now()
);

create table day_closes (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null unique references shifts(id) on delete cascade,
  closed_at timestamptz not null default now(),
  total_sales_cents integer not null default 0,
  soft_serve_total integer not null default 0,
  export_ready boolean not null default false
);
