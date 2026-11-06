-- supabase/vuelta-atras/20261106T1531_g01_gocardless_cobro.down.sql
--
-- G01 · La vuelta atrás de la 1531: _s01_cuenta_pasarela como estaba (byte a
-- byte, de su respaldo), y las tres restricciones como antes. Si ya hay algo
-- que dependa de lo nuevo (una cuenta de GoCardless en las pasarelas, un
-- cliente que llegó de Bitrix24 o un mandato de GoCardless), PARA y lo dice:
-- deshacer no puede borrar datos de clientes sin que alguien lo decida.
-- sin prueba con datos: la prueba de staging (20261106_g01_clientes_cuotas_prueba.sql) pasa la tanda y esta vuelta atrás en ROLLBACK y comprueba que todo queda como antes; el ensayo de producción la pasa entera, en ROLLBACK.

do $$
declare n int;
begin
  select count(*) into n from public.conta_pasarela_cuenta where proveedor = 'gocardless';
  if n > 0 then raise exception 'G01 · vuelta atrás: hay % cuentas de GoCardless en las pasarelas: no se deshace sin decidir qué pasa con ellas.', n; end if;
  select count(*) into n from public.party where source = 'crm';
  if n > 0 then raise exception 'G01 · vuelta atrás: hay % clientes que llegaron de Bitrix24: no se deshace sin decidir qué pasa con ellos.', n; end if;
  select count(*) into n from public.conta_mandato where token is null or expires_at is null;
  if n > 0 then raise exception 'G01 · vuelta atrás: hay % mandatos sin enlace de firma (de GoCardless): no se deshace sin decidir qué pasa con ellos.', n; end if;
end $$;

select public._restaurar_funcion('public._s01_cuenta_pasarela(uuid,text)', '20261106T1531_g01_gocardless_cobro');

alter table public.conta_mandato drop constraint if exists conta_mandato_firma_en_sumied;
alter table public.conta_mandato alter column token set not null;
alter table public.conta_mandato alter column expires_at set not null;

alter table public.party drop constraint if exists party_source_check;
alter table public.party add constraint party_source_check
  check (source = any (array['manual'::text, 'supplier'::text, 'migrated'::text, 'ticket'::text]));

alter table public.conta_pasarela_cuenta drop constraint if exists conta_pasarela_cuenta_proveedor_check;
alter table public.conta_pasarela_cuenta add constraint conta_pasarela_cuenta_proveedor_check
  check (proveedor = any (array['stripe'::text, 'redsys'::text]));
