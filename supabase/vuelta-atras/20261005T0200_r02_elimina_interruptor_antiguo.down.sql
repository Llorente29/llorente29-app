-- ============================================================================
-- VUELTA ATRÁS de 20261005T0200_r02_elimina_interruptor_antiguo.sql
-- Vuelve a poner brand.own_delivery_enabled (nula, sin valor por defecto, como
-- estaba), le devuelve los valores guardados en r02_interruptor_antiguo y
-- recrea marca_reparte_propio(brand) tal como estaba en producción el 04/10.
-- Después de esta, si se quiere volver a los lectores de antes, va la vuelta
-- atrás de la 0120.
-- ============================================================================
alter table public.brand add column if not exists own_delivery_enabled boolean;

update public.brand b
   set own_delivery_enabled = g.own_delivery_enabled
  from public.r02_interruptor_antiguo g
 where g.brand_id = b.id and g.account_id = b.account_id;

create or replace function public.marca_reparte_propio(b public.brand)
 returns boolean
 language sql
 stable
as $function$
  -- NULL en el interruptor = «no lo han tocado» → se deriva del tipo de marca:
  -- una marca PROPIA reparte por defecto, una CEDIDA no. Que la cedida esté
  -- apagada sin que nadie tenga que acordarse es lo que hace que esto aguante.
  select coalesce(b.own_delivery_enabled, b.ownership_type = 'own');
$function$;

grant execute on function public.marca_reparte_propio(public.brand) to anon, authenticated, service_role;

select count(*) as marcas_con_interruptor_devuelto from public.brand where own_delivery_enabled is not null;
