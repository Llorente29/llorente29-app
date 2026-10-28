-- supabase/staging/sql/20261028_s01_propuestas_socio_prueba.sql
--
-- SOLO STAGING. Prueba de la 0905 (el socio de marca se propone solo), con \i
-- dentro de la transacción y ROLLBACK: staging no cambia. En la empresa A, con
-- las liquidaciones de la semilla: Marcas del Sur (compras, aportaciones y
-- comisión; julio, Norte Centro) y Distribuciones Prueba Aurora (por
-- documentos; septiembre, en borrador).
--
-- REGLA 31 · lo que se espera es lo que da el NAVEGADOR (liquidacionSocio,
-- liquidacionMensual y aplicarAprendizaje de lib/asientosPropuestos.ts) sobre
-- estos mismos datos, calculado antes de borrar su copia y pegado aquí: la
-- regla de SQL tiene que dar lo mismo, campo a campo (jsonb, la misma vara).
--
--   1. Marcas del Sur, julio: la propuesta, igual que la del navegador.
--   2. Con una corrección aprendida (regla 11): la cuenta corregida y dicho,
--      igual que el navegador.
--   3. Al recibir su resumen (cambia su estado): se propone sola.
--   4. Aurora se confirma por su camino (compras_liquidacion_confirmar) sin
--      cuenta de cliente: se confirma igual, no se propone, y queda en «Lo que
--      no he podido proponer» (Ventas › Liquidaciones).
--   5. Con su cuenta de cliente y su gasto: los tres asientos, iguales que los
--      del navegador; el «no he podido» se va.
--   6. Alguien sin cuenta no puede proponer.
--   7. La vuelta atrás: no queda nada de la 0905.
--
-- Nombra lo que toca, para el analizador: conta_propuestas_socio,
-- conta_proponer_socios, _conta_proponer_socio, tg_conta_socio_proponer,
-- _conta_aprendizaje, _conta_cuotas_y_redondeo, _conta_hoja, _conta_enlace,
-- _conta_tipo_iva, licensed_settlement, journal_correction,
-- company_account_link, conta_propuesta_pendiente, journal_entry, journal_line.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01 SOCIO: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';
set local lock_timeout = '120s';
lock table public.accounts, public.company, public.company_account, public.bank_match in share row exclusive mode;
lock table public.conta_enlace_pago, public.treasury_account, public.journal_entry in access exclusive mode;

select to_regclass('public.conta_propuesta_pendiente') is not null as ya_esta_la_0753,
       to_regprocedure('public.conta_propuestas_socio(uuid,uuid)') is not null as ya_esta_la_0905 \gset
\if :ya_esta_la_0753
\else
\i supabase/migrations/20261028T0753_s01_propuestas_solas_base.sql
\endif
\if :ya_esta_la_0905
\else
\i supabase/migrations/20261028T0905_s01_propuestas_socio.sql
\endif

create or replace function pg_temp.lineas(p uuid) returns text language sql as $$
  select string_agg(ca.code || ' ' || coalesce(jl.debit, 0)::numeric(14,2) || '/' || coalesce(jl.credit, 0)::numeric(14,2), ' · ' order by jl.position)
    from public.journal_line jl join public.company_account ca on ca.id = jl.company_account_id where jl.entry_id = p
$$;
create temp table _p (clave text primary key, v text) on commit drop;
grant select, insert, update on _p to authenticated, anon, service_role;
insert into _p values ('empresa', '3b34403a-a7d6-4a48-a8d7-737e8cababdc'), ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'),
  ('admin', 'c01a0000-0000-4000-8000-0000000000a1'), ('jul', 'c0300000-0000-4000-8000-000000000201'),
  ('aurora', 'ca4aa392-525b-45f5-b329-5d45b701c89f'), ('p_aurora', '24fcad75-47c2-481d-a4ae-f1a4387f06a9'),
  ('s_aurora', 'c0c00000-0000-4000-8000-000000000004'), ('mds', '6cb2919e-826e-48ad-a507-263bfc481efd');
