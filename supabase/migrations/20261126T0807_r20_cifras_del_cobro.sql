-- supabase/migrations/20261126T0807_r20_cifras_del_cobro.sql
--
-- R20 · Las cifras de «Clientes y cuotas», 100 % fiables (Julio, 26/11). Lo que decide cada cifra vive en
-- supabase/functions/_shared/tarifa/cifras.ts (lo usan la pantalla y la lectura de cada noche); aquí, lo que lee:
--
--   conta_cifras_del_cobro(cuenta) (AÑADE): por empresa, el mes del próximo cobro de GoCardless y las suscripciones
--   activas que cobran en ese mes, con su próximo importe, su cliente de GoCardless y la ficha a la que está ATADO
--   (conta_gc_enlace en «atado»; sin atar, null). Es la forma de contar de la copia del R19 (conta_gc_contar_copia), la
--   única: lo que suma es «GoCardless cobrará en diciembre». Y la hora de la última lectura de cada empresa. Como
--   conta_gc_contar_copia: de quien es de la cuenta, o del servidor (la comprobación de cada noche).
--
-- Solo añade (se puede pasar dos veces: create or replace). El tipo nuevo de «Pendiente de revisar», en la 0808.
-- No toca datos. Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261126T0807_r20_cifras_del_cobro.down.sql

-- 1 · Lo que GoCardless cobrará en el mes del próximo cobro, suscripción a suscripción, con su ficha atada.
create or replace function public.conta_cifras_del_cobro(p_cuenta uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  with permiso as (
    select p_cuenta as cuenta where coalesce(auth.role(), '') = 'service_role' or public.belongs_to_account(p_cuenta)
  ), activas as (
    select s.company_id, s.gc_id, s.gc_cliente_id, s.nombre, s.proximo_cobro_fecha, s.proximo_cobro_importe
      from public.conta_gc_suscripcion s
     where s.account_id = (select cuenta from permiso) and s.estado = 'active'
  ), mes_que_cuenta as (
    -- El mes del próximo cobro de cada empresa (la forma de contar de la copia, conta_gc_contar_copia).
    select a.company_id, date_trunc('month', min(a.proximo_cobro_fecha))::date as mes from activas a
     where a.proximo_cobro_fecha >= (now() at time zone 'Europe/Madrid')::date group by a.company_id
  )
  select jsonb_build_object(
    'meses', coalesce((select jsonb_agg(jsonb_build_object('empresa_id', m.company_id, 'mes', to_char(m.mes, 'YYYY-MM'),
        'leido_at', (select g.ultima_lectura_at from public.conta_cobro_gocardless g where g.company_id = m.company_id order by g.ultima_lectura_at desc nulls last limit 1))
        order by m.company_id) from mes_que_cuenta m), '[]'::jsonb),
    'suscripciones', coalesce((select jsonb_agg(jsonb_build_object('empresa_id', a.company_id, 'gc_id', a.gc_id, 'gc_cliente_id', a.gc_cliente_id,
          'cliente_gc', c.nombre, 'ficha_id', e.party_id, 'nombre', a.nombre, 'fecha', a.proximo_cobro_fecha, 'importe', a.proximo_cobro_importe)
          order by a.company_id, a.gc_id)
        from activas a
        join mes_que_cuenta m on m.company_id = a.company_id and date_trunc('month', a.proximo_cobro_fecha)::date = m.mes
        left join public.conta_gc_cliente c on c.company_id = a.company_id and c.gc_id = a.gc_cliente_id
        left join public.conta_gc_enlace e on e.company_id = a.company_id and e.gc_cliente_id = a.gc_cliente_id and e.estado = 'atado'), '[]'::jsonb))
$$;
revoke all on function public.conta_cifras_del_cobro(uuid) from public, anon;
grant execute on function public.conta_cifras_del_cobro(uuid) to authenticated, service_role;
comment on function public.conta_cifras_del_cobro(uuid) is
  'R20 · Por empresa, el mes del próximo cobro de GoCardless y las suscripciones activas que cobran en él (próximo importe, cliente de GoCardless y ficha ATADA): «GoCardless cobrará en …». De quien es de la cuenta o del servidor.';
