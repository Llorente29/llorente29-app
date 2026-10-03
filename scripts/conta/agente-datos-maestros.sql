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
  'recuentos', json_build_object(
    'country',     (select count(*) from public.country),
    'currency',    (select count(*) from public.currency),
    'iae_heading', (select count(*) from public.iae_heading),
    'cnae_code',   (select count(*) from public.cnae_code where version = '2025')
  )
);
