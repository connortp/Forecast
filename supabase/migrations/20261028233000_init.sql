-- Forecast: first schema.
--
-- Every table is keyed by user and protected by RLS. Clients (web, iOS) use the
-- publishable key and only ever see their own rows. Plaid access tokens and sync
-- cursors live in plaid_item_secrets, which has RLS on and no policies at all, so
-- only the service role (edge functions) can read it.
--
-- Money is numeric(14,2). Transaction amounts follow Plaid's sign: positive is money
-- leaving the account, negative is money coming in.

-- ---------------------------------------------------------------------------
-- Helpers

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles and settings (one row each per user, created on sign-up)

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  cushion numeric(14,2) not null default 150 check (cushion >= 0),
  personality text not null default 'calm' check (personality in ('calm', 'spicy')),
  timezone text not null default 'America/New_York',
  -- Payday overrides, for when Plaid's income stream is wrong or missing.
  pay_amount_override numeric(14,2) check (pay_amount_override > 0),
  next_payday_override date,
  pay_every_days_override int check (pay_every_days_override between 1 and 62),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'name')
  on conflict (id) do nothing;
  insert into public.settings (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Plaid items (one per linked institution)

create table public.plaid_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plaid_item_id text not null unique,
  institution_id text,
  institution_name text,
  -- healthy | login_required | pending_expiration | revoked | error
  status text not null default 'healthy',
  error_code text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index plaid_items_user_id_idx on public.plaid_items (user_id);

-- Service role only: no RLS policies on purpose.
create table public.plaid_item_secrets (
  item_id uuid primary key references public.plaid_items (id) on delete cascade,
  access_token text not null,
  transactions_cursor text,
  updated_at timestamptz not null default now()
);

revoke all on public.plaid_item_secrets from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Accounts

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid references public.plaid_items (id) on delete cascade,
  plaid_account_id text unique,
  name text not null,
  official_name text,
  mask text,
  type text not null,      -- depository | credit | loan | investment | other
  subtype text,            -- checking | savings | credit card | ...
  current_balance numeric(14,2),
  available_balance numeric(14,2),
  credit_limit numeric(14,2),
  iso_currency_code text default 'USD',
  -- Counts toward "cash this morning". Defaults to true for checking accounts.
  include_in_cash boolean not null default false,
  balances_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index accounts_user_id_idx on public.accounts (user_id);
create index accounts_item_id_idx on public.accounts (item_id);

-- ---------------------------------------------------------------------------
-- Imported history (Monarch, Copilot, CSV/Excel). One row per upload.

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null check (source in ('monarch', 'copilot', 'mint', 'ynab', 'csv', 'manual')),
  file_name text,
  row_count int not null default 0,
  first_date date,
  last_date date,
  created_at timestamptz not null default now()
);

create index imports_user_id_idx on public.imports (user_id);

-- ---------------------------------------------------------------------------
-- Transactions (from Plaid sync or from an import)

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null default 'plaid'
    check (source in ('plaid', 'monarch', 'copilot', 'mint', 'ynab', 'csv', 'manual')),
  -- Plaid's transaction_id, or the importer's stable hash
  -- (account + date + amount + description + occurrence) so re-uploads are idempotent.
  source_txn_id text not null,
  account_id uuid references public.accounts (id) on delete cascade,
  import_id uuid references public.imports (id) on delete cascade,
  -- Account as written in an import file, when it doesn't map to a linked account.
  account_label text,
  account_mask text,
  amount numeric(14,2) not null,
  iso_currency_code text default 'USD',
  date date not null,
  authorized_date date,
  name text not null,
  merchant_name text,
  category_primary text,
  category_detailed text,
  pending boolean not null default false,
  payment_channel text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transactions_plaid_has_account check (source <> 'plaid' or account_id is not null),
  unique (user_id, source, source_txn_id)
);

create index transactions_user_date_idx on public.transactions (user_id, date desc);
create index transactions_account_id_idx on public.transactions (account_id);
create index transactions_import_id_idx on public.transactions (import_id);

-- ---------------------------------------------------------------------------
-- Recurring streams: bills (outflow) and paychecks (inflow)

create table public.recurring_streams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid references public.plaid_items (id) on delete cascade,
  account_id uuid references public.accounts (id) on delete set null,
  plaid_stream_id text unique,
  direction text not null check (direction in ('inflow', 'outflow')),
  description text not null,
  merchant_name text,
  category_primary text,
  -- WEEKLY | BIWEEKLY | SEMI_MONTHLY | MONTHLY | ANNUALLY | UNKNOWN
  frequency text not null default 'UNKNOWN',
  average_amount numeric(14,2),
  last_amount numeric(14,2),
  first_date date,
  last_date date,
  predicted_next_date date,
  -- MATURE | EARLY_DETECTION | TOMBSTONED | UNKNOWN
  plaid_status text,
  is_active boolean not null default true,
  -- What the user says (only these three are client-writable).
  user_name text,
  user_confirmed boolean not null default false,
  ignored boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index recurring_streams_user_id_idx on public.recurring_streams (user_id);
