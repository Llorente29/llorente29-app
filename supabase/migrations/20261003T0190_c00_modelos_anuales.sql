-- ============================================================================
-- C00 · Respuesta 3 de Julio, punto 2 · Los resúmenes anuales, por REGLA
-- ----------------------------------------------------------------------------
-- A una sociedad con nóminas y alquiler la IA le puso 111, 115, 202, 303 y 390:
-- faltaban los anuales. No es gusto, es norma, y la regla vive en la TABLA de
-- modelos (filas de serie con su norma), no en el código del alta:
--
--   · todo periódico lleva su anual:
--       111 → 190   RD 439/2007 (Reglamento del IRPF), art. 108.2
--       115 → 180   RD 439/2007 (Reglamento del IRPF), art. 108.2
--       303 → 390   Ley 37/1992, art. 164.Uno.6.º
--       202 → 200   Ley 27/2014, art. 124.1
--   · el 347 va por defecto en toda sociedad que no esté en el SII
--     (RD 1065/2007, arts. 31 a 35; fuera quien lleva el SII, art. 32.e).
--
-- Cada cita está, literal, en la versión vigente de su artículo del texto
-- oficial descargado del BOE desde GitHub Actions (normas.ts y su prueba).
--
-- Lo que hace:
--   1. tax_form: annual_form_code, annual_legal_ref, default_for,
--      default_legal_ref; y la frase de cada anual en description.
--   2. Las filas del 190 (ya con su orden, la EHA/3127/2009) y del 200.
--      El 200 cita la ley que obliga a declararlo: la orden del modelo de
--      cada ejercicio no está en la base consolidada del BOE (solo la
--      HAC/565/2020, del ejercicio 2019). Pendiente, escrito en el PR.
--   3. Aceptar la sugerencia de un periódico (la del 115) añade también su
--      anual (el 180), y lo devuelve para que la pantalla lo diga.
--   4. verified_at de las filas de serie: la fecha de la descarga de las
--      fuentes del 03/10 (la 0130 se regeneró con ella; en una base donde la
--      0130 ya estaba, se pone al día aquí).
--
-- Solo añade columnas y actualiza filas de serie. conta_sugerencia_responder
-- conserva su firma (create or replace sin parámetros nuevos, regla 2).
--
-- Banda: tax_form y conta_sugerencia_responder son de contabilidad; ninguna
-- está en el camino del pedido (contarlo en pg_proc, cron.job y pg_trigger
-- antes de aplicar en producción).
-- ============================================================================

