-- supabase/staging/sql/20261122_i01b_sin_m01_en_staging.sql
--
-- SOLO STAGING. Va justo después de la 0180 DE VERDAD en el manifiesto.
--
-- Por qué existe (run 344, 18/10): la 0180 hace «create or replace» de
-- conta_motivos_para_validar, que en producción viene de la M01. En staging la
-- M01 NO está de verdad (journal_entry_validar es la de antes y no la llama),
-- así que la 0180 dejó esa función huérfana: nadie la llama, pero hace creer a
-- las pruebas que la M01 ya está (falta_m01 sale falso) y la prueba de la M01,
-- que la crea con «create function», choca: «already exists with same argument
-- types».
--
-- Lo que hace: si la M01 no está de verdad en staging (ninguna otra función ni
-- disparador nombra conta_motivos_para_validar), quita esa función, que es
-- solo de la 0180. Staging vuelve a «sin la M01», como estaba antes del 18/10,
-- y el resto de la 0180 (la columna, el CHECK, las tres funciones, los dos
-- disparadores) se queda, porque la 0190 y la 0220 lo leen. Si la M01 está de
-- verdad, no toca nada. Se puede volver a pasar.

do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'I01b sin M01: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;

do $$
declare
  f regprocedure := to_regprocedure('public.conta_motivos_para_validar(uuid)');
  v_usan int;
begin
  if f is null then
    raise notice 'I01b sin M01: conta_motivos_para_validar no está en staging. Nada que hacer.';
    return;
  end if;
  -- ¿La llama alguien? (journal_entry_validar y el disparador del envío por
  -- aclarar, si la M01 y la C06b estuvieran de verdad.)
  select count(*) into v_usan
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.oid <> f
     and p.prokind = 'f'
     and position('conta_motivos_para_validar' in pg_get_functiondef(p.oid)) > 0;
  if v_usan > 0 then
    raise notice 'I01b sin M01: % funciones la llaman: la M01 está de verdad en staging. No se toca.', v_usan;
    return;
  end if;
  if position('vat_settlement' in pg_get_functiondef(f)) = 0 then
    raise exception 'I01b sin M01: conta_motivos_para_validar no es la de la 0180 y nadie la llama. No es mía: no se toca; mírese a mano.';
  end if;
  drop function public.conta_motivos_para_validar(uuid);
  raise notice 'I01b sin M01: quitada conta_motivos_para_validar (la puso solo la 0180; la M01 no está en staging y nadie la llamaba).';
end $$;
