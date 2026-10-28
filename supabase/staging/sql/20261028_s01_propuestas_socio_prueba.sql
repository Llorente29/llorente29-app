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
--   8. Las ramas del redondeo, al céntimo (los casos de liquidacionMensual.test.ts).
--   9. Lo cobrado por cuenta de él, con y sin (los casos de libroC04.test.ts).
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
  ('c', '[{"entrada": {"series": 2, "fecha": "2026-09-30", "concepto": "Factura Distribuciones Prueba Aurora, S.L. · FV-P9", "source_type": "supplier_invoice", "confianza": "seguro", "porque": "Lo que te factura cada mes: compra, con su IVA por tipo, a su cuenta de proveedor.", "razones": [{"decision": "Su factura de la liquidación del mes", "porque": "no factura las entregas: sus albaranes no se apuntan uno a uno"}], "party_id": "24fcad75-47c2-481d-a4ae-f1a4387f06a9", "documento": "FV-P9"}, "lineas": [{"cuenta": "60000000", "debe": 400, "haber": 0, "concepto": null, "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "marca_id": null, "tercero_id": null, "documento": "FV-P9", "iva": null, "retencion": null}, {"cuenta": "47200004", "debe": 4, "haber": 0, "concepto": null, "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "marca_id": null, "tercero_id": null, "documento": "FV-P9", "iva": {"tipo_id": "b8bddc11-51a0-48a6-9bef-5686b2345337", "base": 100, "libro": "received", "deducible": "yes", "facturas": 1}, "retencion": null}, {"cuenta": "47200010", "debe": 30, "haber": 0, "concepto": null, "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "marca_id": null, "tercero_id": null, "documento": "FV-P9", "iva": {"tipo_id": "5bbab66f-a022-44a6-b146-ac577a2988d3", "base": 300, "libro": "received", "deducible": "yes", "facturas": 1}, "retencion": null}, {"cuenta": "40000000", "debe": 0, "haber": 434, "concepto": null, "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "marca_id": null, "tercero_id": "24fcad75-47c2-481d-a4ae-f1a4387f06a9", "documento": "FV-P9", "iva": null, "retencion": null}]}, {"entrada": {"series": 4, "fecha": "2026-09-30", "concepto": "Le facturas a Distribuciones Prueba Aurora, S.L. · AF-P9", "source_type": "licensed_settlement", "confianza": "seguro", "porque": "La factura que le haces (la extiende él en tu nombre): ingreso con su IVA, a su cuenta de cliente, con su número en el libro de expedidas.", "razones": [{"decision": "Servicios a la 705, el género que pones tú a la 700", "porque": "cada línea por lo que es"}, {"decision": "Nº AF-P9 en el libro de expedidas", "porque": "es una factura tuya aunque la haya extendido él"}], "party_id": "24fcad75-47c2-481d-a4ae-f1a4387f06a9", "documento": "AF-P9"}, "lineas": [{"cuenta": "43000000", "debe": 1320, "haber": 0, "concepto": null, "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "marca_id": null, "tercero_id": "24fcad75-47c2-481d-a4ae-f1a4387f06a9", "documento": "AF-P9", "iva": null, "retencion": null}, {"cuenta": "70500000", "debe": 0, "haber": 1200, "concepto": "Servicios por sus ventas y el género aportado", "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "marca_id": null, "tercero_id": null, "documento": "AF-P9", "iva": null, "retencion": null}, {"cuenta": "47700010", "debe": 0, "haber": 120, "concepto": null, "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "marca_id": null, "tercero_id": null, "documento": "AF-P9", "iva": {"tipo_id": "5bbab66f-a022-44a6-b146-ac577a2988d3", "base": 1200, "libro": "issued", "deducible": null, "facturas": 1}, "retencion": null}]}, {"entrada": {"series": 4, "fecha": "2026-09-30", "concepto": "Compensación con Distribuciones Prueba Aurora, S.L. · AF-P9 y FV-P9", "source_type": "supplier_payment", "confianza": "seguro", "porque": "Su factura se paga con lo que te debe. Te paga 886,00 €: es lo que queda en su cuenta de cliente, y llega por el banco.", "razones": [{"decision": "Una factura contra otra", "porque": "así lo liquida: se paga la diferencia"}], "party_id": "24fcad75-47c2-481d-a4ae-f1a4387f06a9", "documento": null}, "lineas": [{"cuenta": "40000000", "debe": 434, "haber": 0, "concepto": null, "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "marca_id": null, "tercero_id": "24fcad75-47c2-481d-a4ae-f1a4387f06a9", "documento": "FV-P9", "iva": null, "retencion": null}, {"cuenta": "43000000", "debe": 0, "haber": 434, "concepto": null, "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "marca_id": null, "tercero_id": "24fcad75-47c2-481d-a4ae-f1a4387f06a9", "documento": "AF-P9", "iva": null, "retencion": null}]}]'::jsonb);

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

