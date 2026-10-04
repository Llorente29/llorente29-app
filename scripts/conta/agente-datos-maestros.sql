-- scripts/conta/agente-datos-maestros.sql
--
-- Agente de cumplimiento «Datos maestros e impuestos» (C00 §9.2): lo que hay
-- en la base, para compararlo con docs/conta/referencia/serie.json. SOLO LEE.
-- Devuelve una fila con un JSON. Lo corre el workflow nocturno con psql:
--
--   psql "$STAGING_CONTA_DB_URL" -At -v ON_ERROR_STOP=1 -f scripts/conta/agente-datos-maestros.sql > bd.json
--
-- Solo las filas DE SERIE (is_system): las propias de cada cuenta no salen de
-- ninguna fuente oficial y no se comparan. Los catálogos globales sin
-- is_system (vat_scheme, tax_form, legal_form) son de serie enteros. Regla 9:
-- aquí no se ancla nada por nombre ni se cuenta nada de una cuenta.

select json_build_object(
  'tablas', json_build_object(
    'tax_rate',         (select coalesce(json_agg(row_to_json(t) order by t.code, t.valid_from), '[]') from public.tax_rate t where t.is_system),
    'withholding_rate', (select coalesce(json_agg(row_to_json(t) order by t.code, t.valid_from), '[]') from public.withholding_rate t where t.is_system),
    'payment_method',   (select coalesce(json_agg(row_to_json(t) order by t.code), '[]') from public.payment_method t where t.is_system),
    'payment_term',     (select coalesce(json_agg(row_to_json(t) order by t.code), '[]') from public.payment_term t where t.is_system),
    'entry_text',       (select coalesce(json_agg(row_to_json(t) order by t.code), '[]') from public.entry_text t where t.is_system),
    'expense_category', (select coalesce(json_agg(row_to_json(t) order by t.code), '[]') from public.expense_category t where t.is_system),
    'vat_scheme',       (select coalesce(json_agg(row_to_json(t) order by t.code), '[]') from public.vat_scheme t),
    'tax_form',         (select coalesce(json_agg(row_to_json(t) order by t.code), '[]') from public.tax_form t),
    'legal_form',       (select coalesce(json_agg(row_to_json(t) order by t.code), '[]') from public.legal_form t),
    'vat_category_tax', (select coalesce(json_agg(json_build_object(
                            'category_code', c.code, 'tax_code', b.tax_code, 'valid_from', b.valid_from,
                            'valid_to', b.valid_to, 'note', b.note) order by c.code, b.valid_from), '[]')
                         from public.vat_category_tax b join public.vat_category c on c.id = b.vat_category_id)
  ),
  -- Coherencia (respuesta 3, punto 4): empresa por empresa, de todas las cuentas
  -- de esta base. Cada fila lleva su account_id (regla 9): el informe dice de
  -- qué cuenta es cada caso. Solo lee.
  'empresas', (select coalesce(json_agg(json_build_object(
      'id', c.id, 'account_id', c.account_id, 'legal_name', c.legal_name, 'entity_kind', c.entity_kind,
      'completa', c.setup_completed_at is not null,
      'tax_territory', p.tax_territory, 'tax_forms', p.tax_forms, 'sii', p.sii, 'sales_tax_rate_code', p.sales_tax_rate_code,
      'account_digits', p.account_digits,
      -- Lo que piden el 200 y el depósito (respuesta 3, punto 5).
      'tax_id', c.tax_id, 'legal_form_code', c.legal_form_code, 'fiscal_street', c.fiscal_street,
      'fiscal_postal_code', c.fiscal_postal_code, 'fiscal_city', c.fiscal_city, 'incorporated_on', c.incorporated_on,
      'registry_name', c.registry_name, 'registry_volume', c.registry_volume, 'registry_folio', c.registry_folio,
      'registry_sheet', c.registry_sheet, 'registry_entry', c.registry_entry, 'phone', c.phone, 'email', c.email,
      'dehu_email', c.dehu_email,
      'actividades', (select coalesce(json_agg(json_build_object('description', a.description, 'iae_code', a.iae_code,
                        'cnae_code', a.cnae_code, 'ended_on', a.ended_on, 'is_main', a.is_main) order by a.is_main desc, a.created_at), '[]')
                      from public.company_activity a where a.company_id = c.id),
      'personas', (select coalesce(json_agg(json_build_object('roles', x.roles, 'tax_id_puesto', x.tax_id is not null,
                        'ownership_pct', x.ownership_pct, 'signs_accounts', x.signs_accounts, 'ended_on', x.ended_on)), '[]')
                   from public.company_person x where x.company_id = c.id),
      'ejercicios', (select coalesce(json_agg(json_build_object('code', y.code, 'status', y.status, 'starts_on', y.starts_on,
                        'ends_on', y.ends_on, 'average_staff_fixed', y.average_staff_fixed, 'average_staff_temporary', y.average_staff_temporary,
                        'is_audited', y.is_audited, 'auditor_name', y.auditor_name, 'audit_opinion', y.audit_opinion) order by y.starts_on), '[]')
                     from public.fiscal_year y where y.company_id = c.id)
    ) order by c.account_id, c.created_at), '[]')
    from public.company c left join public.company_tax_profile p on p.company_id = c.id where c.is_active),
  'plazos', (select coalesce(json_agg(json_build_object('account_id', t.account_id, 'is_system', t.is_system, 'code', t.code,
      'name', t.name, 'days', t.days) order by t.is_system desc, t.account_id, t.code), '[]') from public.payment_term t),
  'proveedores_plazo', (select coalesce(json_agg(json_build_object('account_id', s.account_id, 'name', s.name,
      'payment_terms_days', s.payment_terms_days) order by s.account_id, s.name), '[]')
    from public.supplier s where s.payment_terms_days > 60 and s.is_active is not false),
  -- C01b (respuesta 1, decisión 8): todo IVA habitual de un proveedor apunta a
  -- un tax_rate que existe, es de serie o de su cuenta y vale hoy. Se lee con
  -- to_jsonb(s) para no fallar en una base donde la columna aún no existe
  -- (producción antes de la tanda de datos del C01b): ahí sale vacío.
  'proveedores_iva', (select coalesce(json_agg(json_build_object('account_id', s.account_id, 'name', s.name,
      'tax_rate_id', x.id, 'code', t.code, 'valid_from', t.valid_from, 'valid_to', t.valid_to,
      'motivo', case when t.id is null then 'no_existe'
                     when not t.is_system and t.account_id is distinct from s.account_id then 'otra_cuenta'
                     else 'no_vigente' end) order by s.account_id, s.name), '[]')
    from public.supplier s
    cross join lateral jsonb_array_elements_text(coalesce(to_jsonb(s)->'usual_tax_rate_ids', '[]'::jsonb)) x(id)
    left join public.tax_rate t on t.id::text = x.id
    where s.is_active is not false
      and (t.id is null
           or (not t.is_system and t.account_id is distinct from s.account_id)
           or t.valid_from > current_date
           or (t.valid_to is not null and t.valid_to < current_date))),
  'cuentas_apunte', (select coalesce(json_agg(json_build_object('account_id', s.account_id, 'name', s.name,
      'ledger_account_code', s.ledger_account_code, 'account_digits', d.digitos) order by s.account_id, s.name), '[]')
    from public.supplier s
    join (select c.account_id, max(p.account_digits) digitos from public.company c
            join public.company_tax_profile p on p.company_id = c.id group by c.account_id) d on d.account_id = s.account_id
    where s.ledger_account_code is not null),
  'recuentos', json_build_object(
    'country',     (select count(*) from public.country),
    'currency',    (select count(*) from public.currency),
    'iae_heading', (select count(*) from public.iae_heading),
    'cnae_code',   (select count(*) from public.cnae_code where version = '2025')
  )
);
