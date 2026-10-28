-- supabase/migrations/20261028T1555_s01b2_lectura_releida.sql
--
-- S01b2 · Volver a leer la factura al darla de alta (Julio, 28/10). Solo añade
-- una función.
--
-- Las facturas leídas antes del 28/10 no tienen en su lectura el teléfono ni la
-- web del proveedor: el lector (_shared/lecturaFactura.ts) no los pedía. Al
-- pulsar «Dar de alta a …», o al validar con una ficha a la que le falta algo,
-- el navegador vuelve a leer su PDF con el lector de siempre (ocr-albaran, modo
-- factura, como «Subir factura»), que deja la lectura en una
-- goods_receipt_ai_session. Esta función la toma DE ESA SESIÓN, no del
-- navegador, y completa la lectura guardada de la factura:
--
--   conta_lectura_proveedor_releida(factura, sesión)
--     · la sesión tiene que ser de la misma cuenta y de ESE PDF (su ruta);
--     · completa reading->factura->proveedor solo con lo que le faltaba
--       (teléfono, web, correo, dirección); nunca cambia el nombre ni el NIF ni
--       lo que ya traía;
--     · deja las claves «telefono» y «web» siempre (vacías si la factura no
--       las trae), y así no se vuelve a leer;
--     · apunta la relectura en su historial (document_activity) y devuelve el
--       proveedor como ha quedado y lo nuevo.
--
-- Medido en producción el 28/10 (solo lectura): Foodint, 98 recibidas, 85 con
-- lectura y las 85 sin las claves «telefono» y «web». No está en el camino del
-- pedido.
--
-- Vuelta atrás: supabase/vuelta-atras/20261028T1555_s01b2_lectura_releida.down.sql

create or replace function public.conta_lectura_proveedor_releida(p_invoice uuid, p_session uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_f public.supplier_invoice;
  v_s record;
  v_quien text := coalesce(public.conta_nombre_actor(), 'Sumied');
  v_antes jsonb; v_leido jsonb; v_nuevo jsonb; v_puesto text[] := '{}';
  k text;
begin
  select * into v_f from public.supplier_invoice where id = p_invoice for update;
  if v_f.id is null or not public.current_user_is_admin_or_manager_of(v_f.account_id) then
    raise exception 'Esa factura no está, o no puedes revisarla.' using errcode = 'P0002';
  end if;
  if v_f.raw_document_url is null then raise exception 'Esta factura no tiene PDF guardado: no hay nada que volver a leer.' using errcode = '22023'; end if;
  select s.id, s.input_files, s.validation into v_s from public.goods_receipt_ai_session s where s.id = p_session and s.account_id = v_f.account_id;
  if v_s.id is null then raise exception 'Esa lectura no está.' using errcode = 'P0002'; end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(v_s.input_files, '[]'::jsonb)) x where x->>'path' = v_f.raw_document_url) then
    raise exception 'Esa lectura no es del PDF de esta factura.' using errcode = '23514';
  end if;
  v_leido := v_s.validation->'factura'->'factura'->'proveedor';
  if v_leido is null or jsonb_typeof(v_leido) <> 'object' then raise exception 'La lectura no ha sacado nada del proveedor.' using errcode = '22023'; end if;

  v_antes := coalesce(v_f.reading->'factura'->'proveedor', '{}'::jsonb);
  v_nuevo := v_antes;
  -- Solo lo que faltaba (o venía vacío): nombre y NIF no se tocan nunca.
  foreach k in array array['telefono', 'web', 'email', 'direccion'] loop
    if nullif(btrim(coalesce(v_antes->>k, '')), '') is null and nullif(btrim(coalesce(v_leido->>k, '')), '') is not null then
      v_nuevo := v_nuevo || jsonb_build_object(k, v_leido->>k);
      v_puesto := v_puesto || k;
    end if;
  end loop;
  -- Las claves nuevas, siempre: vacías si la factura no las trae (ya está leída con el lector de hoy).
  if not (v_nuevo ? 'telefono') then v_nuevo := v_nuevo || jsonb_build_object('telefono', null); end if;
  if not (v_nuevo ? 'web') then v_nuevo := v_nuevo || jsonb_build_object('web', null); end if;

  update public.supplier_invoice
     set reading = jsonb_set(
           jsonb_set(coalesce(reading, '{}'::jsonb), '{factura}', coalesce(reading->'factura', '{}'::jsonb) || jsonb_build_object('proveedor', v_nuevo)),
           '{releida}', jsonb_build_object('sesion', v_s.id, 'cuando', now(), 'quien', v_quien, 'puesto', to_jsonb(v_puesto))),
         updated_at = now()
   where id = v_f.id;

  insert into public.document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, actor_name, action, text, detail)
  values (v_f.account_id, v_f.company_id, v_f.inbox_id, v_f.id, 'persona', v_quien, 'leida',
          case when cardinality(v_puesto) = 0
               then format('%s vuelve a leer su PDF para los datos del proveedor: no trae nada más de lo que ya tenía.', v_quien)
               else format('%s vuelve a leer su PDF para los datos del proveedor: añade %s.', v_quien,
                           regexp_replace(array_to_string(array(select case x when 'telefono' then 'el teléfono' when 'web' then 'la web' when 'email' then 'el correo' else 'la dirección' end from unnest(v_puesto) x), ', '), ', ([^,]*)$', ' y \1')) end,
          jsonb_build_object('releida', true, 'sesion', v_s.id, 'puesto', to_jsonb(v_puesto)));

  return jsonb_build_object('proveedor', v_nuevo, 'puesto', to_jsonb(v_puesto));
end $$;
revoke all on function public.conta_lectura_proveedor_releida(uuid, uuid) from public, anon;
grant execute on function public.conta_lectura_proveedor_releida(uuid, uuid) to authenticated;
comment on function public.conta_lectura_proveedor_releida(uuid, uuid) is
  'S01b2 · Completa la lectura guardada de una factura con lo que le faltaba del proveedor (teléfono, web, correo, dirección), tomado de una relectura de SU PDF (goods_receipt_ai_session). Nunca cambia nombre ni NIF.';