create temp table _esperado (que text primary key, j jsonb) on commit drop;
insert into _esperado values
  ('a', '{"entrada": {"series": 4, "fecha": "2026-07-31", "concepto": "Liquidación Marcas del Sur", "source_type": "licensed_settlement", "source_id": "c0300000-0000-4000-8000-000000000201", "confianza": "duda", "porque": "Su resumen mensual como compra, tu comisión como ingreso con IVA, y se compensan: le pagas 2.384,14 €.", "razones": [{"decision": "Su resumen mensual es la factura de compra", "porque": "lo que te llega con albarán a su nombre sirve para contrastar, no se asienta"}, {"decision": "Tu comisión, ingreso por servicios (705) con IVA 21 %", "porque": "es lo único tuyo de sus ventas", "cita": "Ley 37/1992, art. 11.Dos.15.º"}, {"decision": "Mira esto", "porque": "El IVA de sus compras va al 10 %: los albaranes no lo traen. Compruébalo con su resumen mensual."}, {"decision": "Mira esto", "porque": "Sus aportaciones del mes (600,00 €) no entran aquí: van por el banco cuando llegan."}], "party_id": "6cb2919e-826e-48ad-a507-263bfc481efd", "documento": null}, "lineas": [{"cuenta": "60000000", "debe": 2900, "haber": 0, "concepto": null, "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "marca_id": null, "tercero_id": null, "documento": null, "iva": null, "retencion": null}, {"cuenta": "47200010", "debe": 290, "haber": 0, "concepto": null, "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "marca_id": null, "tercero_id": null, "documento": null, "iva": {"tipo_id": "5bbab66f-a022-44a6-b146-ac577a2988d3", "base": 2900, "libro": "received", "deducible": "yes", "facturas": 1}, "retencion": null}, {"cuenta": "40000005", "debe": 0, "haber": 3190, "concepto": "Su resumen mensual (compras)", "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "marca_id": null, "tercero_id": "6cb2919e-826e-48ad-a507-263bfc481efd", "documento": null, "iva": null, "retencion": null}, {"cuenta": "43000002", "debe": 805.86, "haber": 0, "concepto": "Tu factura de comisión", "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "marca_id": null, "tercero_id": "6cb2919e-826e-48ad-a507-263bfc481efd", "documento": null, "iva": null, "retencion": null}, {"cuenta": "70500000", "debe": 0, "haber": 666, "concepto": "Comisión sobre sus ventas", "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "marca_id": null, "tercero_id": null, "documento": null, "iva": null, "retencion": null}, {"cuenta": "47700021", "debe": 0, "haber": 139.86, "concepto": null, "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "marca_id": null, "tercero_id": null, "documento": null, "iva": {"tipo_id": "28f9a398-2c95-4a3c-aebe-66d8cf37154f", "base": 666, "libro": "issued", "deducible": null, "facturas": 1}, "retencion": null}, {"cuenta": "40000005", "debe": 805.86, "haber": 0, "concepto": "Compensación con sus compras", "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "marca_id": null, "tercero_id": "6cb2919e-826e-48ad-a507-263bfc481efd", "documento": null, "iva": null, "retencion": null}, {"cuenta": "43000002", "debe": 0, "haber": 805.86, "concepto": "Compensación con sus compras", "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "marca_id": null, "tercero_id": "6cb2919e-826e-48ad-a507-263bfc481efd", "documento": null, "iva": null, "retencion": null}]}'::jsonb),
  ('b', '{"entrada": {"series": 4, "fecha": "2026-07-31", "concepto": "Liquidación Marcas del Sur", "source_type": "licensed_settlement", "source_id": "c0300000-0000-4000-8000-000000000201", "confianza": "duda", "porque": "Su resumen mensual como compra, tu comisión como ingreso con IVA, y se compensan: le pagas 2.384,14 €.", "razones": [{"decision": "Su resumen mensual es la factura de compra", "porque": "lo que te llega con albarán a su nombre sirve para contrastar, no se asienta"}, {"decision": "Tu comisión, ingreso por servicios (705) con IVA 21 %", "porque": "es lo único tuyo de sus ventas", "cita": "Ley 37/1992, art. 11.Dos.15.º"}, {"decision": "Lo has corregido antes", "porque": "en la anterior del mismo origen cambiaste 60000000 por 60200000 (Prueba S01): lo hago igual"}, {"decision": "Mira esto", "porque": "El IVA de sus compras va al 10 %: los albaranes no lo traen. Compruébalo con su resumen mensual."}, {"decision": "Mira esto", "porque": "Sus aportaciones del mes (600,00 €) no entran aquí: van por el banco cuando llegan."}], "party_id": "6cb2919e-826e-48ad-a507-263bfc481efd", "documento": null}, "lineas": [{"cuenta": "60200000", "debe": 2900, "haber": 0, "concepto": null, "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "marca_id": null, "tercero_id": null, "documento": null, "iva": null, "retencion": null}, {"cuenta": "47200010", "debe": 290, "haber": 0, "concepto": null, "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "marca_id": null, "tercero_id": null, "documento": null, "iva": {"tipo_id": "5bbab66f-a022-44a6-b146-ac577a2988d3", "base": 2900, "libro": "received", "deducible": "yes", "facturas": 1}, "retencion": null}, {"cuenta": "40000005", "debe": 0, "haber": 3190, "concepto": "Su resumen mensual (compras)", "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "marca_id": null, "tercero_id": "6cb2919e-826e-48ad-a507-263bfc481efd", "documento": null, "iva": null, "retencion": null}, {"cuenta": "43000002", "debe": 805.86, "haber": 0, "concepto": "Tu factura de comisión", "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "marca_id": null, "tercero_id": "6cb2919e-826e-48ad-a507-263bfc481efd", "documento": null, "iva": null, "retencion": null}, {"cuenta": "70500000", "debe": 0, "haber": 666, "concepto": "Comisión sobre sus ventas", "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "marca_id": null, "tercero_id": null, "documento": null, "iva": null, "retencion": null}, {"cuenta": "47700021", "debe": 0, "haber": 139.86, "concepto": null, "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "marca_id": null, "tercero_id": null, "documento": null, "iva": {"tipo_id": "28f9a398-2c95-4a3c-aebe-66d8cf37154f", "base": 666, "libro": "issued", "deducible": null, "facturas": 1}, "retencion": null}, {"cuenta": "40000005", "debe": 805.86, "haber": 0, "concepto": "Compensación con sus compras", "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "marca_id": null, "tercero_id": "6cb2919e-826e-48ad-a507-263bfc481efd", "documento": null, "iva": null, "retencion": null}, {"cuenta": "43000002", "debe": 0, "haber": 805.86, "concepto": "Compensación con sus compras", "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "marca_id": null, "tercero_id": "6cb2919e-826e-48ad-a507-263bfc481efd", "documento": null, "iva": null, "retencion": null}]}'::jsonb),
  ('c', '[{"entrada": {"series": 2, "fecha": "2026-09-30", "concepto": "Factura Distribuciones Prueba Aurora, S.L. · FV-P9", "source_type": "supplier_invoice", "confianza": "seguro", "porque": "Lo que te factura cada mes: compra, con su IVA por tipo, a su cuenta de proveedor.", "razones": [{"decision": "Su factura de la liquidación del mes", "porque": "no factura las entregas: sus albaranes no se apuntan uno a uno"}], "party_id": "24fcad75-47c2-481d-a4ae-f1a4387f06a9", "documento": "FV-P9"}, "lineas": [{"cuenta": "60000000", "debe": 400, "haber": 0, "concepto": null, "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "marca_id": null, "tercero_id": null, "documento": "FV-P9", "iva": null, "retencion": null}, {"cuenta": "47200004", "debe": 4, "haber": 0, "concepto": null, "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "marca_id": null, "tercero_id": null, "documento": "FV-P9", "iva": {"tipo_id": "b8bddc11-51a0-48a6-9bef-5686b2345337", "base": 100, "libro": "received", "deducible": "yes", "facturas": 1}, "retencion": null}, {"cuenta": "47200010", "debe": 30, "haber": 0, "concepto": null, "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "marca_id": null, "tercero_id": null, "documento": "FV-P9", "iva": {"tipo_id": "5bbab66f-a022-44a6-b146-ac577a2988d3", "base": 300, "libro": "received", "deducible": "yes", "facturas": 1}, "retencion": null}, {"cuenta": "40000000", "debe": 0, "haber": 434, "concepto": null, "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "marca_id": null, "tercero_id": "24fcad75-47c2-481d-a4ae-f1a4387f06a9", "documento": "FV-P9", "iva": null, "retencion": null}]}, {"entrada": {"series": 4, "fecha": "2026-09-30", "concepto": "Le facturas a Distribuciones Prueba Aurora, S.L. · AF-P9", "source_type": "licensed_settlement", "confianza": "seguro", "porque": "La factura que le haces (la extiende él en tu nombre): ingreso con su IVA, a su cuenta de cliente, con su número en el libro de expedidas.", "razones": [{"decision": "Servicios a la 705, el género que pones tú a la 700", "porque": "cada línea por lo que es"}, {"decision": "Nº AF-P9 en el libro de expedidas", "porque": "es una factura tuya aunque la haya extendido él"}], "party_id": "24fcad75-47c2-481d-a4ae-f1a4387f06a9", "documento": "AF-P9"}, "lineas": [{"cuenta": "43000002", "debe": 1320, "haber": 0, "concepto": null, "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "marca_id": null, "tercero_id": "24fcad75-47c2-481d-a4ae-f1a4387f06a9", "documento": "AF-P9", "iva": null, "retencion": null}, {"cuenta": "70500000", "debe": 0, "haber": 1200, "concepto": "Servicios por sus ventas y el género aportado", "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "marca_id": null, "tercero_id": null, "documento": "AF-P9", "iva": null, "retencion": null}, {"cuenta": "47700010", "debe": 0, "haber": 120, "concepto": null, "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "marca_id": null, "tercero_id": null, "documento": "AF-P9", "iva": {"tipo_id": "5bbab66f-a022-44a6-b146-ac577a2988d3", "base": 1200, "libro": "issued", "deducible": null, "facturas": 1}, "retencion": null}]}, {"entrada": {"series": 4, "fecha": "2026-09-30", "concepto": "Compensación con Distribuciones Prueba Aurora, S.L. · AF-P9 y FV-P9", "source_type": "supplier_payment", "confianza": "seguro", "porque": "Su factura se paga con lo que te debe. Te paga 886,00 €: es lo que queda en su cuenta de cliente, y llega por el banco.", "razones": [{"decision": "Una factura contra otra", "porque": "así lo liquida: se paga la diferencia"}], "party_id": "24fcad75-47c2-481d-a4ae-f1a4387f06a9", "documento": null}, "lineas": [{"cuenta": "40000000", "debe": 434, "haber": 0, "concepto": null, "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "marca_id": null, "tercero_id": "24fcad75-47c2-481d-a4ae-f1a4387f06a9", "documento": "FV-P9", "iva": null, "retencion": null}, {"cuenta": "43000002", "debe": 0, "haber": 434, "concepto": null, "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "marca_id": null, "tercero_id": "24fcad75-47c2-481d-a4ae-f1a4387f06a9", "documento": "AF-P9", "iva": null, "retencion": null}]}]'::jsonb);

