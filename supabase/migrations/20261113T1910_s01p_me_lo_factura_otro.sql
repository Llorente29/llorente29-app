-- supabase/migrations/20261113T1910_s01p_me_lo_factura_otro.sql
--
-- S01p·20·2 · «Me lo factura otro» (Julio, 13/11), 1 de 2: LO QUE AÑADE. Hay proveedores que
-- traen el género pero no facturan: lo factura otro proveedor en su factura de género. El caso de
-- Foodint: MANUFACTURAS CATOR trae, y lo factura Cloudtown en su liquidación del mes. Hasta hoy, la
-- ficha de CATOR preguntaba «cómo factura» y «tipo de gasto», salía en «Qué tienes que mirar», y su
-- recepción decía que «CATOR liquida cada mes», que no es verdad.
--
-- En la ficha, una opción más en «¿Cómo te factura?»: «Me lo factura otro», con quién (un contacto
-- de Compras). La forma es tener a alguien en supplier.invoiced_by_supplier_id: no se toca el
-- CHECK de invoicing_mode.
--
-- AÑADE: supplier.invoiced_by_supplier_id (columna que admite nulos) y compras_lo_factura_otro
-- (el botón). Solo añade y se puede pasar dos veces: staging la aplica de verdad desde la rama, y
-- la pantalla la lee antes de fusionar. Lo que cambia (los caminos, la ficha, «Qué tienes que
-- mirar» y elegir otra forma) va en la 20261114T0033, que se ensaya en ROLLBACK.
--
-- No toca ningún dato: CATOR → Cloudtown se elige en la pantalla. Nada en el camino del pedido.

alter table public.supplier add column if not exists invoiced_by_supplier_id uuid references public.supplier(id) on delete set null;
comment on column public.supplier.invoiced_by_supplier_id is
  'S01p·20·2. «Me lo factura otro»: el proveedor que factura lo que trae éste, en su factura de género. Con él, no se espera ninguna factura de éste.';

-- El botón: «Me lo factura otro», con quién. Vuelve a decidir sus recepciones y lo dice (regla 8).
create or replace function public.compras_lo_factura_otro(p_proveedor uuid, p_otro uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare s supplier; o supplier; r record; v_n int := 0;
begin
  select * into s from supplier where id = p_proveedor;
  if s.id is null then raise exception 'Ese proveedor no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(s.account_id) then
    raise exception 'No puedes cambiar esta ficha.' using errcode = '42501';
  end if;
  select * into o from supplier where id = p_otro and account_id = s.account_id;
  if o.id is null then raise exception 'Ese contacto no es de tu cuenta.' using errcode = 'P0002'; end if;
  if o.id = s.id then raise exception 'No puede facturarse a sí mismo: elige quién te lo factura.' using errcode = '22023'; end if;
  if o.archived_at is not null then raise exception '% está archivado: elige uno que siga vivo.', o.name using errcode = '22023'; end if;
  if o.invoiced_by_supplier_id is not null then
    raise exception 'A % también se lo factura otro: elige el que factura de verdad.', o.name using errcode = '22023';
  end if;
  if exists (select 1 from supplier x where x.invoiced_by_supplier_id = s.id and x.archived_at is null) then
    raise exception '% factura lo de otros proveedores: no puede facturárselo otro a él.', s.name using errcode = '22023';
  end if;

  update supplier set invoiced_by_supplier_id = o.id, invoicing_mode = null, invoicing_per_location = null, invoicing_frequency = null
   where id = s.id;
  -- Sus recepciones abiertas (y las que esperaban una pregunta de la ficha), como _compras_forma_facturar.
  for r in select p.goods_receipt_id from goods_receipt_path p join goods_receipt g on g.id = p.goods_receipt_id
            where p.account_id = s.account_id
              and (p.consumed_at is null or p.question in ('ficha_sin_forma', 'papel_y_ficha'))
              and (g.supplier_id = s.id or p.supplier_id = s.id
                   or (p.question = 'a_nombre_de' and (p.question_detail->>'proveedor')::uuid = s.id)) loop
    perform public._compras_camino_guarda(r.goods_receipt_id); v_n := v_n + 1;
  end loop;
  return jsonb_build_object('proveedor', s.id, 'otro', o.id, 'otro_nombre', o.name, 'recepciones', v_n,
    'mensaje', format('Guardado: lo de %s lo factura %s en su factura de género. No espero ninguna factura de %s.%s',
                      s.name, o.name, s.name,
                      case when v_n = 1 then ' He vuelto a mirar su recepción abierta.'
                           when v_n > 1 then format(' He vuelto a mirar sus %s recepciones abiertas.', v_n) else '' end));
end $function$;
revoke all on function public.compras_lo_factura_otro(uuid, uuid) from public, anon;
grant execute on function public.compras_lo_factura_otro(uuid, uuid) to authenticated;
comment on function public.compras_lo_factura_otro(uuid, uuid) is
  'S01p·20·2. «Me lo factura otro»: el proveedor p_otro factura lo que trae p_proveedor. Vuelve a decidir sus recepciones abiertas y lo dice.';
