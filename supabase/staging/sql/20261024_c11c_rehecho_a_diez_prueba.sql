-- supabase/staging/sql/20261024_c11c_rehecho_a_diez_prueba.sql
--
-- SOLO STAGING. Prueba de 20261024T0732_c11c_numero_vez (public.conta_diez_numero_vez),
-- con \i dentro de la transacción y ROLLBACK: staging no cambia. El caso del
-- 1821/1896 de producción, en la empresa de la cuenta A de pruebas, con
-- números inventados:
--
--   1. Un asiento validado y ENVIADO a Diez (2026/1/9001, «UBR-PRB-20261010»).
--      Su vez es 1: el número de siempre.
--   2. Se ANULA (journal_entry_anular, como Julio en el libro: el contraasiento
--      queda validado) y se REHACE y VALIDA otro del mismo día.
--   3. La vez del rehecho es 2 («UBR-PRB-20261010-2»), y su envío, con su
--      propio documento de Diez, cabe junto al del anulado en
--      external_send_ext_uq. Lo que hacía el envío de antes (enlazar el
--      documento del anulado) choca con la misma clave: el error de producción.
--   4. Se anula también el rehecho y se rehace otra vez: vez 3.
--   5. Otro número o un número raro: vez 1, y un número con caracteres de
--      expresión regular, parado.
--   6. Un usuario no puede llamarla; la vuelta atrás la quita.
--
-- El envío a Diez (TypeScript: numerar con la vez y no enlazar un documento que
-- ya es de otro asiento) lo prueba tests/conta/diez/rehecho.test.ts con un Diez
-- de mentira que tiene lo de producción (1820, 1895 y el rehecho).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA C11c: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

\i supabase/migrations/20261024T0732_c11c_numero_vez.sql

-- Un asiento manual de A, propuesto y validado como lo hace una persona.
create or replace function pg_temp.asiento(p_concepto text) returns uuid language plpgsql as $$
declare
  v_loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_e   constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  r jsonb; v uuid;
begin
  r := public.journal_entry_proponer(v_e,
    jsonb_build_object('series', 1, 'fecha', '2026-10-10', 'concepto', p_concepto, 'source_type', 'manual',
                       'confianza', 'seguro', 'porque', 'Prueba C11c'),
    jsonb_build_array(
      jsonb_build_object('cuenta', '62900000', 'debe', 10, 'haber', 0, 'local_id', v_loc, 'comun', false),
      jsonb_build_object('cuenta', '40000000', 'debe', 0, 'haber', 10, 'local_id', v_loc, 'comun', false)),
    null, 'Prueba C11c');
  v := (r->>'id')::uuid;
  perform public.journal_entry_validar(v, 'Prueba C11c');
  return v;
end $$;
grant execute on function pg_temp.asiento(text) to authenticated;

-- Lo que el envío deja en external_send (con la clave de servicio).
create or replace function pg_temp.enviado(p_entry uuid, p_doc int, p_numero text) returns void language sql as $$
  insert into public.external_send (entry_id, account_id, company_id, kind, ext_year, ext_series, ext_number, ext_invoice_number, payload_hash, status, attempts, sent_at)
  select e.id, e.account_id, e.company_id, 'factura', '2026', '1', p_doc, p_numero, 'prueba-c11c', 'enviado', 1, now()
    from public.journal_entry e where e.id = p_entry
$$;

do $$
declare v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
begin
  if public.conta_mes_cerrado(v_e, '2026-10-10') then
    raise exception 'PRUEBA C11c: octubre de 2026 está cerrado en A: esta prueba ya no puede validar.';
  end if;
end $$;

select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select set_config('prueba.a', pg_temp.asiento('Prueba C11c · el primero (se anulará)')::text, true);
reset role;

-- 1 · Enviado; su vez, 1.
do $$
declare v_a uuid := current_setting('prueba.a')::uuid;
begin
  perform pg_temp.enviado(v_a, 9001, 'UBR-PRB-20261010');
  if public.conta_diez_numero_vez(v_a, 'UBR-PRB-20261010') <> 1 then
    raise exception 'PRUEBA C11c · 1: el primero no va con el número de siempre.';
  end if;
end $$;

