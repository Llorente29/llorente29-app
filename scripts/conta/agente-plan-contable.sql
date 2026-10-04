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
    from public.pgc_account p)
);
