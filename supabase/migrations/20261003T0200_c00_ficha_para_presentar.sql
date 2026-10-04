-- ============================================================================
-- C00 · Respuesta 3 de Julio, punto 5 · La ficha de la empresa tiene que
-- bastar para presentar
-- ----------------------------------------------------------------------------
-- Al presentar el modelo 200, depositar las cuentas anuales en el Registro
-- Mercantil y algunos informativos se piden datos de la empresa que tienen que
-- estar YA en su ficha, no pedirse en el momento. Cruzados campo a campo con
-- la página 1 del 200 y la hoja de datos generales de identificación del
-- depósito: docs/conta/C00_ficha_vs_modelos.md. Lo que faltaba:
--
--   company        fecha de constitución; correo y teléfono de notificaciones
--                  (DEHú). Los datos registrales ya tenían sus columnas
--                  (registro, tomo, folio, hoja, inscripción): faltaba la
--                  pantalla, que va con esto.
--   fiscal_year    plantilla media (fija y no fija) y auditoría (si se auditó,
--                  el auditor y su opinión): son de cada ejercicio.
--   company_person quién firma las cuentas anuales.
--   company_relation  si la otra es la entidad dominante del grupo.
--
-- El certificado digital NO va aquí: va en «Certificados y accesos», cifrado y
-- con quién puede usarlo (pendiente del encargo de impuestos).
--
-- Solo añade columnas. conta_ia_campo_permitido conserva su firma (create or
-- replace sin parámetros nuevos, regla 2): la IA podrá poner los datos nuevos
-- de company con su porqué y su marca, como el resto.
--
-- Banda: tablas y función de contabilidad; ninguna en el camino del pedido.
-- ============================================================================

alter table public.company
  add column if not exists incorporated_on date,
  add column if not exists dehu_email text,
  add column if not exists dehu_phone text;

alter table public.fiscal_year
  add column if not exists average_staff_fixed numeric(9, 2),
  add column if not exists average_staff_temporary numeric(9, 2),
  add column if not exists is_audited boolean,
  add column if not exists auditor_name text,
  add column if not exists auditor_tax_id text,
  add column if not exists audit_opinion text;

alter table public.company_person
  add column if not exists signs_accounts boolean not null default false;

alter table public.company_relation
  add column if not exists related_is_parent boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'company_dehu_email_valido') then
    alter table public.company add constraint company_dehu_email_valido
      check (dehu_email is null or dehu_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fiscal_year_plantilla_positiva') then
    alter table public.fiscal_year add constraint fiscal_year_plantilla_positiva
      check (coalesce(average_staff_fixed, 0) >= 0 and coalesce(average_staff_temporary, 0) >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fiscal_year_opinion_valida') then
    alter table public.fiscal_year add constraint fiscal_year_opinion_valida
      check (audit_opinion is null or audit_opinion in ('favorable', 'con_salvedades', 'desfavorable', 'denegada'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fiscal_year_auditoria_coherente') then
    alter table public.fiscal_year add constraint fiscal_year_auditoria_coherente
      check (is_audited is true or (auditor_name is null and auditor_tax_id is null and audit_opinion is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'company_relation_dominante_es_grupo') then
    alter table public.company_relation add constraint company_relation_dominante_es_grupo
      check (not related_is_parent or kind = 'group');
  end if;
end $$;

comment on column public.company.incorporated_on is 'Fecha de constitución (modelo 200 y depósito de cuentas). Respuesta 3 del C00.';
comment on column public.company.dehu_email is 'Correo de los avisos de notificaciones (DEHú).';
comment on column public.company.dehu_phone is 'Teléfono de los avisos de notificaciones (DEHú).';
comment on column public.fiscal_year.average_staff_fixed is 'Plantilla media fija del ejercicio (modelo 200 y depósito).';
comment on column public.fiscal_year.average_staff_temporary is 'Plantilla media no fija del ejercicio.';
comment on column public.fiscal_year.is_audited is 'Si las cuentas del ejercicio están auditadas; null = sin decir.';
comment on column public.company_person.signs_accounts is 'Firma las cuentas anuales (depósito en el Registro Mercantil).';
comment on column public.company_relation.related_is_parent is 'La otra es la entidad dominante del grupo (modelo 200).';

create or replace function public.conta_ia_campo_permitido(p_tabla text, p_campo text)
 returns boolean
 language sql
 immutable
as $function$
  select (p_tabla = 'company' and p_campo in ('legal_name', 'trade_name', 'legal_form_code', 'fiscal_street_type',
            'fiscal_street', 'fiscal_number', 'fiscal_postal_code', 'fiscal_city', 'fiscal_province',
            'incorporated_on', 'dehu_email', 'dehu_phone', 'registry_name', 'registry_volume', 'registry_folio',
            'registry_sheet', 'registry_entry'))
      or (p_tabla = 'company_tax_profile' and p_campo in ('tax_territory', 'vat_scheme_code', 'vat_period', 'vat_cash_basis',
            'vat_surcharge', 'chart_kind', 'account_digits', 'tax_forms', 'sales_tax_rate_code'))
$function$;