create index recurring_streams_item_id_idx on public.recurring_streams (item_id);
create index recurring_streams_account_id_idx on public.recurring_streams (account_id);

-- ---------------------------------------------------------------------------
-- Savings buckets

create table public.buckets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  goal numeric(14,2) not null default 0 check (goal >= 0),
  saved numeric(14,2) not null default 0 check (saved >= 0),
  per_paycheck numeric(14,2) not null default 0 check (per_paycheck >= 0),
  sort int not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index buckets_user_id_idx on public.buckets (user_id);

-- ---------------------------------------------------------------------------
-- Daily snapshots: the engine's answer for a day, cached

create table public.daily_snapshots (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  safe_to_spend numeric(14,2) not null,
  daily numeric(14,2) not null,
  pool numeric(14,2) not null,
  condition text not null check (condition in ('sunny', 'partly', 'cloudy', 'rain', 'storm')),
  computed_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- ---------------------------------------------------------------------------
-- updated_at triggers

create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger settings_updated_at before update on public.settings for each row execute function public.set_updated_at();
create trigger plaid_items_updated_at before update on public.plaid_items for each row execute function public.set_updated_at();
create trigger plaid_item_secrets_updated_at before update on public.plaid_item_secrets for each row execute function public.set_updated_at();
create trigger accounts_updated_at before update on public.accounts for each row execute function public.set_updated_at();
create trigger transactions_updated_at before update on public.transactions for each row execute function public.set_updated_at();
create trigger recurring_streams_updated_at before update on public.recurring_streams for each row execute function public.set_updated_at();
create trigger buckets_updated_at before update on public.buckets for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security

alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.plaid_items enable row level security;
alter table public.plaid_item_secrets enable row level security;
alter table public.accounts enable row level security;
alter table public.imports enable row level security;
alter table public.transactions enable row level security;
alter table public.recurring_streams enable row level security;
alter table public.buckets enable row level security;
alter table public.daily_snapshots enable row level security;

-- Profiles: read and update your own.
create policy "profiles: read own" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "profiles: update own" on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- Settings: read and update your own (the row is created on sign-up).
create policy "settings: read own" on public.settings
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "settings: update own" on public.settings
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Plaid items: read only (so the app can list linked banks). Writes go through edge functions.
create policy "plaid_items: read own" on public.plaid_items
  for select to authenticated using ((select auth.uid()) = user_id);

-- Accounts: read, and flip include_in_cash.
create policy "accounts: read own" on public.accounts
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "accounts: update own" on public.accounts
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke update on public.accounts from authenticated;
grant update (include_in_cash) on public.accounts to authenticated;

-- Imports: the client creates and deletes its own uploads (deleting removes their rows).
create policy "imports: read own" on public.imports
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "imports: insert own" on public.imports
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "imports: delete own" on public.imports
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Transactions: read your own; imported (non-Plaid) rows can also be written by the client.
create policy "transactions: read own" on public.transactions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "transactions: insert imported" on public.transactions
  for insert to authenticated
  with check ((select auth.uid()) = user_id and source <> 'plaid');
create policy "transactions: update imported" on public.transactions
  for update to authenticated
  using ((select auth.uid()) = user_id and source <> 'plaid')
  with check ((select auth.uid()) = user_id and source <> 'plaid');
create policy "transactions: delete imported" on public.transactions
  for delete to authenticated using ((select auth.uid()) = user_id and source <> 'plaid');

-- Recurring streams: read, and edit the user's own labels.
create policy "recurring_streams: read own" on public.recurring_streams
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "recurring_streams: update own" on public.recurring_streams
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke update on public.recurring_streams from authenticated;
grant update (user_name, user_confirmed, ignored) on public.recurring_streams to authenticated;

-- Buckets: full control of your own.
create policy "buckets: read own" on public.buckets
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "buckets: insert own" on public.buckets
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "buckets: update own" on public.buckets
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "buckets: delete own" on public.buckets
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Daily snapshots: read only.
create policy "daily_snapshots: read own" on public.daily_snapshots
  for select to authenticated using ((select auth.uid()) = user_id);

-- Nothing here is for signed-out visitors.
revoke all on all tables in schema public from anon;