-- 2 · Se anula y se rehace (validado).
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.journal_entry_anular(current_setting('prueba.a')::uuid, 'Prueba C11c: se rehace', '2026-10-24', 'Prueba C11c');
  perform set_config('prueba.contra', r->>'contraasiento', true);
end $$;
select set_config('prueba.b', pg_temp.asiento('Prueba C11c · el rehecho')::text, true);
reset role;

-- 3 · La vez del rehecho, 2; su envío cabe; el de antes chocaba.
do $$
declare v_a uuid := current_setting('prueba.a')::uuid; v_b uuid := current_setting('prueba.b')::uuid;
begin
  if (select status from public.journal_entry where id = v_a) <> 'anulado'
     or (select status from public.journal_entry where id = v_b) <> 'validado' then
    raise exception 'PRUEBA C11c · 2: el anulado o el rehecho no están como tocaba.';
  end if;
  -- El contraasiento del anulado, enviado con «-ANUL» (lo que hace el envío al anular).
  perform pg_temp.enviado(current_setting('prueba.contra')::uuid, 9002, 'UBR-PRB-20261010-ANUL');
  if public.conta_diez_numero_vez(v_b, 'UBR-PRB-20261010') <> 2 then
    raise exception 'PRUEBA C11c · 3: el rehecho no va con la vez 2 (da %).', public.conta_diez_numero_vez(v_b, 'UBR-PRB-20261010');
  end if;
  -- Lo que hacía el envío de antes: enlazar el documento del anulado. Choca, como en producción.
  begin
    perform pg_temp.enviado(v_b, 9001, 'UBR-PRB-20261010');
    raise exception 'PRUEBA C11c · 3: el rehecho ha podido quedarse con el documento del anulado.';
  exception when unique_violation then null;
  end;
  -- Lo de ahora: su propio documento y su número.
  perform pg_temp.enviado(v_b, 9003, 'UBR-PRB-20261010-2');
  raise notice 'C11c · 1-3: enviado, anulado y rehecho: el rehecho va con «-2» y su envío cabe; enlazar el del anulado choca (external_send_ext_uq)';
end $$;

-- 4 · Se anula el rehecho y se rehace otra vez: vez 3.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  perform public.journal_entry_anular(current_setting('prueba.b')::uuid, 'Prueba C11c: otra vez', '2026-10-24', 'Prueba C11c');
end $$;
select set_config('prueba.c', pg_temp.asiento('Prueba C11c · el segundo rehecho')::text, true);
reset role;
do $$ begin
  if public.conta_diez_numero_vez(current_setting('prueba.c')::uuid, 'UBR-PRB-20261010') <> 3 then
    raise exception 'PRUEBA C11c · 4: el segundo rehecho no va con la vez 3.';
  end if;
  -- 5 · Otro número: vez 1. Un número raro: parado.
  if public.conta_diez_numero_vez(current_setting('prueba.c')::uuid, 'UBR-PRB-20261011') <> 1 then
    raise exception 'PRUEBA C11c · 5: otro día no es la primera vez.';
  end if;
  begin
    perform public.conta_diez_numero_vez(current_setting('prueba.c')::uuid, 'UBR.*');
    raise exception 'PRUEBA C11c · 5: un número con «.*» no se ha parado.';
  exception when invalid_parameter_value then null;
  end;
  raise notice 'C11c · 4-5: la tercera vez, «-3»; otro día, el de siempre; un número raro, parado';
end $$;

-- 6 · Un usuario no la llama; la vuelta atrás la quita.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_diez_numero_vez(current_setting('prueba.c')::uuid, 'UBR-PRB-20261010');
    raise exception 'PRUEBA C11c · 6: un usuario ha podido llamar a conta_diez_numero_vez.';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
\i supabase/vuelta-atras/20261024T0732_c11c_numero_vez.down.sql
do $$ begin
  if to_regprocedure('public.conta_diez_numero_vez(uuid, text)') is not null then
    raise exception 'PRUEBA C11c · 6: la vuelta atrás no la ha quitado.';
  end if;
  raise notice 'PRUEBA C11c en verde: anular uno enviado, rehacerlo y validarlo: el rehecho va con su vez y su envío cabe; la vuelta atrás la quita.';
end $$;

rollback;
