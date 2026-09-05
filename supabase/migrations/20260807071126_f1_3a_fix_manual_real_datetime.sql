-- Corrige real_datetime corrompido en fichajes manuales: se había grabado el momento de
-- creación (created_at) en vez de la hora del turno. La verdad está en datetime -> real_datetime := datetime.
-- No cambia el cómputo actual (lee datetime); deja real_datetime fiable para poder invertir el redondeo.
select set_config('app.clock_edit_reason',
  'Saneado F1.3a: real_datetime de fichaje manual estaba puesto al momento de creación (bug), no a la hora del turno. Corregido real_datetime := datetime (la hora tecleada = verdad legal). Reversible.', true);
select set_config('app.clock_edit_actor', 'Sistema — saneado F1.3a (2026-08-07)', true);

update clock_entries
set real_datetime = datetime
where source='manual' and not voided and real_datetime <> datetime;