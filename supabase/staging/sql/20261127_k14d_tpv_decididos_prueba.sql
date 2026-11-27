-- supabase/staging/sql/20261127_k14d_tpv_decididos_prueba.sql
--
-- SOLO STAGING. Prueba del K14d (20261127T0055): lo que decide Julio sobre los pagos con tarjeta de QBO. Todo en una
-- transacción con ROLLBACK. Nombra el objeto que cambia: public.conta_banco_cobro_tarjeta (columna falta).
--
-- En staging no hay QBO Integrity: las cuatro filas no existen y la migración no las toca. Se prueba, en la gestoría
-- del núcleo (semilla K02), todo inventado (T11):
--   1. La columna «falta» está, y lo que lee Q (casado, enlace_pago y falta is null) deja fuera un casado al que le falta
--      algo.
--   2. La migración pasa dos veces seguidas sin cambiar nada.
--   3. La vuelta atrás quita la columna y deja la tabla.
--
-- sin usuario: nadie escribe en la tabla desde la app: solo las migraciones, como dueño. El usuario solo la lee.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA K14d: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_banco_cobro_tarjeta' and column_name = 'falta') then
    raise exception 'PRUEBA K14d · 0: falta la 20261127T0055 (no está la columna falta).';
  end if;
end $$;
set local statement_timeout = '60s';

do $$
declare a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e2'; n int;
begin
  insert into public.conta_banco_cobro_tarjeta (company_id, pagado_en, importe, account_id, crm_id, etapa, estado, porque, falta) values
    (emp, timestamptz '2026-11-09 15:00:00+01', 60.00, a, '90101', 'enlace_pago', 'casado', 'prueba', 'falta su NIE'),
    (emp, timestamptz '2026-11-19 13:00:00+01', 48.40, a, '90102', 'enlace_pago', 'casado', 'prueba', null);
  select count(*) into n from public.conta_banco_cobro_tarjeta where company_id = emp and estado = 'casado' and etapa = 'enlace_pago' and falta is null;
  if n <> 1 then raise exception 'PRUEBA K14d · 1: Q tenía que leer un pago para facturar (el que no le falta nada), no %.', n; end if;
  raise notice 'PRUEBA K14d · 1: un casado al que le falta el NIE no se factura; el otro sí.';
end $$;

-- 2 · Otra vez la migración: nada cambia.
\i supabase/migrations/20261127T0055_k14d_tpv_decididos.sql
do $$ declare n int; begin
  select count(*) into n from public.conta_banco_cobro_tarjeta where company_id = 'c0e20000-0000-4000-8000-0000000000e2' and falta = 'falta su NIE';
  if n <> 1 then raise exception 'PRUEBA K14d · 2: la segunda pasada tenía que dejar las filas como estaban.'; end if;
  raise notice 'PRUEBA K14d · 2: la migración pasa dos veces sin cambiar nada.';
end $$;

-- 3 · La vuelta atrás.
\i supabase/vuelta-atras/20261127T0055_k14d_tpv_decididos.down.sql
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_banco_cobro_tarjeta' and column_name = 'falta')
     or to_regclass('public.conta_banco_cobro_tarjeta') is null then
    raise exception 'PRUEBA K14d · 3: la vuelta atrás tenía que quitar la columna y dejar la tabla.';
  end if;
  raise notice 'PRUEBA K14d · 3: vuelta atrás: sin la columna, con la tabla.';
end $$;

rollback;
