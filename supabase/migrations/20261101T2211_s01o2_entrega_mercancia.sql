-- supabase/migrations/20261101T2211_s01o2_entrega_mercancia.sql
-- cambia: public._compras_casar_solo · prueba: supabase/staging/sql/20261101_s01o2_resto_prueba.sql
-- cambia: public.conta_correo_facturas · prueba: supabase/staging/sql/20261101_s01o2_resto_prueba.sql
--
-- S01o·2 · Un proveedor de servicios no espera albarán (Julio, 01/11, respuesta 6,
-- decisión 3). Medido el 01/11: 156 facturas de servicios quedaron con «Espera su
-- albarán» (Glovo 131, Uber 13, Vercel, Supabase, Xfera, Tatic, Juan Grande y
-- Anthropic): ninguno ha tenido nunca un albarán y todos van a cuentas 62x.
--
--   1. supplier.delivers_goods: «Entrega mercancía» en la ficha. Vacío = lo deduce Sumied.
--   2. _conta_entrega_mercancia(proveedor): lo de la ficha; si no, sí si ha tenido
--      algún albarán o su gasto (ficha o asientos validados) va a 600–602; si no, no.
--   3. _compras_casar_solo no casa ni escribe «Espera su albarán» para uno que no entrega.
--   4. conta_correo_facturas dice si la factura espera albarán, y las notas viejas
--      de «Espera su albarán» de un proveedor de servicios quedan en el historial
--      y dejan de salir en la pantalla.
-- Misma firma, sobre la definición VIVA, con su respaldo.

alter table public.supplier add column if not exists delivers_goods boolean;
comment on column public.supplier.delivers_goods is 'S01o·2 · «Entrega mercancía» (sus facturas esperan albarán). Vacío: lo deduce _conta_entrega_mercancia.';

create or replace function public._conta_entrega_mercancia(p_supplier uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select case when p_supplier is null then null else coalesce(
    (select s.delivers_goods from public.supplier s where s.id = p_supplier),
    exists (select 1 from public.goods_receipt g where g.supplier_id = p_supplier)
      or exists (select 1 from public.company_account_link k join public.company_account a on a.id = k.company_account_id
                  where k.entity = 'supplier' and k.entity_id = p_supplier::text and k.role = 'gasto' and a.code ~ '^60[0-2]')
      or exists (select 1 from public.supplier_invoice x join public.journal_entry e on e.source_type = 'supplier_invoice' and e.source_id = x.id and e.status = 'validado'
                   join public.journal_line l on l.entry_id = e.id join public.company_account a on a.id = l.company_account_id
                  where x.supplier_id = p_supplier and a.code ~ '^60[0-2]')) end
$$;
revoke all on function public._conta_entrega_mercancia(uuid) from public, anon;
grant execute on function public._conta_entrega_mercancia(uuid) to authenticated;
comment on function public._conta_entrega_mercancia(uuid) is 'S01o·2 · ¿Entrega mercancía (sus facturas esperan albarán)? La ficha manda; si no dice, sí con algún albarán o con gasto en 600–602.';

select public._respaldar_funcion('public._compras_casar_solo(uuid)', '20261101T2211_s01o2_entrega_mercancia');
select public._respaldar_funcion('public.conta_correo_facturas(uuid)', '20261101T2211_s01o2_entrega_mercancia');

do $$
declare v_def text; v_n int; v_antes text;
begin
  v_def := pg_get_functiondef('public._compras_casar_solo(uuid)'::regprocedure);
  v_antes := 'select * into s from supplier where id = f.supplier_id;';
  v_n := (length(v_def) - length(replace(v_def, v_antes, ''))) / length(v_antes);
  if v_n <> 1 then raise exception 'S01o·2: public._compras_casar_solo no tiene una sola vez el trozo que se cambia (lo tiene % veces): no se cambia nada.', v_n; end if;
  v_def := replace(v_def, v_antes, 'select * into s from supplier where id = f.supplier_id;
  -- S01o·2 · Un proveedor de servicios no entrega mercancía: su factura no espera albarán.
  if public._conta_entrega_mercancia(s.id) is false then return null; end if;');
  execute v_def;
  v_def := pg_get_functiondef('public.conta_correo_facturas(uuid)'::regprocedure);
  v_antes := '''casada'', exists (select 1 from supplier_invoice_receipt r where r.supplier_invoice_id = si.id))';
  v_n := (length(v_def) - length(replace(v_def, v_antes, ''))) / length(v_antes);
  if v_n <> 1 then raise exception 'S01o·2: public.conta_correo_facturas no tiene una sola vez el trozo que se cambia (lo tiene % veces): no se cambia nada.', v_n; end if;
  v_def := replace(v_def, v_antes, '''casada'', exists (select 1 from supplier_invoice_receipt r where r.supplier_invoice_id = si.id),
                                                                         ''espera_albaran'', public._conta_entrega_mercancia(si.supplier_id) is not false)');
  v_antes := 'and da.action in (''casada'', ''propuesta'') order by';
  v_n := (length(v_def) - length(replace(v_def, v_antes, ''))) / length(v_antes);
  if v_n <> 1 then raise exception 'S01o·2: public.conta_correo_facturas no tiene una sola vez el trozo que se cambia (lo tiene % veces): no se cambia nada.', v_n; end if;
  v_def := replace(v_def, v_antes, 'and da.action in (''casada'', ''propuesta'')
                         -- S01o·2 · «Espera su albarán» de un proveedor de servicios: queda en el historial, no sale aquí.
                         and not (coalesce((da.detail->>''espera_albaran'')::boolean, false) and public._conta_entrega_mercancia(si.supplier_id) is false) order by');
  execute v_def;
end $$;
