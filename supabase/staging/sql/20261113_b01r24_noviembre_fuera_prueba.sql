-- supabase/staging/sql/20261113_b01r24_noviembre_fuera_prueba.sql
--
-- SOLO STAGING. Prueba de la B01r24 · los de noviembre que quedaron fuera (0955).
-- Todo en una transacción con ROLLBACK. La 0955 no añade funciones: casa, valida
-- y aparta en Foodint con _dl1_casar y _dl1_validar (1842) y _b01r23_ignorar
-- (0155), que ya tienen sus pruebas. Aquí se prueba lo suyo:
--   1. Las tres funciones que usa están (si no, en producción pararía).
--   2. Sin Foodint, la migración no hace nada: ni un asiento, ni un casado, ni
--      un apartado más en ninguna cuenta.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA B01r24: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
-- sin usuario: la migración solo la corre una tanda, como el dueño; aquí se mira que sin Foodint no toca nada.
set constraints all immediate;

do $$ begin
  if to_regprocedure('public._dl1_casar(uuid,uuid,text,uuid,jsonb,text)') is null
     or to_regprocedure('public._dl1_validar(uuid,uuid,text,jsonb)') is null
     or to_regprocedure('public._b01r23_ignorar(uuid,uuid,text,jsonb)') is null then
    raise exception 'PRUEBA B01r24 1: falta alguna de las funciones que usa la 0955 (_dl1_casar, _dl1_validar, _b01r23_ignorar).';
  end if;
end $$;

create temp table prueba_antes on commit drop as
  select (select count(*) from public.journal_entry) asientos, (select count(*) from public.bank_match) casados,
         (select count(*) from public.bank_movement where status = 'ignorado') apartados;
\i supabase/migrations/20261113T0955_b01r24_noviembre_fuera.sql
do $$ begin
  if (select count(*) from public.journal_entry) <> (select asientos from prueba_antes)
     or (select count(*) from public.bank_match) <> (select casados from prueba_antes)
     or (select count(*) from public.bank_movement where status = 'ignorado') <> (select apartados from prueba_antes) then
    raise exception 'PRUEBA B01r24 2: sin Foodint la migración ha tocado algo.';
  end if;
end $$;

select 'PRUEBA B01r24 noviembre, los de fuera: en verde' as resultado;
rollback;