-- La siembra que se espera.
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa');
begin
  if (select status || '·' || formula from public.licensed_settlement where id = (select v::uuid from _p where clave = 'jul')) <> 'saldada·compras_aportaciones_comision'
     or (select status || '·' || formula from public.licensed_settlement where id = (select v::uuid from _p where clave = 'aurora')) <> 'borrador·documentos' then
    raise exception 'PRUEBA S01 SOCIO · siembra: las liquidaciones de la semilla no están como se esperan.';
  end if;
  if exists (select 1 from public.journal_entry where company_id = e and source_type = 'licensed_settlement')
     or exists (select 1 from public.journal_correction where company_id = e and origin_key like 'licensed_settlement:%')
     or exists (select 1 from public.company_account_link where company_id = e and entity = 'customer' and entity_id = (select v from _p where clave = 'p_aurora')) then
    raise exception 'PRUEBA S01 SOCIO · siembra: ya hay asientos o correcciones del socio, o Aurora ya tiene su cuenta de cliente.';
  end if;
  if not (public.conta_dia_abierto(e, '2026-07-31') and public.conta_dia_abierto(e, '2026-09-30')) then
    raise exception 'PRUEBA S01 SOCIO · siembra: el 31/07 o el 30/09 no están abiertos.';
  end if;
