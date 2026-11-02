-- supabase/migrations/20261101T0945_s01m_otras_direcciones.sql
--
-- S01m · Un local admite «otras direcciones con las que lo nombran las
-- plataformas» (Julio, 01/11: en Glovo, las tiendas con la dirección «Avenida
-- del Ensanche de Vallecas 106» son de Carabanchel; Glovo no la tiene al día).
-- Se escriben en la ficha del centro (Laboral › Centros), no en el código.
--
--   1. location_address_alias: las otras direcciones de cada local, por cuenta.
--   2. conta_local_direcciones_guardar(local, direcciones, quién): las deja tal
--      cual se escriben (sin repetidas ni vacías) y vuelve a buscar su
--      liquidación a las facturas de plataformas de la cuenta que siguen sin
--      ligar (S01i); dice cuántas eran y cuántas se han ligado (regla 8).
--
-- Solo añade. Vuelta atrás: supabase/vuelta-atras/20261101T0945_s01m_otras_direcciones.down.sql

create table if not exists public.location_address_alias (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  address text not null check (btrim(address) <> ''),
  created_by_name text,
  created_at timestamptz not null default now()
);
create unique index if not exists location_address_alias_una on public.location_address_alias (location_id, lower(btrim(address)));
create index if not exists location_address_alias_cuenta on public.location_address_alias (account_id);
alter table public.location_address_alias enable row level security;
drop policy if exists laa_read on public.location_address_alias;
create policy laa_read on public.location_address_alias for select using (account_id = any (public.current_user_account_ids()));
grant select on public.location_address_alias to authenticated;

create or replace function public.conta_local_direcciones_guardar(p_location uuid, p_direcciones text[], p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_acc uuid; v_nombre text; v_n int; v_inv uuid; v_buscadas int := 0; v_ligadas int := 0; v_r text;
begin
  select account_id, name into v_acc, v_nombre from public.locations where id = p_location;
  if v_acc is null or not public.belongs_to_account(v_acc) then raise exception 'Ese local no es de tu cuenta.' using errcode = '42501'; end if;
  if not public.current_user_is_admin_or_manager_of(v_acc) then
    raise exception 'Solo un administrador o un encargado de la cuenta cambia las direcciones de un local.' using errcode = '42501';
  end if;
  delete from public.location_address_alias where location_id = p_location;
  insert into public.location_address_alias (account_id, location_id, address, created_by_name)
  select distinct on (lower(btrim(d))) v_acc, p_location, btrim(d), coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor())
    from unnest(coalesce(p_direcciones, '{}'::text[])) d where btrim(coalesce(d, '')) <> '';
  get diagnostics v_n = row_count;
  -- Con la dirección nueva, las facturas de plataformas sin ligar pueden encontrar ya su liquidación (S01i).
  if to_regprocedure('public._conta_comision_buscar(uuid)') is not null then
    for v_inv in
      select si.id from public.supplier_invoice si
        join public.party_role ps on ps.account_id = si.account_id and ps.role = 'supplier' and ps.supplier_id = si.supplier_id
        join public.party_role pl on pl.account_id = ps.account_id and pl.party_id = ps.party_id and pl.role = 'platform'
       where si.account_id = v_acc and si.status not in ('anulada', 'descartada', 'pagada')
         and not exists (select 1 from public.channel_settlement_invoice k where k.supplier_invoice_id = si.id)
    loop
      v_buscadas := v_buscadas + 1;
      v_r := public._conta_comision_buscar(v_inv);
      if exists (select 1 from public.channel_settlement_invoice k where k.supplier_invoice_id = v_inv) then v_ligadas := v_ligadas + 1; end if;
    end loop;
  end if;
  return jsonb_build_object('guardadas', v_n, 'buscadas', v_buscadas, 'ligadas', v_ligadas,
    'texto', format('%s: %s.%s', v_nombre,
      case when v_n = 0 then 'sin otras direcciones' when v_n = 1 then 'guardada 1 otra dirección' else format('guardadas %s otras direcciones', v_n) end,
      case when v_buscadas = 0 then ''
           else format(' Vuelta a buscar la liquidación de %s %s sin ligar: %s.', v_buscadas,
             case when v_buscadas = 1 then 'factura de plataformas' else 'facturas de plataformas' end,
             case when v_ligadas = 0 then 'ninguna se ha ligado aún' when v_ligadas = 1 then '1 ligada ahora' else format('%s ligadas ahora', v_ligadas) end) end));
end $$;
revoke all on function public.conta_local_direcciones_guardar(uuid, text[], text) from public, anon;
grant execute on function public.conta_local_direcciones_guardar(uuid, text[], text) to authenticated;
