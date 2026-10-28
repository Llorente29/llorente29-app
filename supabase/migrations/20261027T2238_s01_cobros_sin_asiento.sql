-- 20261027T2238_s01_cobros_sin_asiento.sql
--
-- S01 · PR 1 · Respuesta 1, punto 4 · LOS COBROS POR EL ENLACE QUE YA EXISTEN
-- SIN ASIENTO. Desde la 2030, cada cobro por el enlace hace su asiento el día
-- del cobro (la cuenta de la pasarela contra la 430 del cliente). Los de la
-- entrega 4 que se cobraron antes no lo tienen: esta tanda se lo hace, con la
-- fecha del cobro, por el mismo camino (_s01_asiento_cobro), y crea la cuenta
-- de la pasarela si hace falta.
--
-- Medido en producción, solo leyendo, el 27/10: 0 enlaces de pago y 0 cobros
-- con tarjeta o Bizum. Si al aplicarse hubiera alguno, le hace su asiento; si
-- alguno no puede tenerlo (sin la 430 del cliente, sin plan, sin ejercicio),
-- PARA entera y lo dice: se decide antes, no se deja a medias.
--
-- Copia previa: conta_s01_cobros_antes (sin acceso desde las pantallas) guarda,
-- de cada cobro, el asiento que tenía antes, y lo que la tanda crea (los
-- asientos y las cuentas de pasarela). Si la tabla ya existe, PARA.
-- Vuelta atrás: supabase/vuelta-atras/20261027T2238_s01_cobros_sin_asiento.down.sql,
-- que deja todo EXACTAMENTE como estaba desde la copia y la borra.
--
-- Va después de la 2030 y la 2031 (usa sus funciones y sus dos CHECK).

do $$ begin
  if to_regclass('public.conta_s01_cobros_antes') is not null then
    raise exception 'S01 2238: ya está la copia previa (conta_s01_cobros_antes): esta tanda ya se pasó. No toco nada.';
  end if;
end $$;

create table public.conta_s01_cobros_antes (
  tabla  text not null check (tabla in ('customer_invoice_payment', 'journal_entry', 'conta_pasarela_cuenta')),
  id     uuid not null,
  antes  uuid,
  primary key (tabla, id)
);
comment on table public.conta_s01_cobros_antes is
  'S01 2238 · Copia previa: de cada cobro por el enlace sin asiento, el asiento que tenía (customer_invoice_payment: id, antes = entry_id); y lo creado: los asientos (journal_entry) y las cuentas de pasarela (conta_pasarela_cuenta: id = cuenta de tesorería, antes = subcuenta del plan). La borra la vuelta atrás.';
alter table public.conta_s01_cobros_antes enable row level security;
revoke all on table public.conta_s01_cobros_antes from public, anon, authenticated;

-- 1 · Los cobros por el enlace sin asiento vivo, con el que tenían.
insert into public.conta_s01_cobros_antes (tabla, id, antes)
select 'customer_invoice_payment', p.id, p.entry_id
  from public.conta_enlace_pago e join public.customer_invoice_payment p on p.id = e.payment_id
 where e.status = 'pagado'
   and not exists (select 1 from public.journal_entry j where j.id = p.entry_id and j.status in ('propuesto', 'borrador', 'validado'));

-- 2 · Su asiento, con la fecha del cobro; y lo creado, a la copia.
do $$
declare r record; x jsonb;
begin
  for r in select c.id, coalesce(e.proveedor, 'stripe') as proveedor
             from public.conta_s01_cobros_antes c join public.conta_enlace_pago e on e.payment_id = c.id
            where c.tabla = 'customer_invoice_payment' order by e.pagado_at, c.id loop
    x := public._s01_asiento_cobro(r.id, r.proveedor);
    if x->>'asiento' is null then
      raise exception 'S01 2238: el cobro % no puede tener su asiento: %. No toco nada.', r.id, x->>'motivo';
    end if;
    insert into public.conta_s01_cobros_antes (tabla, id, antes) values ('journal_entry', (x->>'asiento')::uuid, null);
  end loop;
  -- Las cuentas de pasarela creadas en esta misma transacción (now() es el de la transacción).
  insert into public.conta_s01_cobros_antes (tabla, id, antes)
  select 'conta_pasarela_cuenta', pc.treasury_account_id, pc.company_account_id from public.conta_pasarela_cuenta pc where pc.created_at = now();
end $$;
