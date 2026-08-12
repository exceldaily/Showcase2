-- ─────────────────────────────────────────────────────────
-- 0006: account vs research cohort split
-- The ACCOUNT simulates only what the bot actually recommends
-- (decision above Avoid, score >= 60), risk-normalized sizing.
-- RESEARCH keeps tracking every signal for evidence collection.
-- Historical rows are tagged by the decision recorded at signal
-- time; nothing is deleted or altered beyond the label.
-- ─────────────────────────────────────────────────────────

alter table paper_trades add column if not exists cohort text not null default 'research';

update paper_trades p
set cohort = 'account'
from trade_setups ts
where ts.id = p.setup_id
  and ts.decision <> 'Avoid'
  and coalesce(p.score, 0) >= 60;

create index if not exists idx_paper_cohort on paper_trades(cohort, status);
