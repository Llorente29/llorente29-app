-- 20260703T2010_customer_reorder_payload_brands.sql
-- Aplicada: (pendiente)
--
-- F4·T2 (pulido b) — customer_reorder_payload devuelve además brandById: un mapa
-- { menuItemId -> { brandId, brandName } } leído de menu_item -> brand, para que
-- replaceCart pueble la marca de cada línea (antes la cabecera de marca del
-- CartPanel salía vacía tras un reorder). Resto IDÉNTICO a la de 20260703T1010.
--
-- CREATE OR REPLACE de UNA sola función (misma firma text, uuid). Valida SOLO el
-- token de customer_session. No se prueba en la tx que la crea.

begin;

create or replace function public.customer_reorder_payload(p_token text, p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_customer uuid;
  v_acc      uuid;
  v_sale     sale%rowtype;
  v_raw      jsonb;
  v_brands   jsonb;
begin
  select customer_id, account_id into v_customer, v_acc
  from customer_session
  where token = nullif(btrim(p_token),'') and revoked_at is null and expires_at > now()
  limit 1;
  if v_customer is null then
    return jsonb_build_object('ok', false, 'reason', 'session');
  end if;

  select * into v_sale from sale where id = p_sale_id;
  if v_sale.id is null or v_sale.customer_id is distinct from v_customer or v_sale.source <> 'folvy_shop' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  v_raw := nullif(v_sale.raw_tab,'')::jsonb;

  -- Marca por menuItemId de las líneas del payload (para poblar el carrito).
  select coalesce(jsonb_object_agg(mi.id::text,
           jsonb_build_object('brandId', mi.brand_id, 'brandName', b.name)), '{}'::jsonb)
  into v_brands
  from (
    select distinct nullif(l->>'menuItemId','')::uuid as mid
    from jsonb_array_elements(coalesce(v_raw->'lines','[]'::jsonb)) l
    where nullif(l->>'menuItemId','') is not null
  ) ids
  join menu_item mi on mi.id = ids.mid and mi.account_id = v_acc
  join brand b on b.id = mi.brand_id;

  return jsonb_build_object(
    'ok', true,
    'payload', jsonb_build_object(
      'locationId', v_raw ->> 'locationId',
      'mode',       coalesce(v_raw ->> 'mode', 'delivery'),
      'lines',      coalesce(v_raw -> 'lines', '[]'::jsonb),
      'brandById',  coalesce(v_brands, '{}'::jsonb)
    )
  );
end;
$fn$;

grant execute on function public.customer_reorder_payload(text, uuid) to anon, authenticated;

commit;
