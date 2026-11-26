-- supabase/migrations/20261126T1139_r20b_cifras_del_banco.sql
--
-- R20b · «Te deben», cruzado con el banco (Julio, 26/11: «deuda es solo lo que el cliente no ha pagado por ninguna
-- vía»). Lo cobrado por el banco lo casa el K14 (conta_banco_cobro y conta_banco_cobro_recibo, de
-- 20261126T0915_k14_cobrado_por_banco); aquí, solo lo que lee «Clientes y cuotas» y la comprobación de cada noche:
--
--   conta_cifras_del_banco(cuenta) (AÑADE): por empresa,
--     · si está cruzada con el banco (tiene alguna entrada en conta_banco_cobro: el K14 ya leyó su extracto);
--     · los recibos de GoCardless sin cobrar que pagó el banco (conta_banco_cobro_recibo: gc_id, la entrada y su
--       importe), que dejan de contar como deuda;
--     · el TPV sin asignar: las entradas con la vía del TPV (via = 'tarjeta', estado = 'tarjeta', sin cliente; así lo
--       guarda el K14: _shared/cobro/porBanco.ts), una a una con su fecha e importe. No se descuentan de nadie.
--   Como conta_cifras_del_cobro: de quien es de la cuenta, o del servidor.
--
-- Solo añade (se puede pasar dos veces: create or replace). No toca datos. Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261126T1139_r20b_cifras_del_banco.down.sql

create or replace function public.conta_cifras_del_banco(p_cuenta uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  with permiso as (
    select p_cuenta as cuenta where coalesce(auth.role(), '') = 'service_role' or public.belongs_to_account(p_cuenta)
  )
  select jsonb_build_object(
    'cruzadas', coalesce((select jsonb_agg(distinct b.company_id) from public.conta_banco_cobro b where b.account_id = (select cuenta from permiso)), '[]'::jsonb),
    'recibos', coalesce((select jsonb_agg(jsonb_build_object('empresa_id', r.company_id, 'gc_id', r.gc_id, 'movement_id', r.movement_id, 'importe', r.importe,
          'fecha', b.fecha, 'via', b.via) order by r.company_id, r.gc_id)
        from public.conta_banco_cobro_recibo r join public.conta_banco_cobro b on b.movement_id = r.movement_id
       where r.account_id = (select cuenta from permiso)), '[]'::jsonb),
    'tarjeta', coalesce((select jsonb_agg(jsonb_build_object('empresa_id', b.company_id, 'movement_id', b.movement_id, 'fecha', b.fecha, 'importe', b.importe)
          order by b.company_id, b.fecha, b.movement_id)
        from public.conta_banco_cobro b
       where b.account_id = (select cuenta from permiso) and b.via = 'tarjeta' and b.estado = 'tarjeta' and b.party_id is null), '[]'::jsonb))
$$;
revoke all on function public.conta_cifras_del_banco(uuid) from public, anon;
grant execute on function public.conta_cifras_del_banco(uuid) to authenticated, service_role;
comment on function public.conta_cifras_del_banco(uuid) is
  'R20b · Por empresa: si está cruzada con el banco (K14), los recibos de GoCardless que pagó el banco y el TPV sin asignar (via y estado «tarjeta», sin cliente). Lo lee «Clientes y cuotas» para «Te deben». De quien es de la cuenta o del servidor.';
