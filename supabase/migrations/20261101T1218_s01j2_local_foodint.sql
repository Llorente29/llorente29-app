-- supabase/migrations/20261101T1218_s01j2_local_foodint.sql
--
-- S01j·2 · Las liquidaciones de Foodint ya guardadas sin local, cuya tienda
-- tampoco lo tiene, reciben el que dice el texto de su tienda, con la misma
-- función que las nuevas (_conta_local_de_texto, con las otras direcciones del
-- S01m). Solo si lo dice sin adivinar: si da null, se quedan como están.
-- Medido el 01/11 (solo lectura): 29, todas del Excel de Glovo, y las 29 dan
-- local (9 de «Avenida del Ensanche de Vallecas 106» → Carabanchel; 18 de
-- «C. de Florencio Llorente» → Alcalá; 2 de «C. Cañaveral» → Plaza Castilla).
-- Mueve filas: va con «autorizo». La tienda no se toca.
-- Vuelta atrás: supabase/vuelta-atras/20261101T1218_s01j2_local_foodint.down.sql
-- (deja sin local exactamente las que puso esta, que quedan apuntadas aquí).

create table if not exists public.s01j2_local_puesto (
  settlement_id uuid primary key, account_id uuid not null, location_id uuid not null, puesto_at timestamptz not null default now()
);
alter table public.s01j2_local_puesto enable row level security;
revoke all on public.s01j2_local_puesto from public, anon, authenticated;

with puestos as (
  update public.channel_settlement cs
     set location_id = x.local, updated_at = now()
    from (select cs2.id, public._conta_local_de_texto(cs2.account_id, array[coalesce(ps.external_text, cs2.external_location_text)]) local
            from public.channel_settlement cs2
            join public.platform_store ps on ps.id = cs2.store_id and ps.account_id = cs2.account_id
           where cs2.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and cs2.location_id is null and ps.location_id is null) x
   where cs.id = x.id and cs.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and x.local is not null
  returning cs.id, cs.account_id, cs.location_id
)
insert into public.s01j2_local_puesto (settlement_id, account_id, location_id)
select id, account_id, location_id from puestos
on conflict (settlement_id) do nothing;