end $$;

-- ── 1 · Marcas del Sur, julio: igual que el navegador ──────────────────────
do $$
declare x jsonb := public.conta_propuestas_socio((select v::uuid from _p where clave = 'empresa'), (select v::uuid from _p where clave = 'jul'));
begin
  if x->'propuestas'->0 is distinct from (select j from _esperado where que = 'a') then
    raise exception 'PRUEBA S01 SOCIO · 1: SQL da % y el navegador %.', x, (select j from _esperado where que = 'a');
  end if;
  raise notice '1 · Marcas del Sur, julio: la de SQL es la del navegador («%»)', x->'propuestas'->0->'entrada'->>'porque';
end $$;

-- ── 2 · Con una corrección aprendida: igual que el navegador ───────────────
savepoint aprende;
insert into public.journal_correction (account_id, company_id, origin_key, proposed_code, chosen_code, created_by_name, created_at)
values ((select v::uuid from _p where clave = 'cuenta'), (select v::uuid from _p where clave = 'empresa'), 'licensed_settlement:' || (select v from _p where clave = 'mds'),
        '60000000', '60200000', 'Prueba S01', '2026-10-28 09:00:00+00');
do $$
declare x jsonb := public.conta_propuestas_socio((select v::uuid from _p where clave = 'empresa'), (select v::uuid from _p where clave = 'jul'));
begin
  if x->'propuestas'->0 is distinct from (select j from _esperado where que = 'b') then
    raise exception 'PRUEBA S01 SOCIO · 2: con lo aprendido, SQL da % y el navegador %.', x, (select j from _esperado where que = 'b');
  end if;
  raise notice '2 · con lo aprendido: % (igual que el navegador)', x->'propuestas'->0->'lineas'->0->>'cuenta';
