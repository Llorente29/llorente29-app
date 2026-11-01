-- supabase/migrations/20261101T1217_s01j2_local_de_la_liquidacion.sql
-- cambia: public.conta_local_direcciones_guardar · prueba: supabase/staging/sql/20261101_s01j2_correo_prueba.sql
--
-- S01j·2 · El local de una liquidación de plataforma sale de la dirección de
-- su tienda, con la misma función que la factura (_conta_local_de_texto, que
-- ya usa las otras direcciones del S01m). Medido en Foodint el 01/11: 29
-- liquidaciones del Excel de Glovo sin local, cuya tienda tampoco lo tiene, y
-- el texto de todas da un local (Carabanchel, Alcalá y Plaza Castilla).
--   1. Añade un disparador: al guardar una liquidación sin local (el Excel
--      subido a mano y el que llega por correo pasan los dos por
--      conta_liquidacion_registrar), se le pone el que dice el texto de su
--      tienda, si lo dice sin adivinar. Si no lo dice, se queda sin local.
--   2. Cambia conta_local_direcciones_guardar (misma firma): al guardar otra
--      dirección, también pone el local en las liquidaciones sin local que
--      ahora lo tienen, antes de volver a buscar las facturas, y lo dice.
-- La tienda no se toca: su local se decide en Tiendas (D01).
-- Parte del cuerpo de producción del 01/11 (md5 a25f1f1c…, el de la 0945).

select public._respaldar_funcion('public.conta_local_direcciones_guardar(uuid,text[],text)', '20261101T1217_s01j2_local_de_la_liquidacion');

create or replace function public._conta_liquidacion_pon_local()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_texto text; v_tienda_local uuid;
begin
  if new.location_id is not null then return new; end if;
  -- La vuelta atrás de la 1218 quita los locales que puso: con esta marca, no se vuelven a poner.
  if current_setting('s01j2.no_poner_local', true) = '1' then return new; end if;
  select ps.external_text, ps.location_id into v_texto, v_tienda_local
    from public.platform_store ps where ps.id = new.store_id and ps.account_id = new.account_id;
  -- La tienda con su local manda (la ficha lo lee de ella): no se repite aquí.
  if v_tienda_local is not null then return new; end if;
  v_texto := coalesce(v_texto, new.external_location_text);
  if coalesce(btrim(v_texto), '') = '' then return new; end if;
  new.location_id := public._conta_local_de_texto(new.account_id, array[v_texto]);
  return new;
end $$;
revoke all on function public._conta_liquidacion_pon_local() from public, anon, authenticated;

drop trigger if exists s01j2_liquidacion_pon_local on public.channel_settlement;
create trigger s01j2_liquidacion_pon_local
  before insert or update of store_id, external_location_text, location_id on public.channel_settlement
  for each row when (new.location_id is null)
  execute function public._conta_liquidacion_pon_local();

create or replace function public.conta_local_direcciones_guardar(p_location uuid, p_direcciones text[], p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_acc uuid; v_nombre text; v_n int; v_inv uuid; v_buscadas int := 0; v_ligadas int := 0; v_r text; v_locales int := 0;
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
  -- S01j·2 · Con la dirección nueva, las liquidaciones sin local que ahora lo tienen sin adivinar (por el texto de su tienda), antes de buscar facturas.
  update public.channel_settlement cs set location_id = p_location, updated_at = now()
    from public.platform_store ps
   where cs.account_id = v_acc and cs.location_id is null and ps.id = cs.store_id and ps.account_id = v_acc and ps.location_id is null
     and public._conta_local_de_texto(v_acc, array[coalesce(ps.external_text, cs.external_location_text)]) = p_location;
  get diagnostics v_locales = row_count;
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
  return jsonb_build_object('guardadas', v_n, 'buscadas', v_buscadas, 'ligadas', v_ligadas, 'liquidaciones', v_locales,
    'texto', format('%s: %s.%s%s', v_nombre,
      case when v_n = 0 then 'sin otras direcciones' when v_n = 1 then 'guardada 1 otra dirección' else format('guardadas %s otras direcciones', v_n) end,
      case when v_buscadas = 0 then ''
           else format(' Vuelta a buscar la liquidación de %s %s sin ligar: %s.', v_buscadas,
             case when v_buscadas = 1 then 'factura de plataformas' else 'facturas de plataformas' end,
             case when v_ligadas = 0 then 'ninguna se ha ligado aún' when v_ligadas = 1 then '1 ligada ahora' else format('%s ligadas ahora', v_ligadas) end) end,
      case when v_locales = 0 then ''
           when v_locales = 1 then format(' Puesto %s en 1 liquidación que no tenía local.', v_nombre)
           else format(' Puesto %s en %s liquidaciones que no tenían local.', v_nombre, v_locales) end));
end $$;
