-- scripts/conta/produccion/cuentas/tarjeta-criterio.sql
--
-- B01 · LO QUE CUENTA LA TANDA «QUÉ ES UNA TARJETA, AFINADO» (0192), antes y
-- después. SOLO LEE. La vuelta atrás repone el cuerpo de la 0190: su huella
-- tiene que volver a ser la de antes. TABLA ENTERA, a propósito y dicho (regla 9).
select clave, valor from (
  select 1 o, 'huella de _bank_ocultar_tarjetas' clave,
         (select md5(prosrc) from pg_proc where oid = to_regprocedure('public._bank_ocultar_tarjetas(text)')) valor union all
  select 2, 'función _bank_parece_tarjeta', (to_regprocedure('public._bank_parece_tarjeta(text)') is not null)::text union all
  select 3, 'disparador bank_movement_sin_tarjetas',
         exists (select 1 from pg_trigger where tgname = 'bank_movement_sin_tarjetas' and tgrelid = 'public.bank_movement'::regclass)::text union all
  select 4, 'movimientos (todas las cuentas)', (select count(*) from public.bank_movement)::text union all
  select 5, 'movimientos con una tarjeta tapada por Folvy «····1234» (todas las cuentas)',
         (select count(*) from public.bank_movement
           where concat_ws(' ', bank_concept, clean_concept, document_no, reference_1, reference_2, fingerprint) ~ '····[0-9]{4}')::text
) t order by o;
