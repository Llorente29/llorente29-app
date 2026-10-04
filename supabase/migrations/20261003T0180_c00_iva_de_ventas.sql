-- ============================================================================
-- C00 · Respuesta 3 de Julio · El IVA de tus ventas
-- ----------------------------------------------------------------------------
-- El alta nueva dice «Lo he apuntado como comida a domicilio y el IVA de tus
-- ventas al 10 %». Hasta hoy ese dato no se guardaba en ningún sitio: se
-- guarda en el perfil fiscal de la empresa, como código de la fila de serie de
-- Impuestos (tax_rate.code: iva_reducido, iva_general…), y la IA lo puede
-- poner con su porqué (conta_ia_campo_permitido).
--
-- Criterio de Foodint (respuesta 2, pendiente de confirmación del asesor
-- fiscal): restauración, también solo a domicilio, al 10 % unificado (Ley
-- 37/1992, art. 91.Uno.2.2.º).
--
-- Pendiente, y no es esto: el IVA de las ventas POR CANAL, configurable por
-- empresa en «Tus impuestos» (respuesta 2). Esta columna es el de la empresa.
--
-- Solo añade. conta_ia_campo_permitido conserva su firma (create or replace
-- sin parámetros nuevos: no crea sobrecarga, regla 2).
--
-- Banda: company_tax_profile y conta_ia_campo_permitido son de contabilidad;
-- no están en el camino del pedido (contarlo en pg_proc, cron.job y
-- pg_trigger antes de aplicar en producción).
-- ============================================================================

alter table public.company_tax_profile
  add column if not exists sales_tax_rate_code text;

comment on column public.company_tax_profile.sales_tax_rate_code is
  'El IVA de las ventas de la empresa (tax_rate.code de la fila de serie). Lo propone el alta por la actividad; respuesta 3 del C00.';

create or replace function public.conta_ia_campo_permitido(p_tabla text, p_campo text)
 returns boolean
 language sql
 immutable
as $function$
  select (p_tabla = 'company' and p_campo in ('legal_name', 'trade_name', 'legal_form_code', 'fiscal_street_type',
            'fiscal_street', 'fiscal_number', 'fiscal_postal_code', 'fiscal_city', 'fiscal_province'))
      or (p_tabla = 'company_tax_profile' and p_campo in ('tax_territory', 'vat_scheme_code', 'vat_period', 'vat_cash_basis',
            'vat_surcharge', 'chart_kind', 'account_digits', 'tax_forms', 'sales_tax_rate_code'))
$function$;
