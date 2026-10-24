-- supabase/staging/sql/20261024_v01_historico_prueba.sql
--
-- SOLO STAGING. Prueba de 20261024T1730_v01_historico_facturas (toca datos:
-- el número del libro de los cierres), con \i dentro de la transacción y
-- ROLLBACK: staging no cambia. En la empresa A (Taberna de Prueba Norte,
-- carril 0).
--
--   0. Staging no tiene traídos de Diez (lo dice el paso 1; el ensayo de
--      producción los pasa todos, con su comprobación al céntimo). Se prepara un cierre como
--      los de octubre: el de Glovo del 25/09 validado, con su PDF junto al
--      asiento y su envío a Diez (GLV-FLO-20260925), y sin número en el libro.
--   1. La tanda: el cierre queda con su factura resumen GLV-FLO-20260925
--      (serie GLV-FLO, nº 1), su PDF de siempre, sus cifras = las del libro, y
--      ese número en el libro; la copia guarda el número de antes (ninguno).
--   2. Un traído, con la misma función (la de los 1.196): el asiento del día
--      entero del 04/10 en Norte Centro hace de traído; su factura en la serie
--      DIEZ, con las líneas de su libro (tipo y cuota) y el libro sin tocar.
--   3. Pasarla dos veces no duplica nada (ya no queda nada que seleccionar).
--   4. La vuelta atrás: el libro como estaba, ni una factura de la tanda, ni
--      sus contadores, ni sus tablas.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA V01 HISTÓRICO: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

\i supabase/vuelta-atras/20261024T1730_v01_historico_facturas.down.sql

create temp table _h (clave text primary key, v text) on commit drop;
grant select, insert, update on _h to authenticated;
insert into _h values
  ('empresa', '3b34403a-a7d6-4a48-a8d7-737e8cababdc'),
  ('cierre', 'a6f75b0c-6e5c-4106-88b3-5659e6ca9618'),
  ('traido', 'fc7df35a-c53c-460e-907a-ebea3d7fef8b');

-- 0 · Lo de antes, y el cierre preparado como los de octubre.
do $$
declare v_e uuid := (select v::uuid from _h where clave = 'cierre');
begin
  if (select status from public.journal_entry where id = v_e) <> 'propuesto' then raise exception 'PRUEBA V01 HISTÓRICO · 0: el Glovo del 25/09 no está propuesto.'; end if;
  if (select status from public.journal_entry where id = (select v::uuid from _h where clave = 'traido')) <> 'validado' then raise exception 'PRUEBA V01 HISTÓRICO · 0: el día entero del 04/10 no está validado.'; end if;
end $$;
insert into _h select 'ruta', account_id::text || '/' || id::text || '/abcdef0123456789.pdf' from public.journal_entry where id = (select v::uuid from _h where clave = 'cierre');
insert into storage.objects (bucket_id, name, metadata) select 'conta-documentos', v, '{"size": 2048, "mimetype": "application/pdf"}'::jsonb from _h where clave = 'ruta';
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_e uuid := (select v::uuid from _h where clave = 'cierre');
begin
  perform public.journal_entry_validar_con_documento(v_e, public.conta_numero_previsto(v_e), (select v from _h where clave = 'ruta'), 'ResumenDeVentas_GLV-FLO-20260925.pdf', repeat('d', 64), 2048, 'Prueba histórico');
end $$;
reset role;
insert into public.external_send (account_id, company_id, entry_id, kind, ext_year, ext_series, ext_number, ext_invoice_number, payload_hash, status, sent_at)
select account_id, company_id, id, 'factura', '2026', '2', '999', 'GLV-FLO-20260925', md5('prueba'), 'enviado', now()
  from public.journal_entry where id = (select v::uuid from _h where clave = 'cierre');
-- 1 · La tanda. (Sus funciones de selección nacen con ella: que el cierre
-- preparado estaba en la selección lo prueba que salga con su factura.)
\i supabase/migrations/20261024T1730_v01_historico_facturas.sql

do $$ begin
  raise notice '1 · traídos de Diez que quedan sin factura en staging: % (los 1.196 de producción los pasa el ensayo de allí)', (select count(*) from public.conta_v01_historico_traidos());
end $$;

