-- ============================================================================
-- R02 · APARTE (2) · ELIMINACIÓN DEL INTERRUPTOR ANTIGUO
--   brand.own_delivery_enabled y public.marca_reparte_propio(brand)
-- ----------------------------------------------------------------------------
-- Encargo §4: «brand.own_delivery_enabled desaparece … esta eliminación va en
-- FICHERO PROPIO con su *.down.sql, porque el workflow de producción para
-- ante un borrado de objeto de Cocina y Julio tiene que darle el visto bueno
-- por separado». Tarea 6.
--
-- VA LA ÚLTIMA: después de 0100–0140 (y del saneado 0210), cuando ya nada lo
-- lee. Medido en producción el 04/10: lo leían resolve_dispatch,
-- tg_sale_service_type_por_interruptor, metrica_direcciones_de_reparto y
-- marca_reparte_propio; y a marca_reparte_propio la llamaban resolve_dispatch,
-- orders_feed y orders_feed_by_token. Todos los cambia la 0120; la función se
-- borra aquí. Ninguna vista, política ni dependencia registrada sobre la
-- columna. En la web lo leían BrandDeliverySection y brandDeliveryService,
-- que el R02 retira.
--
-- ANTES DE BORRAR
--   · La guarda comprueba que NINGUNA función (aparte de marca_reparte_propio)
--     lee todavía la columna. Si alguna lo hace, para sin tocar nada.
--   · Los valores que no son NULL (hoy: Smash y Lovers, a false) se guardan en
--     r02_interruptor_antiguo para que la vuelta atrás los devuelva.
-- ============================================================================

do $$
declare v text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema')
     and p.prosrc ilike '%own_delivery_enabled%'
     and p.proname <> 'marca_reparte_propio';
  if v is not null then
    raise exception 'R02 0200: todavía leen brand.own_delivery_enabled: %. No se borra nada.', v;
  end if;
  -- Y nadie llama ya a marca_reparte_propio (el 04/10 la llamaban resolve_dispatch,
  -- orders_feed y orders_feed_by_token; los tres los cambia la 0120).
  select string_agg(p.oid::regprocedure::text, ', ') into v
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema')
     and p.prosrc ilike '%marca_reparte_propio%'
     and p.proname <> 'marca_reparte_propio';
  if v is not null then
    raise exception 'R02 0200: todavía llaman a marca_reparte_propio: %. No se borra nada.', v;
  end if;
end $$;

create table if not exists public.r02_interruptor_antiguo (
  brand_id              uuid primary key,
  account_id            uuid not null,
  own_delivery_enabled  boolean not null,
  guardado_at           timestamptz not null default now()
);
comment on table public.r02_interruptor_antiguo is
  'R02 · Copia de brand.own_delivery_enabled (los que no eran NULL) antes de eliminar la columna. Para la vuelta atrás. Solo service_role.';
alter table public.r02_interruptor_antiguo enable row level security;
revoke all on table public.r02_interruptor_antiguo from anon, authenticated;

insert into public.r02_interruptor_antiguo (brand_id, account_id, own_delivery_enabled)
select b.id, b.account_id, b.own_delivery_enabled
  from public.brand b
 where b.own_delivery_enabled is not null
on conflict (brand_id) do update set own_delivery_enabled = excluded.own_delivery_enabled;

drop function if exists public.marca_reparte_propio(public.brand);
alter table public.brand drop column if exists own_delivery_enabled;