-- ── 5 · Con su cuenta de cliente (la común, 43000000) y su gasto: los tres, iguales que el navegador ──
insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
select (select v::uuid from _p where clave = 'cuenta'), ca.company_id, ca.id, 'customer', (select v from _p where clave = 'p_aurora'), 'principal', 'manual'
  from public.company_account ca where ca.company_id = (select v::uuid from _p where clave = 'empresa') and ca.code = '43000000';
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

-- ── 8 · Las ramas del redondeo, al céntimo (aceptación 5 de Compras, 10/10) ──
-- Los casos que cubría tests/unit/modules/conta/liquidacionMensual.test.ts sobre
-- liquidacionMensual() y cuotasYRedondeo(), que se borran del navegador: las
-- cifras de los documentos de septiembre (AF-02927 y FV-02927), en Aurora.
create or replace function pg_temp.filas(p jsonb) returns text language sql as $$
  select string_agg((l->>'cuenta') || ' ' || (l->>'debe')::numeric(14,2) || '/' || (l->>'haber')::numeric(14,2), ' · ' order by o)
    from jsonb_array_elements(p->'lineas') with ordinality z(l, o)
$$;
insert into public.licensed_settlement (id, account_id, company_id, party_id, supplier_id, location_id, period_from, period_to, status, formula, settlement_ref, received_invoice_id, detail)
select 'ca4aa392-0000-4000-8000-000000000927', l.account_id, l.company_id, l.party_id, l.supplier_id, 'e0200000-0000-4000-8000-0000000000a3', '2026-09-01', '2026-09-30', 'borrador', 'documentos', 'AF-02927',
       l.received_invoice_id, jsonb_build_object('bloqueos', '[]'::jsonb,
         'emitida', jsonb_build_object('numero', 'AF-02927', 'fecha', '2026-09-30', 'total', 9533.65, 'lineas', jsonb_build_array(
            jsonb_build_object('concepto', 'Servicio por Ventas Multimarcas', 'base', 6746.87, 'tipo', 10),
            jsonb_build_object('concepto', 'Servicio por Ventas con Reparto Propio', 'base', 153.71, 'tipo', 10),
            jsonb_build_object('concepto', 'Mercaderías Aportadas por el Partner', 'base', 1738.74, 'tipo', 10),
            jsonb_build_object('concepto', 'Delivery fee Ventas con Reparto Propio', 'base', 27.63, 'tipo', 10))),
         'recibida', jsonb_build_object('numero', 'FV-02927', 'fecha', '2026-09-30', 'total', 3987.81, 'lineas', jsonb_build_array(
            jsonb_build_object('concepto', 'Mercaderías en Stock', 'base', 777.69, 'tipo', 4),
            jsonb_build_object('concepto', 'Mercaderías en Stock', 'base', 2003.91, 'tipo', 10),
            jsonb_build_object('concepto', 'Mercaderías en Stock', 'base', 805.55, 'tipo', 21))),
         'transaccion', jsonb_build_object('saldo', jsonb_build_object('importe', 5545.84)))
  from public.licensed_settlement l where l.id = (select v::uuid from _p where clave = 'aurora');
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); liq uuid := 'ca4aa392-0000-4000-8000-000000000927'; x jsonb;
begin
  if public._conta_cuotas_y_redondeo('[{"base": 8666.95, "tipo": 10}]', 9533.65) <> '{"porTipo": [{"tipo": 10, "base": 8666.95, "cuota": 866.7}], "redondeo": 0}'::jsonb
     or public._conta_cuotas_y_redondeo('[{"base": 100, "tipo": 21}]', 121.05) is not null then
    raise exception 'PRUEBA S01 SOCIO · 8: _conta_cuotas_y_redondeo no da lo de cuotasYRedondeo.';
  end if;
  x := public.conta_propuestas_socio(e, liq);
  if pg_temp.filas(x->'propuestas'->0) <> '60000000 3587.15/0.00 · 47200004 31.11/0.00 · 47200010 200.39/0.00 · 47200021 169.17/0.00 · 40000000 0.00/3987.81 · 76900000 0.00/0.01'
     or x->'propuestas'->0->'entrada'->'razones'->1->>'porque' <> 'Su factura FV-02927 dice 3.987,81 €; base y cuota de cada tipo dan 3.987,82 €. Las cuotas van como en la factura y el céntimo, a «redondeos».'
     or x->'propuestas'->0->'entrada'->>'confianza' <> 'probable' then
    raise exception 'PRUEBA S01 SOCIO · 8: la compra es «%» (%).', pg_temp.filas(x->'propuestas'->0), x->'propuestas'->0->'entrada';
  end if;
  if pg_temp.filas(x->'propuestas'->1) <> '43000000 9533.65/0.00 · 70500000 0.00/8666.95 · 47700010 0.00/866.70'
     or pg_temp.filas(x->'propuestas'->2) <> '40000000 3987.81/0.00 · 43000000 0.00/3987.81'
     or x->'propuestas'->2->'entrada'->>'porque' not like '%Te paga 5.545,84 €%' then
    raise exception 'PRUEBA S01 SOCIO · 8: el ingreso es «%» y la compensación «%».', pg_temp.filas(x->'propuestas'->1), pg_temp.filas(x->'propuestas'->2);
  end if;
  update public.licensed_settlement set detail = jsonb_set(detail, '{transaccion,saldo,importe}', '5000') where id = liq;
  if public.conta_propuestas_socio(e, liq)->>'sin_propuesta' not like 'La transacción dice 5.000,00 € de saldo%' then raise exception 'PRUEBA S01 SOCIO · 8: el saldo que no cuadra no se dice.'; end if;
  update public.licensed_settlement set detail = jsonb_set(detail, '{transaccion,saldo,importe}', '5545.84') where id = liq;
  update public.licensed_settlement set detail = jsonb_set(detail, '{emitida,lineas}', (detail->'emitida'->'lineas') || '[{"concepto": "Ajuste trimestral", "base": 0, "tipo": 10}]') where id = liq;
  if public.conta_propuestas_socio(e, liq)->>'sin_propuesta' not like '%«Ajuste trimestral»%' then raise exception 'PRUEBA S01 SOCIO · 8: la línea rara no se pregunta.'; end if;
  update public.licensed_settlement set detail = jsonb_set(detail, '{bloqueos}', '["algo"]') where id = liq;
  if public.conta_propuestas_socio(e, liq)->>'sin_propuesta' <> 'algo' then raise exception 'PRUEBA S01 SOCIO · 8: los bloqueos no paran.'; end if;
  update public.licensed_settlement set detail = jsonb_set(jsonb_set(detail, '{bloqueos}', '[]'), '{emitida,lineas}', (detail->'emitida'->'lineas') - 4) where id = liq;
  -- Sin 669/769 en el plan: el céntimo, a la línea del gasto, y se dice.
  update public.company_account set status = 'cerrada' where company_id = e and code in ('66900000', '76900000');
  x := public.conta_propuestas_socio(e, liq);
  if pg_temp.filas(x->'propuestas'->0) <> '60000000 3587.14/0.00 · 47200004 31.11/0.00 · 47200010 200.39/0.00 · 47200021 169.17/0.00 · 40000000 0.00/3987.81'
     or x->'propuestas'->0->'entrada'->'razones'->1->>'porque' not like '%no hay 669/769 en tu plan%' then
    raise exception 'PRUEBA S01 SOCIO · 8: sin 669/769 la compra es «%».', pg_temp.filas(x->'propuestas'->0);
  end if;
  raise notice '8 · el redondeo al céntimo: a la 769, o sin ella a la línea del gasto; el saldo, la línea rara y los bloqueos, dichos';