alter table public.tax_form
  add column if not exists annual_form_code text,
  add column if not exists annual_legal_ref text,
  add column if not exists default_for text,
  add column if not exists default_legal_ref text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tax_form_default_for_valido') then
    alter table public.tax_form add constraint tax_form_default_for_valido
      check (default_for is null or default_for in ('company_not_sii'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tax_form_anual_con_norma') then
    alter table public.tax_form add constraint tax_form_anual_con_norma
      check ((annual_form_code is null) = (annual_legal_ref is null) and (default_for is null) = (default_legal_ref is null));
  end if;
end $$;

comment on column public.tax_form.annual_form_code is 'El resumen anual de este modelo periódico (respuesta 3 del C00).';
comment on column public.tax_form.annual_legal_ref is 'La norma que obliga a presentar ese resumen anual.';
comment on column public.tax_form.default_for is 'Para quién va por defecto (company_not_sii: toda sociedad que no lleva el SII).';
comment on column public.tax_form.default_legal_ref is 'La norma por la que va por defecto, y su excepción.';

-- ── Sus fuentes, como en la 0130 regenerada (en una base donde ya estaba, faltan) ──
insert into public.official_source (key, name, url, sha256, downloaded_at) values ('ley-27-2014', 'Ley 27/2014, del Impuesto sobre Sociedades', 'https://www.boe.es/buscar/act.php?id=BOE-A-2014-12328', 'b4c361a501d09e5780f3da3c591e335b5a0d895f4efaded5fe529f411229fcf8', '2026-10-03T16:36:09.317Z') on conflict (key) do nothing;
insert into public.official_source (key, name, url, sha256, downloaded_at) values ('orden-modelo-190', 'Orden que aprueba el modelo 190', 'https://www.boe.es/buscar/act.php?id=BOE-A-2009-18567', '5f1e9bd065b52344c46b8f991f69a533da87e231b7e1a68d5bf835ce4592fa87', '2026-10-03T16:36:09.317Z') on conflict (key) do nothing;

-- ── Las filas que faltaban: 190 y 200 (como en la 0130 regenerada) ──────────
insert into public.tax_form (code, name, description, legal_ref, verified_at, source_key) values
  ('190', 'Resumen anual de retenciones', 'En enero resumes las retenciones de todo el año.', 'Orden EHA/3127/2009, de 10 de noviembre, por la que se aprueba el modelo 190 para la declaración del resumen anual de retenciones e ingresos a cuenta del Impuesto sobre la Renta de las Personas Físicas sobre rendimientos del trabajo y de actividades económicas, premios y determinadas ganancias patrimoniales e imputaciones de renta y se modifican las condiciones para la presentación por vía telemática de los modelos 111 y 117 por los obligados tributarios que tengan la consideración de grandes empresas, así como la hoja interior de relación de socios, herederos, comuneros o partícipes del modelo 184 y los diseños lógicos de los modelos 184 y 193', '2026-10-03', 'orden-modelo-190'),
  ('200', 'Impuesto sobre Sociedades', 'En julio declaras el Impuesto sobre Sociedades del año.', 'Ley 27/2014, art. 124.1 (el modelo de cada ejercicio lo aprueba una orden anual de Hacienda; la vigente no está en la base consolidada del BOE)', '2026-10-03', 'ley-27-2014')
on conflict (code) do nothing;

-- ── La regla, fila a fila (de docs/conta/referencia/serie.json) ────────────
update public.tax_form set description = null, annual_form_code = '390', annual_legal_ref = 'Ley 37/1992, art. 164.Uno.6.º', default_for = null, default_legal_ref = null where code = '303';
update public.tax_form set description = 'En enero resumes el IVA de todo el año.', annual_form_code = null, annual_legal_ref = null, default_for = null, default_legal_ref = null where code = '390';
update public.tax_form set description = null, annual_form_code = '190', annual_legal_ref = 'RD 439/2007 (Reglamento del IRPF), art. 108.2', default_for = null, default_legal_ref = null where code = '111';
update public.tax_form set description = null, annual_form_code = '200', annual_legal_ref = 'Ley 27/2014, art. 124.1', default_for = null, default_legal_ref = null where code = '202';
update public.tax_form set description = 'En febrero declaras a quién has comprado o vendido más de 3.005,06 € en el año.', annual_form_code = null, annual_legal_ref = null, default_for = 'company_not_sii', default_legal_ref = 'RD 1065/2007, arts. 31 a 35; no lo presenta quien lleva el SII (art. 32.e)' where code = '347';
update public.tax_form set description = null, annual_form_code = null, annual_legal_ref = null, default_for = null, default_legal_ref = null where code = '349';
update public.tax_form set description = 'En enero resumes las retenciones de todo el año.', annual_form_code = null, annual_legal_ref = null, default_for = null, default_legal_ref = null where code = '190';
update public.tax_form set description = 'En enero resumes las retenciones del alquiler de todo el año.', annual_form_code = null, annual_legal_ref = null, default_for = null, default_legal_ref = null where code = '180';
update public.tax_form set description = null, annual_form_code = '180', annual_legal_ref = 'RD 439/2007 (Reglamento del IRPF), art. 108.2', default_for = null, default_legal_ref = null where code = '115';
update public.tax_form set description = null, annual_form_code = null, annual_legal_ref = null, default_for = null, default_legal_ref = null where code = '130';
update public.tax_form set description = 'En julio declaras el Impuesto sobre Sociedades del año.', annual_form_code = null, annual_legal_ref = null, default_for = null, default_legal_ref = null where code = '200';

-- ── verified_at: la comprobación del 03/10 ───────────────────────────────
update public.vat_scheme set verified_at = '2026-10-03' where code = 'general' and verified_at is distinct from '2026-10-03';
update public.vat_scheme set verified_at = '2026-10-03' where code = 'simplificado' and verified_at is distinct from '2026-10-03';
update public.vat_scheme set verified_at = '2026-10-03' where code = 'agricultura' and verified_at is distinct from '2026-10-03';
update public.vat_scheme set verified_at = '2026-10-03' where code = 'bienes_usados' and verified_at is distinct from '2026-10-03';
update public.vat_scheme set verified_at = '2026-10-03' where code = 'oro_inversion' and verified_at is distinct from '2026-10-03';
update public.vat_scheme set verified_at = '2026-10-03' where code = 'agencias_viajes' and verified_at is distinct from '2026-10-03';
update public.vat_scheme set verified_at = '2026-10-03' where code = 'recargo_equivalencia' and verified_at is distinct from '2026-10-03';
update public.vat_scheme set verified_at = '2026-10-03' where code = 'ventas_distancia' and verified_at is distinct from '2026-10-03';
update public.vat_scheme set verified_at = '2026-10-03' where code = 'grupo_entidades' and verified_at is distinct from '2026-10-03';
update public.vat_scheme set verified_at = '2026-10-03' where code = 'criterio_caja' and verified_at is distinct from '2026-10-03';
update public.tax_form set verified_at = '2026-10-03' where code = '303' and verified_at is distinct from '2026-10-03';
update public.tax_form set verified_at = '2026-10-03' where code = '390' and verified_at is distinct from '2026-10-03';
update public.tax_form set verified_at = '2026-10-03' where code = '111' and verified_at is distinct from '2026-10-03';
update public.tax_form set verified_at = '2026-10-03' where code = '202' and verified_at is distinct from '2026-10-03';
update public.tax_form set verified_at = '2026-10-03' where code = '347' and verified_at is distinct from '2026-10-03';
update public.tax_form set verified_at = '2026-10-03' where code = '349' and verified_at is distinct from '2026-10-03';
update public.tax_form set verified_at = '2026-10-03' where code = '190' and verified_at is distinct from '2026-10-03';
update public.tax_form set verified_at = '2026-10-03' where code = '180' and verified_at is distinct from '2026-10-03';
update public.tax_form set verified_at = '2026-10-03' where code = '115' and verified_at is distinct from '2026-10-03';
update public.tax_form set verified_at = '2026-10-03' where code = '130' and verified_at is distinct from '2026-10-03';
update public.tax_form set verified_at = '2026-10-03' where code = '200' and verified_at is distinct from '2026-10-03';
update public.tax_rate set verified_at = '2026-10-03' where code = 'iva_general' and valid_from = '2012-09-01' and is_system and verified_at is distinct from '2026-10-03';
update public.tax_rate set verified_at = '2026-10-03' where code = 'iva_reducido' and valid_from = '2012-09-01' and is_system and verified_at is distinct from '2026-10-03';
update public.tax_rate set verified_at = '2026-10-03' where code = 'iva_superreducido' and valid_from = '2012-09-01' and is_system and verified_at is distinct from '2026-10-03';
update public.tax_rate set verified_at = '2026-10-03' where code = 'iva_basicos_4t2024' and valid_from = '2024-10-01' and is_system and verified_at is distinct from '2026-10-03';
update public.tax_rate set verified_at = '2026-10-03' where code = 'iva_pasta_semillas_4t2024' and valid_from = '2024-10-01' and is_system and verified_at is distinct from '2026-10-03';
update public.tax_rate set verified_at = '2026-10-03' where code = 'exento' and valid_from = '1993-01-01' and is_system and verified_at is distinct from '2026-10-03';
update public.tax_rate set verified_at = '2026-10-03' where code = 'ue_compra' and valid_from = '2012-09-01' and is_system and verified_at is distinct from '2026-10-03';
update public.tax_rate set verified_at = '2026-10-03' where code = 'isp' and valid_from = '2012-09-01' and is_system and verified_at is distinct from '2026-10-03';
update public.tax_rate set verified_at = '2026-10-03' where code = 'igic_cero' and valid_from = '2024-01-01' and is_system and verified_at is distinct from '2026-10-03';
update public.tax_rate set verified_at = '2026-10-03' where code = 'igic_reducido_3' and valid_from = '2024-01-01' and is_system and verified_at is distinct from '2026-10-03';
update public.tax_rate set verified_at = '2026-10-03' where code = 'igic_reducido_5' and valid_from = '2024-01-01' and is_system and verified_at is distinct from '2026-10-03';
update public.tax_rate set verified_at = '2026-10-03' where code = 'igic_general' and valid_from = '2024-01-01' and is_system and verified_at is distinct from '2026-10-03';
update public.tax_rate set verified_at = '2026-10-03' where code = 'igic_incrementado_95' and valid_from = '2024-01-01' and is_system and verified_at is distinct from '2026-10-03';
update public.tax_rate set verified_at = '2026-10-03' where code = 'igic_incrementado_15' and valid_from = '2024-01-01' and is_system and verified_at is distinct from '2026-10-03';
update public.tax_rate set verified_at = '2026-10-03' where code = 'igic_especial' and valid_from = '2024-01-01' and is_system and verified_at is distinct from '2026-10-03';
update public.withholding_rate set verified_at = '2026-10-03' where code = 'profesional' and valid_from = '2023-01-26' and is_system and verified_at is distinct from '2026-10-03';
update public.withholding_rate set verified_at = '2026-10-03' where code = 'profesional_inicio' and valid_from = '2023-01-26' and is_system and verified_at is distinct from '2026-10-03';
update public.withholding_rate set verified_at = '2026-10-03' where code = 'administradores' and valid_from = '2023-12-07' and is_system and verified_at is distinct from '2026-10-03';
update public.withholding_rate set verified_at = '2026-10-03' where code = 'alquiler' and valid_from = '2018-12-23' and is_system and verified_at is distinct from '2026-10-03';
update public.withholding_rate set verified_at = '2026-10-03' where code = 'capital' and valid_from = '2018-12-23' and is_system and verified_at is distinct from '2026-10-03';
update public.payment_method set verified_at = '2026-10-03' where code = 'transferencia' and is_system and verified_at is distinct from '2026-10-03';
update public.payment_method set verified_at = '2026-10-03' where code = 'domiciliacion' and is_system and verified_at is distinct from '2026-10-03';
update public.payment_method set verified_at = '2026-10-03' where code = 'tarjeta' and is_system and verified_at is distinct from '2026-10-03';
update public.payment_method set verified_at = '2026-10-03' where code = 'efectivo' and is_system and verified_at is distinct from '2026-10-03';
update public.payment_term set verified_at = '2026-10-03' where code = 'contado' and is_system and verified_at is distinct from '2026-10-03';
update public.payment_term set verified_at = '2026-10-03' where code = '30_dias' and is_system and verified_at is distinct from '2026-10-03';
update public.payment_term set verified_at = '2026-10-03' where code = '60_dias' and is_system and verified_at is distinct from '2026-10-03';
update public.payment_term set verified_at = '2026-10-03' where code = '30_60_dias' and is_system and verified_at is distinct from '2026-10-03';
update public.entry_text set verified_at = '2026-10-03' where code = 'su_factura' and is_system and verified_at is distinct from '2026-10-03';
update public.entry_text set verified_at = '2026-10-03' where code = 'nuestra_factura' and is_system and verified_at is distinct from '2026-10-03';
update public.entry_text set verified_at = '2026-10-03' where code = 'pago_factura' and is_system and verified_at is distinct from '2026-10-03';
update public.entry_text set verified_at = '2026-10-03' where code = 'cobro_factura' and is_system and verified_at is distinct from '2026-10-03';
update public.expense_category set verified_at = '2026-10-03' where code = 'food_beverage' and is_system and verified_at is distinct from '2026-10-03';
update public.expense_category set verified_at = '2026-10-03' where code = 'packaging' and is_system and verified_at is distinct from '2026-10-03';
update public.expense_category set verified_at = '2026-10-03' where code = 'cleaning_tableware' and is_system and verified_at is distinct from '2026-10-03';
update public.expense_category set verified_at = '2026-10-03' where code = 'rent' and is_system and verified_at is distinct from '2026-10-03';
update public.expense_category set verified_at = '2026-10-03' where code = 'repairs' and is_system and verified_at is distinct from '2026-10-03';
update public.expense_category set verified_at = '2026-10-03' where code = 'professional' and is_system and verified_at is distinct from '2026-10-03';
update public.expense_category set verified_at = '2026-10-03' where code = 'transport' and is_system and verified_at is distinct from '2026-10-03';
update public.expense_category set verified_at = '2026-10-03' where code = 'insurance' and is_system and verified_at is distinct from '2026-10-03';
update public.expense_category set verified_at = '2026-10-03' where code = 'bank_platform_fees' and is_system and verified_at is distinct from '2026-10-03';
update public.expense_category set verified_at = '2026-10-03' where code = 'advertising' and is_system and verified_at is distinct from '2026-10-03';
update public.expense_category set verified_at = '2026-10-03' where code = 'utilities' and is_system and verified_at is distinct from '2026-10-03';
update public.expense_category set verified_at = '2026-10-03' where code = 'other_services' and is_system and verified_at is distinct from '2026-10-03';

update public.legal_form set verified_at = '2026-10-03' where code = 'persona_fisica' and verified_at is distinct from '2026-10-03';

-- ── Aceptar una sugerencia de modelo añade también su anual ─────────────────
create or replace function public.conta_sugerencia_responder(p_sugerencia uuid, p_acepta boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.ai_suggestion; v_modelos text[]; v_nuevos text[]; v_anual text; v_log uuid;
begin
  select * into s from public.ai_suggestion where id = p_sugerencia for update;
  if s.id is null then raise exception 'No encuentro esa sugerencia' using errcode = '42501'; end if;
  perform public.conta_ia_cuenta(s.company_id);
  if s.status <> 'open' then raise exception 'Esa sugerencia ya está contestada' using errcode = '23514'; end if;
  v_nuevos := '{}';
  if p_acepta then
    if s.kind = 'modelo' then
      select coalesce(tax_forms, '{}') into v_modelos from public.company_tax_profile where company_id = s.company_id;
      v_modelos := coalesce(v_modelos, '{}');
      if not ((s.payload ->> 'modelo') = any(v_modelos)) then v_nuevos := v_nuevos || (s.payload ->> 'modelo'); end if;
      -- Respuesta 3: todo periódico lleva su anual, según la tabla de modelos.
      select annual_form_code into v_anual from public.tax_form where code = (s.payload ->> 'modelo');
      if v_anual is not null and not (v_anual = any(v_modelos)) then v_nuevos := v_nuevos || v_anual; end if;
      if cardinality(v_nuevos) > 0 then
        v_log := public.conta_ia_poner(s.company_id, 'company_tax_profile', 'tax_forms',
                   to_jsonb((select array_agg(m order by m) from unnest(v_modelos || v_nuevos) m)),
                   s.why || case when v_anual = any(v_nuevos) then ' Con su resumen anual, el ' || v_anual || '.' else '' end, 'ai');
        update public.ai_action_log set suggestion_id = s.id where id = v_log;
      end if;
    end if;
  end if;
  update public.ai_suggestion
     set status = case when p_acepta then 'accepted' else 'rejected' end,
         decided_at = now(), decided_by = auth.uid(), decided_by_name = public.conta_nombre_actor()
   where id = s.id;
  return jsonb_build_object('id', s.id, 'aceptada', p_acepta, 'registro', v_log, 'anadidos', to_jsonb(v_nuevos));
end $$;

revoke all on function public.conta_sugerencia_responder(uuid, boolean) from public, anon;
grant execute on function public.conta_sugerencia_responder(uuid, boolean) to authenticated;