end $$;
rollback to savepoint aprende;

-- ── 3 · Al recibir su resumen: se propone sola ─────────────────────────────
update public.licensed_settlement set status = 'confirmada' where id = (select v::uuid from _p where clave = 'jul');
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); je public.journal_entry;
begin
  select * into je from public.journal_entry where company_id = e and source_type = 'licensed_settlement' and source_id = (select v::uuid from _p where clave = 'jul');
  if je.id is null or je.status <> 'propuesto' or je.entry_date <> '2026-07-31' or je.series <> 4 then
    raise exception 'PRUEBA S01 SOCIO · 3: al recibirla no se propuso sola (%, %).', je.status,
      (select porque from public.conta_propuesta_pendiente where company_id = e and origen_id = (select v from _p where clave = 'jul'));
  end if;
  if (select count(*) from public.journal_line where entry_id = je.id) <> jsonb_array_length((select j->'lineas' from _esperado where que = 'a')) then
    raise exception 'PRUEBA S01 SOCIO · 3: el asiento tiene otras líneas («%»).', pg_temp.lineas(je.id);
  end if;
  raise notice '3 · al recibirla, propuesta sola: %', pg_temp.lineas(je.id);
end $$;

-- ── 4 · Aurora se confirma sin su cuenta de cliente: entra, y se dice ──────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _p where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); x jsonb;
begin
  x := public.compras_liquidacion_confirmar((select v::uuid from _p where clave = 'aurora'));
  if (select status from public.licensed_settlement where id = (select v::uuid from _p where clave = 'aurora')) <> 'confirmada' then
    raise exception 'PRUEBA S01 SOCIO · 4: la liquidación no se confirmó.';
  end if;
  if (select porque || ' · ' || donde from public.conta_propuesta_pendiente where company_id = e and origen = 'licensed_settlement' and origen_id = (select v from _p where clave = 'aurora'))
     is distinct from 'Distribuciones Prueba Aurora, S.L. no tiene su cuenta de cliente: es a quien le facturas. · Ventas › Liquidaciones' then
    raise exception 'PRUEBA S01 SOCIO · 4: el «no he podido» es «%».',
      (select porque || ' · ' || donde from public.conta_propuesta_pendiente where company_id = e and origen_id = (select v from _p where clave = 'aurora'));
  end if;
  raise notice '4 · Aurora confirmada sin cuenta de cliente: «%» (en Ventas › Liquidaciones)', x->>'frase';