end $$;

-- ── 9 · Lo cobrado por cuenta de él (los casos de libroC04.test.ts) ────────
-- Octubre, Norte Centro: compras 1.000 al 10 %, comisión 300; con 2.000 € cobrados
-- por cuenta de él (una liquidación de su marca cedida) y sin ellos.
insert into public.licensed_settlement (id, account_id, company_id, party_id, location_id, period_from, period_to, status, formula, purchases_amount, contributions_amount, commission_amount)
values ('c0300000-0000-4000-8000-000000000931', (select v::uuid from _p where clave = 'cuenta'), null, (select v::uuid from _p where clave = 'mds'),
        'c01a0000-0000-4000-8000-0000000000a2', '2026-10-01', '2026-10-31', 'borrador', 'compras_aportaciones_comision', 1000, 0, 300);
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); liq uuid := 'c0300000-0000-4000-8000-000000000931'; x jsonb; p jsonb;
begin
  x := public.conta_propuestas_socio(e, liq); p := x->'propuestas'->0;
  if pg_temp.filas(p) <> '60000000 1000.00/0.00 · 47200010 100.00/0.00 · 40000005 0.00/1100.00 · 43000002 363.00/0.00 · 70500000 0.00/300.00 · 47700021 0.00/63.00 · 40000005 363.00/0.00 · 43000002 0.00/363.00'
     or p->'entrada'->>'porque' not like '%le pagas 737,00 €%' then
    raise exception 'PRUEBA S01 SOCIO · 9: sin lo cobrado, «%» (%).', pg_temp.filas(p), p->'entrada'->>'porque';
  end if;
  insert into public.channel_settlement (id, account_id, channel_id, brand_id, location_id, settlement_ref, settlement_date, period_from, period_to, flow_type, import_key, gross_sales, collected_on, collected_amount)
  values ('c0300000-0000-4000-8000-000000000932', (select v::uuid from _p where clave = 'cuenta'), 'e0200000-0000-4000-8000-00000000a0c1', 'e0200000-0000-4000-8000-00000000a0b5',
          'c01a0000-0000-4000-8000-0000000000a2', 'G-PRUEBA-S01-LIC', '2026-10-15', '2026-10-01', '2026-10-14', 'licensed', 'prueba-s01-socio-cobrado', 2000, '2026-10-15', 2000);
  x := public.conta_propuestas_socio(e, liq); p := x->'propuestas'->0;
  if pg_temp.filas(p) <> '60000000 1000.00/0.00 · 47200010 100.00/0.00 · 40000005 0.00/1100.00 · 43000002 363.00/0.00 · 70500000 0.00/300.00 · 47700021 0.00/63.00 · 41000003 363.00/0.00 · 43000002 0.00/363.00'
     or p->'entrada'->>'porque' not like '%le pagas 2.737,00 €%'
     or p->'entrada'->'razones'->2->>'decision' <> 'Lo cobrado por cuenta de él, en su cuenta de liquidación' then
    raise exception 'PRUEBA S01 SOCIO · 9: con lo cobrado, «%» (%).', pg_temp.filas(p), p->'entrada';
  end if;
  raise notice '9 · lo cobrado por cuenta de él: la comisión se cobra de ahí (41000003) y no pasa por su 400; sin ello, de sus compras';
end $$;

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
