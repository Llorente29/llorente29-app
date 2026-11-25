-- supabase/vuelta-atras/20261125T1649_x14e_ajustar_a_erp10.down.sql
-- X14 · 2 · Devuelve a como estaban antes del ajuste a ERP10 las cargas ajustadas (en producción, solo el 2024 de QBO), con lo
-- que el ajuste dejó apuntado en cada una (detail.ajuste_erp10): los enlaces, los nombres de las cuentas y los códigos de
-- cliente, en orden inverso.
do $$
declare v_r public.import_run; v_a jsonb; x jsonb;
begin
  for v_r in select * from public.import_run where kind = 'carga' and detail ? 'ajuste_erp10' order by (detail->'ajuste_erp10'->>'el') desc loop
  v_a := v_r.detail->'ajuste_erp10'->'deshacer';
  for x in select value from jsonb_array_elements(coalesce(v_a->'codigos', '[]')) with ordinality e(value, o) order by o desc loop
    if (x->>'fila')::boolean then
      update public.conta_cobro_cliente set codigo_cliente = (x->>'antes')::int, updated_at = now(), updated_by_name = 'X14 · 2 · vuelta atrás'
       where company_id = v_r.company_id and party_id = (x->>'party')::uuid;
    else
      delete from public.conta_cobro_cliente where company_id = v_r.company_id and party_id = (x->>'party')::uuid;
    end if;
  end loop;
  update public.company_account a set name = y->>'name' from jsonb_array_elements(coalesce(v_a->'nombres', '[]')) y where a.id = (y->>'id')::uuid;
  perform public._conta_traer_como_erp10_deshacer(v_a->'enlaces');
  update public.import_run set detail = detail - 'ajuste_erp10' where id = v_r.id;
  end loop;
end $$;
