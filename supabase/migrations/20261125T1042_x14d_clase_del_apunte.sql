-- supabase/migrations/20261125T1042_x14d_clase_del_apunte.sql
--
-- X14 · 2 (Julio, 25/11): el 2024 de QBO para en conta_traer_seguir con journal_line_debe_o_haber, que exige
-- (debit > 0) <> (credit > 0). Antes de proponer cómo tratarlas, se mide cuántas líneas de lo leído de ERP10 vienen con 0 en
-- los dos lados, con importe en los dos o con negativos (scripts/conta/produccion/cuentas/x14d-lineas.sql, en el ensayo).
--
-- Solo AÑADE una función nueva que no lee ninguna tabla: la clase de una línea de lo leído, con la misma regla que la medida.
-- La usará el arreglo de conta_traer_seguir; hoy no la llama nadie. Nada en el camino del pedido. No cambia ninguna fila.
--   normal                  · un solo lado, positivo: entra tal cual.
--   ceros                   · 0 al debe y 0 al haber.
--   dos_lados               · importe en el debe y en el haber, los dos positivos.
--   dos_lados_con_negativo  · importe en los dos, y alguno negativo.
--   negativo_debe           · solo el debe, y negativo.
--   negativo_haber          · solo el haber, y negativo.
create or replace function public._conta_traer_clase_apunte(p_debe numeric, p_haber numeric)
returns text language sql immutable set search_path = public as $$
  select case when coalesce(p_debe, 0) = 0 and coalesce(p_haber, 0) = 0 then 'ceros'
              when coalesce(p_debe, 0) > 0 and coalesce(p_haber, 0) > 0 then 'dos_lados'
              when coalesce(p_debe, 0) <> 0 and coalesce(p_haber, 0) <> 0 then 'dos_lados_con_negativo'
              when coalesce(p_debe, 0) < 0 then 'negativo_debe'
              when coalesce(p_haber, 0) < 0 then 'negativo_haber'
              else 'normal' end
$$;
comment on function public._conta_traer_clase_apunte(numeric, numeric) is
  'X14 · 2: la clase de una línea de lo leído de otro programa (normal, ceros, dos_lados, dos_lados_con_negativo, negativo_debe, negativo_haber). No lee tablas.';
revoke all on function public._conta_traer_clase_apunte(numeric, numeric) from public, anon, authenticated;
grant execute on function public._conta_traer_clase_apunte(numeric, numeric) to service_role;
