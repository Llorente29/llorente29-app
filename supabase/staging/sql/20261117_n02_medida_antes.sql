-- supabase/staging/sql/20261117_n02_medida_antes.sql
--
-- SOLO STAGING. N02 · la medida de «no he roto nada», ANTES de la tanda (regla
-- 31). Va la primera en la tanda de staging de la rama: corre en su sesión,
-- sin las migraciones del N02 delante. Solo lee, y acaba en ROLLBACK.
--
-- Cuántas empresas tienen hoy _conta_corte no nulo, de todas las cuentas de
-- staging (la cifra es de la base entera, a propósito: es la misma vara que
-- toma después 20261117_n02_carga_prueba.sql). Solo usa _conta_corte, que el
-- N02 no toca: si la 0833 ya está en staging (W05 la aplica de verdad desde la
-- rama, porque solo añade), la medida vale igual, y se dice.

begin;
do $$
declare v_n int; v_total int;
begin
  select count(*), count(*) filter (where public._conta_corte(c.id) is not null) into v_total, v_n from public.company c;
  raise notice 'MEDIDA N02 · antes · empresas = % · con _conta_corte no nulo = % %', v_total, v_n,
    case when to_regprocedure('public.conta_dia_de_inicio(uuid)') is null then '' else ' (la 0833 ya estaba en staging)' end;
end $$;
rollback;
