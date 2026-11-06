-- supabase/migrations/20261104T1041_s01p_factura_asiento_datos.sql
--
-- S01p · 1 · DATOS: cada factura recibida, con el asiento que la contabiliza
-- (la regla de la 1040, _s01p_asiento_de_factura). De todas las cuentas: es la
-- misma corrección para todas (regla 9: la cuenta va en cada fila de la copia).
--
-- Medido en producción el 04/11 (solo lectura), en la tabla entera: cambian
-- 147 facturas, todas de Foodint, todas de «sin asiento» a su asiento propio.
-- Ninguna pierde el que tenía ni cambia de uno a otro: los 130 enlaces a
-- migrados de Diez se quedan como están.
--
-- Antes de tocar nada, la copia de lo que había en conta_s01p_factura_antes
-- (la vuelta atrás lo devuelve desde ahí). Se puede pasar dos veces: la
-- segunda no encuentra nada que cambiar y lo dice.
--
-- Mueve filas que existen: va con «autorizo».

create table if not exists public.conta_s01p_factura_antes (
  id uuid primary key,
  account_id uuid not null,
  journal_entry_id uuid,
  guardado_at timestamptz not null default now()
);
comment on table public.conta_s01p_factura_antes is
  'S01p · 1041 · Lo que tenía supplier_invoice.journal_entry_id antes de la 1041, para su vuelta atrás.';
alter table public.conta_s01p_factura_antes enable row level security;
revoke all on public.conta_s01p_factura_antes from public, anon, authenticated;

do $$
declare v_n int; v_quita int;
begin
  insert into public.conta_s01p_factura_antes (id, account_id, journal_entry_id)
  select f.id, f.account_id, f.journal_entry_id
    from public.supplier_invoice f
   where f.journal_entry_id is distinct from public._s01p_asiento_de_factura(f.id, f.account_id)
  on conflict (id) do nothing;

  select count(*) filter (where f.journal_entry_id is not null and public._s01p_asiento_de_factura(f.id, f.account_id) is null)
    into v_quita
    from public.supplier_invoice f;
  if v_quita > 0 then
    raise exception 'S01p·1041: % facturas perderían el asiento que tienen. No se toca nada: mira por qué antes.', v_quita;
  end if;

  update public.supplier_invoice f
     set journal_entry_id = public._s01p_asiento_de_factura(f.id, f.account_id)
   where f.journal_entry_id is distinct from public._s01p_asiento_de_factura(f.id, f.account_id);
  get diagnostics v_n = row_count;
  raise notice 'S01p·1041: % facturas con su asiento.', v_n;
end $$;
