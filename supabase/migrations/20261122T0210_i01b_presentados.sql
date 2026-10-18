-- supabase/migrations/20261122T0210_i01b_presentados.sql
--
-- I01b · P3 · PRESENTADOS. Solo añade una función.
--
--   conta_impuesto_presentados(empresa)                          [la persona]
--     · presentados: todas las declaraciones presentadas de la empresa (aquí
--       o fuera), la última primero, con su CSV, su justificante (número y
--       PDF), si está contabilizada y si está pagada.
--     · para_apuntar: los periodos del 303 del año pasado y de este cuyo plazo
--       ya ha empezado y que no están presentados en Sumied, con su
--       declaración si ya está calculada. Son los que se pueden apuntar con
--       «Ya presenté uno fuera»: también los de antes de que la empresa
--       llevara aquí sus impuestos (el 1T y el 2T de 2026 de Foodint, que
--       presentó su asesoría).
--     No escribe nada. Lo ve quien puede ver los impuestos de la empresa.
--
-- Vuelta atrás: supabase/vuelta-atras/20261122T0210_i01b_presentados.down.sql

create or replace function public.conta_impuesto_presentados(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_hoy date := (now() at time zone 'Europe/Madrid')::date; v_y int := extract(year from (now() at time zone 'Europe/Madrid'))::int;
begin
  if not exists (select 1 from public.company where id = p_company) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.conta_impuesto_puede_ver(p_company) then
    raise exception 'No puedes ver los impuestos de esta empresa.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'puede_gestionar', public.conta_impuesto_puede_gestionar(p_company),
    'presentados', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', r.id, 'cuenta', r.account_id, 'modelo', r.form_code, 'nombre', f.name, 'cadencia', r.cadence, 'ejercicio', r.fiscal_year, 'periodo', r.period,
               'estado', r.status, 'estado_texto', public.conta_impuesto_estado_texto(r.status),
               'resultado', r.result_kind, 'importe', r.amount,
               'presentada', r.filed_at, 'presentada_por', r.filed_by_name, 'por', r.filed_via, 'plazo', r.due_date,
               'csv', r.aeat_csv, 'justificante', r.aeat_receipt_number, 'justificante_pdf', r.receipt_document_path,
               'contabilizada', r.liquidation_entry_id is not null, 'casada', r.bank_match_id is not null,
               'comprobada', r.filed_via = 'sumied' or exists (select 1 from public.tax_return_event e where e.tax_return_id = r.id
                                                                   and e.aeat_service = 'outside_check' and e.result = 'ok'))
             order by r.filed_at desc nulls last, r.fiscal_year desc, r.period desc), '[]')
        from public.tax_return r join public.tax_form f on f.code = r.form_code
       where r.company_id = p_company and r.status in ('filed', 'booked', 'paid', 'offset', 'refunded')),
    'para_apuntar', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'ejercicio', c.ejercicio, 'periodo', c.periodo, 'presentacion', c.presentacion,
               'declaracion', r.id, 'estado', r.status, 'resultado', r.result_kind, 'importe', r.amount)
             order by c.ejercicio desc, c.periodo desc), '[]')
        from public.conta_impuesto_periodos(p_company, v_y) c
        left join public.tax_return r on r.company_id = p_company and r.form_code = '303' and r.fiscal_year = c.ejercicio
                                      and r.period = c.periodo and r.sequence = 1
       where c.modelo = '303' and c.ejercicio between v_y - 1 and v_y
         and c.presentacion - interval '25 days' <= v_hoy
         and coalesce(r.status, 'pending') in ('pending', 'draft', 'reviewed')));
end $$;

comment on function public.conta_impuesto_presentados(uuid) is
  'I01b. Las declaraciones presentadas de la empresa y los periodos del 303 que se pueden apuntar como presentados fuera. No escribe nada.';

revoke all on function public.conta_impuesto_presentados(uuid) from public, anon;
grant execute on function public.conta_impuesto_presentados(uuid) to authenticated, service_role;
