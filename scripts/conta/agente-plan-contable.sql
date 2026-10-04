-- scripts/conta/agente-plan-contable.sql
--
-- Agente «Plan contable» (C02 §4): lo que hay en la base, para compararlo con
-- supabase/conta/pgc/serie.json. SOLO LEE. Devuelve una fila con un JSON.
--
--   psql "$STAGING_CONTA_DB_URL" -At -v ON_ERROR_STOP=1 -f scripts/conta/agente-plan-contable.sql > bd.json
--
-- pgc_account es un catálogo global sin account_id (excepción declarada): se
-- lee entero a propósito (regla 9).
select json_build_object(
  'pgc_account', (select coalesce(json_agg(json_build_object(
      'plan', p.plan, 'code', p.code, 'name', p.name, 'boe_name', p.boe_name, 'correction_kind', p.correction_kind,
      'plain_name', p.plain_name, 'group_code', p.group_code, 'parent_code', p.parent_code, 'is_leaf', p.is_leaf,
      'valid_from', p.valid_from, 'valid_to', p.valid_to, 'source_key', p.source_key) order by p.plan, p.code), '[]')
    from public.pgc_account p),
  -- Empresa por empresa (tarea 3). Cada fila lleva su account_id (regla 9).
  'empresas_plan', (select coalesce(json_agg(json_build_object(
      'id', c.id, 'account_id', c.account_id, 'legal_name', c.legal_name,
      'chart_kind', p.chart_kind, 'account_digits', p.account_digits, 'tax_territory', p.tax_territory)), '[]')
    from public.company c join public.company_tax_profile p on p.company_id = c.id),
  'company_account', (select coalesce(json_agg(json_build_object(
      'id', a.id, 'account_id', a.account_id, 'company_id', a.company_id, 'plan', a.plan, 'code', a.code,
      'template_code', a.template_code, 'kind', a.kind, 'status', a.status)), '[]')
    from public.company_account a),
  'company_account_link', (select coalesce(json_agg(json_build_object(
      'company_id', l.company_id, 'company_account_id', l.company_account_id, 'entity', l.entity, 'entity_id', l.entity_id, 'role', l.role)), '[]')
    from public.company_account_link l),
  'tipos_vigentes', (select coalesce(json_agg(json_build_object(
      'id', t.id::text, 'code', t.code, 'rate', t.rate, 'tax_system', t.tax_system, 'is_system', t.is_system, 'account_id', t.account_id)), '[]')
    from public.tax_rate t where t.treatment = 'taxed' and (t.valid_to is null or t.valid_to >= current_date))
);