end $$;
reset role;

-- ── 5 · Con su cuenta de cliente y su gasto: los tres, iguales que el navegador ──
insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
select (select v::uuid from _p where clave = 'cuenta'), ca.company_id, ca.id, 'customer', (select v from _p where clave = 'p_aurora'), 'principal', 'manual'
  from public.company_account ca where ca.company_id = (select v::uuid from _p where clave = 'empresa') and ca.code = '43000002';
insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
select (select v::uuid from _p where clave = 'cuenta'), ca.company_id, ca.id, 'supplier', (select v from _p where clave = 's_aurora'), 'gasto', 'manual'
  from public.company_account ca where ca.company_id = (select v::uuid from _p where clave = 'empresa') and ca.code = '60000000';
set local role authenticated;
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); x jsonb; sqlp jsonb;
begin
  x := public.conta_proponer_socios(e, '2026-09-01', '2026-09-30', 'Prueba');
  -- Los tres de Aurora (las dos de Marcas del Sur de septiembre también salen en esta pasada).
  if (select count(*) from public.journal_entry je join public.licensed_settlement l on l.id = (select v::uuid from _p where clave = 'aurora')
       where je.company_id = e and je.status = 'propuesto'
         and ((je.source_type = 'licensed_settlement' and je.source_id = l.id) or (je.source_type in ('supplier_invoice', 'supplier_payment') and je.source_id = l.received_invoice_id))) <> 3 then
    raise exception 'PRUEBA S01 SOCIO · 5: con sus cuentas dio % y Aurora no tiene sus tres asientos.', x;
  end if;
  select jsonb_agg(p #- '{entrada,source_id}' order by o) into sqlp
    from jsonb_array_elements(public.conta_propuestas_socio(e, (select v::uuid from _p where clave = 'aurora'))->'propuestas') with ordinality z(p, o);
  if sqlp is distinct from (select j from _esperado where que = 'c') then
    raise exception 'PRUEBA S01 SOCIO · 5: SQL da % y el navegador %.', sqlp, (select j from _esperado where que = 'c');
  end if;
  if exists (select 1 from public.conta_propuesta_pendiente where company_id = e and origen = 'licensed_settlement' and origen_id = (select v from _p where clave = 'aurora')) then
    raise exception 'PRUEBA S01 SOCIO · 5: el «no he podido» sigue ahí.';
  end if;
  raise notice '5 · Aurora con sus cuentas: su factura, la que le haces y la compensación, iguales que el navegador';
end $$;
reset role;

-- ── 6 · Sin cuenta, no ──────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
do $$
declare v_err text;
begin
  begin perform public.conta_proponer_socios((select v::uuid from _p where clave = 'empresa'), '2026-07-01', '2026-09-30', 'Nadie');
  exception when others then v_err := sqlerrm; end;
  if v_err is null then raise exception 'PRUEBA S01 SOCIO · 6: alguien sin cuenta propone.'; end if;
  raise notice '6 · sin cuenta, no se propone («%»)', v_err;
end $$;
reset role;

-- ── 7 · La vuelta atrás ─────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261028T0905_s01_propuestas_socio.down.sql
do $$ begin
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
              and proname in ('conta_propuestas_socio', 'conta_proponer_socios', '_conta_proponer_socio', 'tg_conta_socio_proponer', '_conta_aprendizaje',
                              '_conta_cuotas_y_redondeo', '_conta_hoja', '_conta_enlace', '_conta_tipo_iva'))
     or exists (select 1 from pg_trigger where tgname = 'conta_socio_proponer') then
    raise exception 'PRUEBA S01 SOCIO · 7: la vuelta atrás deja algo.';
  end if;
  raise notice '7 · la vuelta atrás: no queda nada de la 0905';
end $$;
rollback;
