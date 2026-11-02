-- supabase/migrations/20261102T0929_s01o3_comun_por_defecto.sql
-- cambia: public._conta_factura_segura · prueba: supabase/staging/sql/20261102_s01o3_comun_prueba.sql
--
-- S01o·3 · «Común a todos los locales» como local por defecto de un proveedor
-- (Julio, 02/11, respuesta 8). Anthropic, el software, la gestoría, los seguros…
-- son gasto de la empresa entera, no de un local. La contabilidad ya lo admite
-- (journal_line.is_common) y Bancos ya lo usa («Común a todos»).
--   1. supplier.default_common: «Común a todos los locales» en su ficha.
--   2. La regla «segura» (0005) lo acepta como local: sin local y común, ya no es
--      «Falta su local»; el apunte va común (sin local), como ya hacía el apunte
--      cuando no hay local, y su porqué lo dice.
-- Misma firma, sobre la definición VIVA, con su respaldo.

alter table public.supplier add column if not exists default_common boolean not null default false;
comment on column public.supplier.default_common is 'S01o·3 · Su gasto es común a todos los locales (sin local por defecto): sus facturas se apuntan comunes.';

select public._respaldar_funcion('public._conta_factura_segura(uuid)', '20261102T0929_s01o3_comun_por_defecto');

do $$
declare v_def text := pg_get_functiondef('public._conta_factura_segura(uuid)'::regprocedure); v_n int; v_antes text;
begin
  v_antes := '  if v_local is null and exists (select 1 from public.conta_eje_analitico x where x.company_id = v.company_id and x.account_id = v.account_id and x.eje = ''local'' and x.activo) then';
  v_n := (length(v_def) - length(replace(v_def, v_antes, ''))) / length(v_antes);
  if v_n <> 1 then raise exception 'S01o·3: _conta_factura_segura no tiene una sola vez el trozo que se cambia (lo tiene % veces): no se cambia nada.', v_n; end if;
  v_def := replace(v_def, v_antes, '  if v_local is null and not coalesce(s.default_common, false)
     and exists (select 1 from public.conta_eje_analitico x where x.company_id = v.company_id and x.account_id = v.account_id and x.eje = ''local'' and x.activo) then');
  v_antes := '  return jsonb_build_object(''seguro'', true, ''regla'', ''factura'', ''porque'', v_por,';
  v_n := (length(v_def) - length(replace(v_def, v_antes, ''))) / length(v_antes);
  if v_n <> 1 then raise exception 'S01o·3: _conta_factura_segura no tiene una sola vez el trozo que se cambia (lo tiene % veces): no se cambia nada.', v_n; end if;
  v_def := replace(v_def, v_antes, '  return jsonb_build_object(''seguro'', true, ''regla'', ''factura'', ''porque'', v_por || case when v_local is null and coalesce(s.default_common, false) then '' Común a todos los locales, como dice su ficha.'' else '''' end,');
  execute v_def;
end $$;
