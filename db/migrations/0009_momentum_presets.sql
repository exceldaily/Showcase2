-- ─────────────────────────────────────────────────────────

-- slug must be unique for upserts to work
create unique index if not exists idx_scanner_presets_slug on scanner_presets(slug);
-- 0009: momentum presets + filter fixes
--
-- Live audit (Aug 2026) found: coiled-breakout matched 80/303 (not a
-- filter), low-float-under-5 evaluated 0 symbols (universe too
-- narrow), and the Setup Score sort had no column to sort on. This
-- migration adds the classic 5-point small-cap momentum criteria as
-- a preset with PREFERRED (soft) float/catalyst rules, tightens the
-- coil scanner, and realigns universes.
-- ─────────────────────────────────────────────────────────

-- 5-Point Momentum: the widely-taught demand/supply checklist.
-- Hard: price band, % gain, RVOL. Preferred: low float, catalyst.
insert into scanner_presets (slug, name, description, universe_slug, rules, columns, sort_field, sort_dir, is_enabled)
values (
  'five-point-momentum',
  '5-Point Momentum',
  'Up 10%+ today, 5x relative volume, $2–$20. Preferred: float under 20M and a news catalyst. Demand-plus-supply checklist for small-cap momentum.',
  'small-cap-momentum',
  '{"logic":"AND","conditions":[
     {"field":"price","op":"between","value":2,"value2":20},
     {"field":"changePct","op":"gte","value":10},
     {"field":"rvol","op":"gte","value":5},
     {"field":"floatShares","op":"lt","value":20000000,"soft":true},
     {"field":"catalystStatus","op":"eq","value":"Found","soft":true}
   ]}'::jsonb,
  '["symbol","price","changePct","rvol","volume","floatShares","catalystStatus","criteria","setupScore"]'::jsonb,
  'rvol', 'desc', true
)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  universe_slug = excluded.universe_slug,
  rules = excluded.rules,
  columns = excluded.columns,
  sort_field = excluded.sort_field,
  sort_dir = excluded.sort_dir,
  is_enabled = true;

-- A relaxed sibling for the current EOD universe so the checklist is
-- usable today: same shape, lower thresholds, flagged as such.
insert into scanner_presets (slug, name, description, universe_slug, rules, columns, sort_field, sort_dir, is_enabled)
values (
  'momentum-watch',
  'Momentum Watch (relaxed)',
  'Same checklist, looser gates for end-of-day data: up 4%+, 2x RVOL, $2–$50. Use to build a watchlist, then confirm on the strict 5-Point scanner.',
  'all-stocks',
  '{"logic":"AND","conditions":[
     {"field":"price","op":"between","value":2,"value2":50},
     {"field":"changePct","op":"gte","value":4},
     {"field":"rvol","op":"gte","value":2},
     {"field":"floatShares","op":"lt","value":20000000,"soft":true},
     {"field":"catalystStatus","op":"eq","value":"Found","soft":true}
   ]}'::jsonb,
  '["symbol","price","changePct","rvol","volume","vwapDistancePct","criteria","setupScore"]'::jsonb,
  'changePct', 'desc', true
)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  universe_slug = excluded.universe_slug,
  rules = excluded.rules,
  columns = excluded.columns,
  sort_field = excluded.sort_field,
  sort_dir = excluded.sort_dir,
  is_enabled = true;

-- Tighten the coil scanner: 80/303 matches was noise. Require a real
-- coil (<=6%), above-VWAP but NOT extended, and normal-or-better volume.
update scanner_presets set
  description = 'EMA 9>20>50 stacked, tight 8-day coil (under 6%), above VWAP but not extended. Pre-breakout compression.',
  rules = '{"logic":"AND","conditions":[
     {"field":"emaState","op":"eq","value":"9>20>50"},
     {"field":"coilPct","op":"lte","value":6},
     {"field":"vwapDistancePct","op":"between","value":0,"value2":8},
     {"field":"rvol","op":"gte","value":0.9}
   ]}'::jsonb,
  columns = '["symbol","price","changePct","coilPct","rvol","vwapDistancePct","setupScore","sector"]'::jsonb,
  sort_field = 'setupScore'
where slug = 'coiled-breakout';

-- Low Float Under $5 had a universe with zero members; widen to the
-- low-price band and make float PREFERRED until float data exists.
update scanner_presets set
  rules = '{"logic":"AND","conditions":[
     {"field":"price","op":"between","value":0.5,"value2":5},
     {"field":"changePct","op":"gte","value":10},
     {"field":"rvol","op":"gte","value":2},
     {"field":"floatShares","op":"lt","value":50000000,"soft":true}
   ]}'::jsonb,
  columns = '["symbol","price","changePct","rvol","volume","floatShares","criteria","setupScore"]'::jsonb
where slug = 'low-float-under-5';

-- Give the scanners that need intraday data a clear, honest description.
update scanner_presets set description = 'Needs intraday bars: gap vs prior close with premarket volume. Activates on the Starter data plan.' where slug = 'premarket-gappers';
update scanner_presets set description = 'Needs intraday bars: price within 1% of the session high on 2x volume. Activates on the Starter data plan.' where slug = 'hod-break';
update scanner_presets set description = 'Needs intraday bars: 1-minute volume running 3x its normal pace. Activates on the Starter data plan.' where slug = 'volume-surge';
update scanner_presets set description = 'Fires only on the session price crosses back above anchored VWAP — rare by design, so an empty list is normal.' where slug = 'vwap-reclaim';