do $$
declare v_e uuid := (select v::uuid from _h where clave = 'cierre'); v_f public.customer_invoice; v_libro numeric;
begin
  select ci.* into v_f from public.customer_invoice ci where ci.entry_id = v_e;
  if v_f.id is null or v_f.status <> 'emitida' or v_f.number_text <> 'GLV-FLO-20260925' or v_f.series_code <> 'GLV-FLO' or v_f.number <> 1 or v_f.origin <> 'cierre_dia' then
    raise exception 'PRUEBA V01 HISTÓRICO · 1: la factura del cierre no es la GLV-FLO-20260925 emitida (serie GLV-FLO, nº 1): %.', to_jsonb(v_f);
  end if;
  if v_f.pdf_path is distinct from (select v from _h where clave = 'ruta') then raise exception 'PRUEBA V01 HISTÓRICO · 1: la factura no apunta a su PDF de siempre.'; end if;
  select sum(total) into v_libro from public.vat_book_entry where entry_id = v_e and book = 'issued';
  if v_f.total <> v_libro then raise exception 'PRUEBA V01 HISTÓRICO · 1: la factura suma % y el libro %.', v_f.total, v_libro; end if;
  if exists (select 1 from public.vat_book_entry where entry_id = v_e and book = 'issued' and number is distinct from 'GLV-FLO-20260925') then
    raise exception 'PRUEBA V01 HISTÓRICO · 1: el libro no lleva el número de la factura.';
  end if;
  if not exists (select 1 from public._copia_v01_historico_libro where entry_id = v_e and numero_antes is null) then
    raise exception 'PRUEBA V01 HISTÓRICO · 1: la copia no guarda el número de antes del libro.';
  end if;
  if (select last_number from public.customer_invoice_counter where company_id = v_f.company_id and series_code = 'GLV-FLO' and fiscal_year = 2026) <> 1 then
    raise exception 'PRUEBA V01 HISTÓRICO · 1: el contador de la serie GLV-FLO no queda en su último número.';
  end if;
  raise notice '1 · el cierre: GLV-FLO-20260925, su PDF de siempre, las cifras del libro y el número en el libro';
end $$;

-- 2 · Un traído, con la misma función.
do $$
declare v_e uuid := (select v::uuid from _h where clave = 'traido'); v_id uuid; v_f public.customer_invoice; v_antes text;
begin
  select string_agg(coalesce(number, '·'), ',' order by id) into v_antes from public.vat_book_entry where entry_id = v_e and book = 'issued';
  v_id := public._conta_v01_historico_factura(v_e, 'traida', 'DIEZ', 1, 'PRUEBA-DIEZ-1');
  select * into v_f from public.customer_invoice where id = v_id;
  if v_f.status <> 'emitida' or v_f.series_code <> 'DIEZ' or v_f.number_text <> 'PRUEBA-DIEZ-1' or v_f.pdf_path is not null
     or v_f.total <> (select sum(total) from public.vat_book_entry where entry_id = v_e and book = 'issued') then
    raise exception 'PRUEBA V01 HISTÓRICO · 2: la factura del traído no es la esperada: %.', to_jsonb(v_f);
  end if;
  if exists (select 1 from public.customer_invoice_line where invoice_id = v_id and tax_rate_id is null) then
    raise exception 'PRUEBA V01 HISTÓRICO · 2: una línea del traído sin su tipo de IVA.';
  end if;
  if v_antes is distinct from (select string_agg(coalesce(number, '·'), ',' order by id) from public.vat_book_entry where entry_id = v_e and book = 'issued') then
    raise exception 'PRUEBA V01 HISTÓRICO · 2: el libro de un traído ha cambiado.';
  end if;
  raise notice '2 · un traído: su factura en la serie DIEZ con las cifras de su libro, y el libro sin tocar';
end $$;

-- 3 · Dos veces: nada que seleccionar, nada duplicado.
do $$ begin
  if exists (select 1 from public.conta_v01_historico_cierres() where entry_id = (select v::uuid from _h where clave = 'cierre')) then
    raise exception 'PRUEBA V01 HISTÓRICO · 3: el cierre sigue en la selección después de la tanda.';
  end if;
end $$;
\i supabase/migrations/20261024T1730_v01_historico_facturas.sql
do $$ begin
  if (select count(*) from public.customer_invoice where entry_id = (select v::uuid from _h where clave = 'cierre')) <> 1 then
    raise exception 'PRUEBA V01 HISTÓRICO · 3: pasarla dos veces ha duplicado la factura.';
  end if;
  raise notice '3 · dos veces: nada duplicado';
end $$;

-- 4 · La vuelta atrás.
\i supabase/vuelta-atras/20261024T1730_v01_historico_facturas.down.sql
do $$ begin
  if exists (select 1 from public.customer_invoice where entry_id in (select v::uuid from _h where clave in ('cierre', 'traido'))) then
    raise exception 'PRUEBA V01 HISTÓRICO · 4: después de la vuelta atrás queda alguna factura de la tanda.';
  end if;
  if exists (select 1 from public.vat_book_entry where entry_id = (select v::uuid from _h where clave = 'cierre') and book = 'issued' and number is not null) then
    raise exception 'PRUEBA V01 HISTÓRICO · 4: el libro del cierre no vuelve a estar sin número.';
  end if;
  if exists (select 1 from public.customer_invoice_counter where series_code in ('GLV-FLO', 'DIEZ'))
     or to_regclass('public._v01_historico_facturas') is not null or to_regprocedure('public.conta_v01_historico_cierres()') is not null then
    raise exception 'PRUEBA V01 HISTÓRICO · 4: la vuelta atrás se deja contadores, tablas o funciones.';
  end if;
  raise notice '4 · la vuelta atrás: el libro como estaba y nada de la tanda';
  raise notice 'PRUEBA V01 HISTÓRICO en verde: el cierre con su número de Diez y su PDF, el traído con su libro intacto, sin duplicar, y la vuelta atrás.';
end $$;

rollback;
