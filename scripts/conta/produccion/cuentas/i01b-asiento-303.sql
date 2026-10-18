-- scripts/conta/produccion/cuentas/i01b-asiento-303.sql
--
-- I01b · LO QUE CUENTA LA TANDA DE IMPUESTOS (0180–0220), antes y después.
-- SOLO LEE. Recuentos de Foodint (regla 9) y huellas de definiciones; ningún
-- nombre, NIF, CSV ni importe.
--
-- Lo que tiene que pasar: la columna tax_return_id de bank_match_item, de «no
-- existe» a «existe» (y 0 casados con declaración); el CHECK de
-- bank_match_item, otra huella (amplía); conta_motivos_para_validar, otra
-- huella (la excepción de la liquidación); las tres funciones nuevas y los dos
-- disparadores, de 0 a 3 y de 0 a 2; las funciones de las pantallas (0190 a
-- 0220), de 0 a 8. Y lo de Foodint, IGUAL antes y después:
-- sus asientos, sus casados, sus declaraciones por estado y sus asientos de
-- liquidación (la tanda no contabiliza nada: lo hace la persona, después).
select clave, valor from (
  select 1 o, 'bank_match_item.tax_return_id' clave,
    case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bank_match_item' and column_name = 'tax_return_id')
      then 'existe' else 'no existe' end valor union all
  select 2, 'huella del CHECK bank_match_item_uno',
    coalesce((select left(md5(pg_get_constraintdef(oid)), 16) from pg_constraint where conname = 'bank_match_item_uno' and conrelid = 'public.bank_match_item'::regclass), 'no existe') union all
  select 3, 'huella de conta_motivos_para_validar',
    coalesce((select left(md5(pg_get_functiondef(p.oid)), 16) from pg_proc p where p.oid = to_regprocedure('public.conta_motivos_para_validar(uuid)')), 'no existe') union all
  select 4, 'huella de conta_impuesto_estado_vale',
    coalesce((select left(md5(pg_get_functiondef(p.oid)), 16) from pg_proc p where p.oid = to_regprocedure('public.conta_impuesto_estado_vale(text, text)')), 'no existe') union all
  select 5, 'funciones nuevas (contabilizar, cargos posibles, casar cargo)',
    ((to_regprocedure('public.conta_impuesto_303_contabilizar(uuid)') is not null)::int
     + (to_regprocedure('public.conta_impuesto_cargos_posibles(uuid)') is not null)::int
     + (to_regprocedure('public.conta_impuesto_casar_cargo(uuid, uuid)') is not null)::int)::text union all
  select 6, 'disparadores nuevos (bank_match, journal_entry)',
    (select count(*) from pg_trigger where not tgisinternal and tgname in ('bank_match_deshecho_impuesto', 'journal_entry_liquidacion_anulada'))::text union all
  select 11, 'funciones de las pantallas (calendario, IVA del periodo, pago, presentados, certificados)',
    ((to_regprocedure('public.conta_impuesto_plazo_si_hay(text, text, integer, text)') is not null)::int
     + (to_regprocedure('public.conta_impuesto_periodos(uuid, integer)') is not null)::int
     + (to_regprocedure('public.conta_impuesto_calendario(uuid, date)') is not null)::int
     + (to_regprocedure('public.conta_impuesto_declaracion_ver(uuid, integer, text)') is not null)::int
     + (to_regprocedure('public.conta_impuesto_pago_poner(uuid, text, uuid)') is not null)::int
     + (to_regprocedure('public.conta_impuesto_presentados(uuid)') is not null)::int
     + (to_regprocedure('public.conta_impuesto_certificados_ver(uuid)') is not null)::int
     + (to_regprocedure('public.conta_impuesto_certificado_presenta(uuid, uuid)') is not null)::int)::text union all
  select 12, 'quién presenta en Foodint (empresa / asesoría / sin decir)',
    (select count(*) filter (where p.mode = 'company') || ' / ' || count(*) filter (where p.mode = 'advisor') || ' / ' ||
            ((select count(*) from public.company c where c.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') - count(*))
       from public.company_tax_presenter p where p.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') union all
  select 7, 'asientos de Foodint (todos)',
    (select count(*) from public.journal_entry where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text union all
  select 8, 'asientos de liquidación de Foodint (vat_settlement)',
    (select count(*) from public.journal_entry where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and source_type = 'vat_settlement')::text union all
  select 9, 'casados de Foodint (bank_match_item)',
    (select count(*) from public.bank_match_item where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text union all
  select 10, 'declaraciones de Foodint por estado',
    (select coalesce(string_agg(status || ' ' || n, ' · ' order by status), 'ninguna') from (select status, count(*) n from public.tax_return
       where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by status) x)
) t order by o;
