-- supabase/vuelta-atras/20261125T1649_x14e_ajustar_a_erp10.down.sql
-- X14 · 2 · Devuelve a como estaban antes del ajuste a ERP10 las cargas ajustadas (en producción, solo el 2024 de QBO), con lo
-- que el ajuste dejó apuntado en cada una (detail.ajuste_erp10): los códigos, los nombres de las cuentas y los enlaces.
select public._conta_traer_ajustar_deshacer(r.id) from public.import_run r where r.kind = 'carga' and r.detail ? 'ajuste_erp10'
 order by (r.detail->'ajuste_erp10'->>'el') desc;
