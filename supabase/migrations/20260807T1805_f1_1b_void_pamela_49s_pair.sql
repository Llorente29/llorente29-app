-- Aplicada: 2026-08-07 por MCP. F1.1b · Anula el par de doble fichaje de 49s de Pamela (14/06),
-- el único fronterizo que se había dejado fuera del saneado <30s. Reversible, con auditoría.
select set_config('app.clock_edit_reason',
  'Saneado F1.1b: doble fichaje glitch de 49s (Pamela 14/06) que parte jornada. Anulado el par salida+entrada. Reversible.', true);
select set_config('app.clock_edit_actor', 'Sistema — saneado F1.1b (2026-08-07)', true);
update clock_entries set voided = true
where id in ('b156b012-cda4-41b8-be15-589a7db33db2','b9b4512b-7025-4bfe-b0bc-bd10864badae')
  and not voided;
