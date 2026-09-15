-- ─────────────────────────────────────────────────────────
-- 0018: Owner-editable app settings (key/value). First use: which
-- emails go out. Defaults live in code; a row only exists once the
-- owner changes something.
-- ─────────────────────────────────────────────────────────

create table if not exists app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);
