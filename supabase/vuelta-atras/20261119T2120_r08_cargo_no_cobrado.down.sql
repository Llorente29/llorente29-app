-- R08 · la vuelta atrás de 2120: el detector vuelve, byte a byte, al de antes (del respaldo) y se
-- quita la función nueva. Lo que ya se apartó se queda apartado (se reabre con «Volver a abrirlo»).
drop function if exists public.bank_apartar_no_cobrados(uuid);
select public._restaurar_funcion('public._bank_cargos_anulados(uuid)', '20261119T2120_r08_cargo_no_cobrado');
