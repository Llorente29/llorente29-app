-- scripts/conta/produccion/cuentas/k11f2-303-otros-datos.sql
--
-- K11f2 · El 303 lee «Otros datos» de la recibida · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Regla 31 (Julio, 22/11: «en los dos, la regla 31 con cada 303 presentado: ni un céntimo distinto»): por empresa (con
-- su cuenta, regla 9), cada 303 PRESENTADO recalculado desde el libro de IVA (conta_impuesto_303_desde_libro, el mismo
-- cálculo que la pantalla) y la huella de su resultado, y la de las casillas guardadas de esa declaración. La tanda solo
-- cambia el 303 de las recibidas con «No incluir en declaración de IVA» o «Rectificación de deducciones» marcadas (del
-- K11a, del 22/11): ninguna en un periodo presentado, así que las dos huellas, iguales antes y después. Corte fijo: lo
-- presentado antes del 22/11/2026.
with p as (
  select r.account_id, r.company_id, r.fiscal_year, r.period, r.id
    from public.tax_return r
   where r.form_code = '303' and r.status in ('filed', 'booked', 'paid', 'offset', 'refunded')
     and r.period ~ '^([1-4]T|0[1-9]|1[0-2])$' and coalesce(r.filed_at, r.updated_at) < timestamptz '2026-11-22 00:00:00+01'
)
select clave, valor from (
  select p.account_id, p.company_id, p.fiscal_year, p.period,
         'cuenta ' || left(p.account_id::text, 8) || ' · empresa ' || left(p.company_id::text, 8) || ' · 303 ' || p.period || ' ' || p.fiscal_year
           || ' · regla 31: recalculado desde el libro · casillas guardadas' clave,
         left(md5(coalesce(public.conta_impuesto_303_desde_libro(p.company_id, p.fiscal_year, p.period)::text, 'sin cálculo')), 12) || ' · '
           || coalesce(left(md5((select string_agg(b.box || '=' || coalesce(b.value::text, ''), ';' order by b.box)
                                   from public.tax_return_box b where b.tax_return_id = p.id)), 12), 'sin casillas') valor
    from p
) t order by account_id, company_id, fiscal_year, period;
