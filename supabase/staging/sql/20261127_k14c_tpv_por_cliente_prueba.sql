-- supabase/staging/sql/20261127_k14c_tpv_por_cliente_prueba.sql
--
-- SOLO STAGING. Prueba del K14c (20261127T0015): los pagos con tarjeta (TPV), uno a uno, con su negociación del CRM.
-- Todo en una transacción con ROLLBACK. Nombra el objeto que añade: public.conta_banco_cobro_tarjeta.
--
-- En la gestoría del núcleo (semilla K02), todo inventado (T11):
--   1. Tres pagos de un día: uno casado en «enlace_pago» (lo que facturará Q), uno en «factura_final» y uno sin
--      negociación. Q lee uno: casado y enlace_pago.
--   2. Lo que la tabla no deja: un casado sin negociación, una negociación en dos pagos y el mismo pago dos veces.
--   3. La migración pasa dos veces seguidas sin cambiar nada (en staging no hay QBO: no inserta).
--   4. La vuelta atrás quita la tabla.
--
-- sin usuario: nadie escribe en la tabla desde la app: solo la migración, como dueño. El usuario solo la lee (select con
-- belongs_to_account, como conta_banco_cobro), y aquí no hay nada suyo que probar.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA K14c: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regclass('public.conta_banco_cobro_tarjeta') is null then
    raise exception 'PRUEBA K14c · 0: falta la 20261127T0015 (no está public.conta_banco_cobro_tarjeta).';
  end if;
end $$;
set local statement_timeout = '60s';

do $$
declare a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e2'; n int;
begin
  insert into public.party (id, account_id, name) values ('c0f14c00-0000-4000-8000-0000000000b1', a, 'Cliente de Prueba K14c, S.L.');
  -- 1 · Tres pagos de un día.
  insert into public.conta_banco_cobro_tarjeta (company_id, pagado_en, importe, account_id, movement_id, crm_id, etapa, party_id, cegid_codigo, estado, porque) values
    (emp, timestamptz '2026-11-04 12:00:00+01', 48.40, a, null, '90001', 'enlace_pago', 'c0f14c00-0000-4000-8000-0000000000b1', null, 'casado', 'prueba'),
    (emp, timestamptz '2026-11-04 13:00:00+01', 60.50, a, null, '90002', 'factura_final', null, 1, 'casado', 'prueba'),
    (emp, timestamptz '2026-11-04 14:00:00+01', 96.80, a, null, null, null, null, null, 'sin_negociacion', 'prueba');
  select count(*) into n from public.conta_banco_cobro_tarjeta where company_id = emp and estado = 'casado' and etapa = 'enlace_pago';
  if n <> 1 then raise exception 'PRUEBA K14c · 1: Q tenía que leer un pago para facturar, no %.', n; end if;
  raise notice 'PRUEBA K14c · 1: tres pagos de un día; uno para facturar.';
  -- 2 · Lo que no deja.
  begin
    insert into public.conta_banco_cobro_tarjeta (company_id, pagado_en, importe, account_id, crm_id, etapa, estado, porque)
    values (emp, timestamptz '2026-11-05 10:00:00+01', 10, a, null, null, 'casado', 'prueba');
    raise exception 'PRUEBA K14c · 2: un casado sin negociación no tenía que entrar.';
  exception when check_violation then null; end;
  begin
    insert into public.conta_banco_cobro_tarjeta (company_id, pagado_en, importe, account_id, crm_id, etapa, estado, porque)
    values (emp, timestamptz '2026-11-05 11:00:00+01', 10, a, '90001', 'enlace_pago', 'por_confirmar', 'prueba');
    raise exception 'PRUEBA K14c · 2: una negociación en dos pagos no tenía que entrar.';
  exception when unique_violation then null; end;
  begin
    insert into public.conta_banco_cobro_tarjeta (company_id, pagado_en, importe, account_id, estado, porque)
    values (emp, timestamptz '2026-11-04 14:00:00+01', 96.80, a, 'sin_negociacion', 'prueba');
    raise exception 'PRUEBA K14c · 2: el mismo pago dos veces no tenía que entrar.';
  exception when unique_violation then null; end;
  raise notice 'PRUEBA K14c · 2: ni un casado sin negociación, ni una negociación en dos pagos, ni el mismo pago dos veces.';
end $$;

-- 3 · Otra vez la migración: nada cambia.
\i supabase/migrations/20261127T0015_k14c_tpv_por_cliente.sql
do $$ declare n int; begin
  select count(*) into n from public.conta_banco_cobro_tarjeta where company_id = 'c0e20000-0000-4000-8000-0000000000e2';
  if n <> 3 then raise exception 'PRUEBA K14c · 3: la segunda pasada tenía que dejar los 3 pagos, no %.', n; end if;
  raise notice 'PRUEBA K14c · 3: la migración pasa dos veces sin cambiar nada.';
end $$;

-- 4 · La vuelta atrás.
\i supabase/vuelta-atras/20261127T0015_k14c_tpv_por_cliente.down.sql
do $$ begin
  if to_regclass('public.conta_banco_cobro_tarjeta') is not null then raise exception 'PRUEBA K14c · 4: la vuelta atrás tenía que quitar la tabla.'; end if;
  raise notice 'PRUEBA K14c · 4: vuelta atrás: sin la tabla.';
end $$;

rollback;
