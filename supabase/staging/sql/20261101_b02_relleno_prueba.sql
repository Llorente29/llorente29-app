-- ============================================================================
-- PRUEBA (staging) · B02 · T2 (0201): lo ya guardado, legible. Todo en una
-- transacción con ROLLBACK. Siembra (como el dueño) un extracto «csv:bbva» con
-- su texto del banco como lo guarda el lector y SIN contraparte ni tipo (como
-- lo subido antes de la 0200), pasa la 0201 DE VERDAD y comprueba el resultado,
-- que los de otros formatos no se tocan, y su vuelta atrás. Datos INVENTADOS.
-- sin usuario: la 0201 no la ejecuta nadie desde la app; la aplica el workflow
--   de producción con el rol de su conexión. Aquí, igual.
-- ============================================================================

\set ON_ERROR_STOP 1
begin;

create temp table _r (que text primary key, id uuid) on commit drop;
do $$
declare a constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
        merc constant uuid := 'b0100000-0000-4000-8000-0000000000b3'; s uuid; m uuid;
begin
  insert into public.bank_statement (account_id, company_id, treasury_account_id, source, format, file_name, file_sha256, period_from, period_to,
     movements_count, new_count, repeated_count, balanced, unchecked_reason, continuity)
  values (a, emp, merc, 'fichero', 'csv:bbva', 'prueba-relleno.xlsx', repeat('c', 64), date '2026-09-01', date '2026-09-02', 3, 3, 0, null, 'prueba', 'sin_saldo')
  returning id into s;
  insert into public.bank_movement (account_id, company_id, treasury_account_id, statement_id, op_date, value_date, amount, bank_concept, fingerprint, soft_fingerprint, status)
  values (a, emp, merc, s, date '2026-09-01', date '2026-09-01', -100, 'PAGO CON TARJETA · ************3085 RECARGAS INVENTADAS', 'b02-relleno-1', 'b02-relleno-s1', 'pendiente')
  returning id into m; insert into _r values ('tarjeta', m);
  insert into public.bank_movement (account_id, company_id, treasury_account_id, statement_id, op_date, value_date, amount, bank_concept, fingerprint, soft_fingerprint, status)
  values (a, emp, merc, s, date '2026-09-02', date '2026-09-02', 248.61, 'TRASPASO · EMPRESA INVENTADA FOOD S.L. · OTRO TEXTO', 'b02-relleno-2', 'b02-relleno-s2', 'pendiente')
  returning id into m; insert into _r values ('traspaso', m);
  insert into public.bank_movement (account_id, company_id, treasury_account_id, statement_id, op_date, value_date, amount, bank_concept, fingerprint, soft_fingerprint, status)
  values (a, emp, merc, s, date '2026-09-02', date '2026-09-02', -1, 'COMISIONES', 'b02-relleno-3', 'b02-relleno-s3', 'pendiente')
  returning id into m; insert into _r values ('solo', m);
  insert into _r select 'norma43', (select m2.id from public.bank_movement m2 join public.bank_statement s2 on s2.id = m2.statement_id where s2.format = 'norma43' and m2.movement_type is null limit 1);
end $$;

\ir ../../migrations/20261101T0201_b02_entrada_relleno.sql

do $$
declare m record;
begin
  select * into m from public.bank_movement where id = (select id from _r where que = 'tarjeta');
  if m.movement_type is distinct from 'PAGO CON TARJETA' or m.counterparty is distinct from 'Recargas Inventadas' then
    raise exception 'PRUEBA B02 · 0201: la tarjeta quedó «%» / «%».', m.movement_type, m.counterparty; end if;
  select * into m from public.bank_movement where id = (select id from _r where que = 'traspaso');
  if m.movement_type is distinct from 'TRASPASO' or m.counterparty is distinct from 'Empresa Inventada Food S.L.' then
    raise exception 'PRUEBA B02 · 0201: el traspaso quedó «%» / «%».', m.movement_type, m.counterparty; end if;
  select * into m from public.bank_movement where id = (select id from _r where que = 'solo');
  if m.movement_type is distinct from 'COMISIONES' or m.counterparty is not null then
    raise exception 'PRUEBA B02 · 0201: el que solo trae etiqueta quedó «%» / «%».', m.movement_type, m.counterparty; end if;
  if (select movement_type from public.bank_movement where id = (select id from _r where que = 'norma43')) is not null then
    raise exception 'PRUEBA B02 · 0201: tocó un movimiento de Norma 43.'; end if;
  raise notice '0201 · lo del Excel de BBVA, con tipo y contraparte; lo demás, sin tocar';
end $$;

\ir ../../vuelta-atras/20261101T0201_b02_entrada_relleno.down.sql
do $$
begin
  if exists (select 1 from public.bank_movement where id in (select id from _r where que in ('tarjeta', 'traspaso', 'solo')) and (movement_type is not null or counterparty is not null)) then
    raise exception 'PRUEBA B02 · 0201: la vuelta atrás no los vació.'; end if;
  raise notice '0201 · vuelta atrás: vacíos otra vez (y se vuelven a sacar igual)';
end $$;

rollback;
