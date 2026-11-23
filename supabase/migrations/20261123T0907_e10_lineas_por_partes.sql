-- supabase/migrations/20261123T0907_e10_lineas_por_partes.sql
--
-- E10 · La factura larga se lee entera (23/11). Cuando la lectura de una factura llega
-- cortada (trae más líneas de las que caben en una respuesta), ocr-albaran la lee en dos
-- pasos: la cabecera primero (la sesión se guarda como siempre y la factura entra con sus
-- bases) y las líneas después, página a página. Esta función guarda esas líneas cuando
-- terminan. Solo AÑADE una función nueva: no cambia conta_factura_desde_lectura ni nada de
-- lo que existe.
--
--   conta_lectura_lineas_guardar(sesión, líneas, validación): en la sesión, sus líneas
--   (parsed_result.lines) y su validación (con validation.lineas: cuántas se han leído de
--   cuántas, las páginas que faltan y si suman la base); y en cada factura hecha de esa
--   sesión, sus líneas (supplier_invoice_line), como las pone conta_factura_desde_lectura.
--   Las líneas de una factura que ya tiene alguna casada con un albarán o un artículo no se
--   tocan (se dice). Si la factura aún no existe, la creará conta_factura_desde_lectura con
--   las líneas de la sesión.
--
-- La llama ocr-albaran (con la llamada interna o con la sesión de quien pulsa «Leer las que
-- faltan»). Se puede pasar dos veces (create or replace).
-- Vuelta atrás: supabase/vuelta-atras/20261123T0907_e10_lineas_por_partes.down.sql

create or replace function public.conta_lectura_lineas_guardar(p_session uuid, p_lineas jsonb, p_validacion jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $function$
declare v_s record; f record; v_facturas int := 0; v_casadas int := 0; v_n int;
begin
  select id, account_id into v_s from public.goods_receipt_ai_session where id = p_session for update;
  if v_s.id is null then raise exception 'Esa lectura no está.' using errcode = 'P0002'; end if;
  if not (coalesce(auth.role(), '') = 'service_role' or public.current_user_is_admin_or_manager_of(v_s.account_id)) then
    raise exception 'Solo un administrador o un encargado de la cuenta.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_lineas, 'null'::jsonb)) <> 'array' then raise exception 'Las líneas tienen que ser una lista.' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_validacion, 'null'::jsonb)) <> 'object' then raise exception 'Falta la validación.' using errcode = '22023'; end if;

  update public.goods_receipt_ai_session
     set parsed_result = jsonb_set(coalesce(parsed_result, '{}'::jsonb), '{lines}', p_lineas, true),
         validation = p_validacion,
         updated_at = now()
   where id = p_session;

  for f in select i.id from public.supplier_invoice i where i.ai_session_id = p_session and i.account_id = v_s.account_id loop
    if exists (select 1 from public.supplier_invoice_line l where l.supplier_invoice_id = f.id
                and (l.goods_receipt_line_id is not null or l.recipe_item_id is not null)) then
      v_casadas := v_casadas + 1;
      continue;
    end if;
    delete from public.supplier_invoice_line where supplier_invoice_id = f.id;
    -- Las mismas columnas que pone conta_factura_desde_lectura al crearla.
    insert into public.supplier_invoice_line (supplier_invoice_id, raw_text, qty, unit_price, line_amount, vat_pct, position)
    select f.id, coalesce(x->>'raw_text', '—'), nullif(x->>'quantity', '')::numeric, nullif(x->>'unit_price_net', '')::numeric,
           nullif(x->>'line_amount', '')::numeric, nullif(x->>'vat_pct', '')::numeric, o::int
      from jsonb_array_elements(p_lineas) with ordinality as e(x, o);
    v_facturas := v_facturas + 1;
  end loop;
  v_n := jsonb_array_length(p_lineas);
  return jsonb_build_object('facturas', v_facturas, 'lineas', v_n, 'casadas', v_casadas);
end $function$;
comment on function public.conta_lectura_lineas_guardar(uuid, jsonb, jsonb) is
  'E10: guarda las líneas de una factura larga leída por páginas, en su sesión de lectura (con cuántas se han leído de cuántas) y en cada factura hecha de esa sesión (si ninguna línea está casada). La llama ocr-albaran.';
revoke all on function public.conta_lectura_lineas_guardar(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.conta_lectura_lineas_guardar(uuid, jsonb, jsonb) to authenticated, service_role;
