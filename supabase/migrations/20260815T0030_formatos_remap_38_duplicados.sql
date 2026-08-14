-- ----------------------------------------------------------------------------
-- Folvy - 20260815T0030
-- Formatos (Tramo C.3): repuntar los 38 duplicados con historial
-- ----------------------------------------------------------------------------
--
-- QUE ES ESTO
-- -----------
-- De la auditoría F1 (14/08): 54 duplicados exactos, 16 archivados ese mismo
-- día por no tener ninguna referencia. Quedaban 38 con historial real -- este
-- es el remap de esos 38.
--
-- DEFINICION DE "DUPLICADO EXACTO" (reproducible, verificada contra datos
-- reales -- agrupar solo por item_id+qty_in_base daba 49 grupos/62 sobrantes;
-- añadir el nombre normalizado (minúsculas, trim) da exactamente 32
-- grupos/38 sobrantes, el número que ya tenía Julio):
--   GROUP BY item_id, qty_in_base, lower(trim(name))  HAVING count(*) > 1
--
-- SUPERVIVIENTE: el de más uso real, en este orden -- líneas de recepción
-- (goods_receipt_line) > fichas de proveedor (article_supplier) > líneas de
-- pedido (purchase_order_line) > preferencia de unidad (user_item_unit_pref)
-- > más antiguo. Empate a cero en casi todos los grupos porque el uso real
-- ya estaba casi todo concentrado en uno de los dos -- el criterio solo
-- decide de verdad en un puñado de grupos.
--
-- QUÉ SE REPUNTA Y QUÉ NO:
--   article_supplier.purchase_format_id      -> SÍ, al superviviente
--   purchase_order_line.purchase_format_id   -> SÍ, al superviviente
--   user_item_unit_pref.purchase_format_id   -> SÍ, al superviviente (0 filas reales)
--   goods_receipt_line.purchase_format_id    -> NO. Es la foto de lo que pasó.
--     7 líneas históricas siguen apuntando a un formato ahora archivado --
--     es exactamente lo que Ley 3 pide: el histórico no se toca, se archiva
--     el formato y se sigue viendo desde dónde vino cada recepción pasada.
--
-- HALLAZGO OPERATIVO REAL (no de datos, de la propia sesión de MCP): al
-- impersonar con request.jwt.claims + set_config('role','authenticated') a
-- la vez -- el patrón usado en el resto de la sesión para satisfacer los
-- guards de las funciones -- los UPDATE directos (no vía RPC) sobre
-- article_supplier se ejecutaban SIN ERROR pero afectaban CERO filas: RLS
-- se activa al cambiar el rol de sesión, y las filas con el account_id
-- placeholder (ver migración 20260814T2300) quedan invisibles al UPDATE bajo
-- esa política. Las llamadas SECURITY DEFINER (como resolve_goods_receipt_
-- line_format) no lo sufren porque corren con el rol del dueño de la
-- función, no con el de la sesión. Para UPDATE directos hace falta
-- impersonar SOLO request.jwt.claims (de ahí lee auth.uid()) y dejar el rol
-- de sesión tal cual (superusuario, sin RLS) -- así se hizo aquí.
--
-- VERIFICADO EN VIVO tras aplicar: article_supplier/purchase_order_line/
-- user_item_unit_pref apuntando a un perdedor = 0; perdedores archivados =
-- 38; goods_receipt_line histórico apuntando a un perdedor = 7 (intacto,
-- como debe ser); stock_movement de Llorente29 (source_type=
-- goods_receipt_line) = 658 antes y después -- nada de esto tocó stock;
-- formatos activos 303 -> 265 (-38, exacto).
--
-- MAPA VIEJO -> SUPERVIVIENTE (38 filas, artículo · formato · qty_in_base):
--   e72ca948-5fe7-4c79-8a2e-ed8766eaff22 -> 677b6413-e431-42ad-9b12-40b75490512d  Aceite Alto Oleico · Bidón · 25000
--   de85df87-974d-4ade-898f-053025a8fafe -> 01d269d0-25cf-493a-98ec-1dbda29ed181  Agua Mineral 50 CL · Ud · 1
--   d3370d46-bd95-4afb-abb3-0b8a2745ee9a -> aabc852d-049a-4479-9b5d-64c36c35ab13  Bacon Ahumado · Paquete · 1000
--   eb8c7539-2dbc-4541-8cba-7f8ce326419e -> 99f3c358-4727-4583-bf04-9f1a6393fe61  Bacon Ahumado · Caja · 5000
--   1a5b27f5-102d-4f33-a23d-7f14a43833e4 -> 4f443184-0930-4f59-92e9-50b076bed611  CAJA GENERICA 780 Ml · Caja · 250
--   616e2155-df41-479c-a85c-4d70f12dafe4 -> a6fcf305-1af7-406e-9c0c-6ba0f7ed623b  Caldo de Birria · Bolsa · 2000
--   28a961c2-412c-435b-bcb1-79cfda44709a -> a6fcf305-1af7-406e-9c0c-6ba0f7ed623b  Caldo de Birria · Bolsa · 2000
--   cf1f7fa1-405f-4202-9ba9-9dfdc6b07495 -> 09e55d79-af00-4952-831f-9cbfb783142c  Caldo de Birria · Caja · 6000
--   29ebd69f-3655-4729-9bc8-3d14459adfe2 -> d38ccf34-3407-4e3c-81d6-85f2953ade0c  Carne de Birria · Bolsa · 2000
--   ee4be21c-c29f-4343-929f-d0581454e305 -> d38ccf34-3407-4e3c-81d6-85f2953ade0c  Carne de Birria · Bolsa · 2000
--   1f906e74-16e7-4e66-afbf-4e9b0f2c97bf -> 620ec2cf-7c49-4312-9a9a-2127c6231e0d  Carne de Birria · Caja · 6000
--   51a5a3d7-db0f-4f0c-ad7f-a64b77d45ff3 -> aa86bafe-b405-4e59-b6e9-99f740bce8a1  Crema Agria · Bote · 500
--   418e01e1-f392-4390-92a5-cbc7ebea287c -> 3f17328f-4ad4-4095-b0ca-a5027ebaed1a  DELICIAS DE POLLO SOUTHERN · Caja · 3000
--   78bf0893-28a2-40b8-8204-962bf0913032 -> 3f17328f-4ad4-4095-b0ca-a5027ebaed1a  DELICIAS DE POLLO SOUTHERN · Caja · 3000
--   70c72feb-b58e-4845-91b6-b75afc22f816 -> 9a673d6e-5c05-433a-be61-429e78f5ce29  Kebab Pollo Loncheado · Bolsa · 1000
--   f3a4a71e-f2ba-490f-9553-ec1a03fff2ec -> 9a673d6e-5c05-433a-be61-429e78f5ce29  Kebab Pollo Loncheado · Bolsa · 1000
--   2af3dabd-5cb6-4cd3-842d-a570840d6b90 -> ab61069c-1876-4cb1-9011-f5b9ab55c8c3  Kebab Pollo Loncheado · Caja · 10000
--   f986cca8-c7b2-4262-b04e-e150b60bcc26 -> 71669ea1-6b0c-443b-aa17-b9ccb2b8f15c  Kebab Ternera Loncheado · Bolsa · 1000
--   496c06bb-f388-469a-9a0f-d6dde3f1d8c6 -> 8377eaef-dddd-4d76-b745-c539f9581ca1  Kebab Ternera Loncheado · Caja · 8000
--   8d102d3d-1afe-4f5c-a61d-e51bdeeb431a -> 69d98209-43b1-4b55-ad8c-236b17c3d24e  Patatas Bastón · caja · 10000
--   475cb66b-a917-4735-b93e-3f8a94b3da8f -> d675dd79-d2dc-438c-a4c8-d026f680c8d5  Pollo Mechado · Bolsa · 2000
--   385be964-9b97-4f9b-8981-046875a1fd80 -> d675dd79-d2dc-438c-a4c8-d026f680c8d5  Pollo Mechado · Bolsa · 2000
--   e7e209c3-3b0f-4ad2-ac3c-6b581e2b9dbe -> 3762654a-2bec-4703-afd9-0714b8d12e4e  Pollo Mechado · Caja · 6000
--   099e5fa0-7d7c-41dc-83c8-ededb64414ac -> d0ce1ae1-b871-4db3-9bfa-1244ef85ec48  Pulled Pork · Bolsa · 1300
--   97c4a278-d0ab-47c2-8120-97dec0de0f9f -> adb886bd-e3d3-4bbe-976f-0f41ba965798  Pulled Pork · Caja · 6000
--   fe1c054d-5353-44ea-9a60-c23b5904b021 -> e4443a3c-0ba2-45aa-a0ef-15d0fdae62de  Pulled Pork · Caja · 6500
--   19a2c68c-2f4b-4c1b-99c5-1572f3f88116 -> fcc01972-aafe-4e30-84f0-5ce2e4789b28  Queso Cheddar Loncheado · Paquete · 1000
--   f3913d37-dce5-4c38-8779-349709e30c23 -> e3ccd578-db2f-4d6d-a716-a93f9100acd3  Queso Gouda Loncheado · Paquete · 1000
--   01597ee4-d252-489f-b730-d252c9df75f4 -> e3ccd578-db2f-4d6d-a716-a93f9100acd3  Queso Gouda Loncheado · Paquete · 1000
--   ec193c78-d506-4ada-8fc7-5d67ecfecacc -> b152c724-f7d7-4fd6-8c68-2e296c1dcdfc  Queso Mozarela · Bolsa · 1500
--   0f1a0f3c-ed2f-43da-9b31-d6dad018f5fb -> 0c54d911-a6f4-4178-8cf3-a1f9af98c1d3  Queso Mozarela · Bolsa · 2000
--   42a0ccec-029c-4ae7-a266-1c80cc0ce097 -> 6f60cbf7-86dc-4c45-8035-85f9fc205b45  Salsa BBQ · Bolsa · 2000
--   817e023f-c947-4266-830f-85dc144ee614 -> 51434fda-8ff5-4949-b0a9-05d006958b71  Salsa BBQ · Caja · 3000
--   fdb3540e-a3a4-46e3-a602-716cdd5e3bf9 -> 3ebdcc62-8ddc-4dc7-810e-1d89cadc5490  Salsa Coreana · Uni · 1000
--   7aa2fdf2-84bb-41b0-b77d-a8bf4c1bdf96 -> 06b17459-43f8-46ad-af73-033f4765a740  Salsa Melt · Uni · 1000
--   7f0aecd6-9dc2-49d4-ac4e-0ceea54d2ba0 -> 575dcfbe-8cb4-4ff6-883f-e2e5cdaab6fb  Salsa Melt · Caja · 3000
--   45f19093-2b83-4970-a0c5-7d6b7523f624 -> edbad31a-97c6-41f3-b035-e67325669b74  Salsa Mil Islas · Caja · 3000
--   8c7aac54-847e-406f-8eb9-b315a1926d53 -> 32b6a212-9eb5-41a3-b8f5-70cf422e1ba2  SALSA Yogur · Bote · 1000
--
-- Este archivo documenta un remap de DATOS ya aplicado en producción (no
-- schema). El cuerpo es idempotente -- si se reejecuta sobre una cuenta
-- donde esto ya está aplicado, no encuentra duplicados activos que
-- remapear y no hace nada.
-- ----------------------------------------------------------------------------

do $$
declare
  v_account_id uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
begin
  create temp table _fmt_remap_20260815 on commit drop as
  with dupes as (
    select item_id, qty_in_base, lower(trim(name)) as name_norm
    from recipe_item_purchase_format
    where account_id = v_account_id and is_active and archived_at is null
    group by item_id, qty_in_base, lower(trim(name))
    having count(*) > 1
  ),
  scored as (
    select f.id, f.item_id, f.qty_in_base, lower(trim(f.name)) as name_norm, f.created_at,
           (select count(*) from goods_receipt_line grl where grl.purchase_format_id = f.id) as n_grl,
           (select count(*) from article_supplier a where a.purchase_format_id = f.id) as n_as,
           (select count(*) from purchase_order_line pol where pol.purchase_format_id = f.id) as n_pol,
           (select count(*) from user_item_unit_pref u where u.purchase_format_id = f.id) as n_pref
    from recipe_item_purchase_format f
    join dupes d on d.item_id = f.item_id and d.qty_in_base = f.qty_in_base and d.name_norm = lower(trim(f.name))
    where f.account_id = v_account_id and f.is_active and f.archived_at is null
  ),
  ranked as (
    select *,
      row_number() over (
        partition by item_id, qty_in_base, name_norm
        order by n_grl desc, n_as desc, n_pol desc, n_pref desc, created_at asc
      ) as rn
    from scored
  )
  select l.id as loser_id, s.id as survivor_id
  from ranked l
  join ranked s on s.item_id = l.item_id and s.qty_in_base = l.qty_in_base and s.name_norm = l.name_norm and s.rn = 1
  where l.rn > 1;

  update article_supplier a set purchase_format_id = r.survivor_id, updated_at = now()
  from _fmt_remap_20260815 r where a.purchase_format_id = r.loser_id;

  update purchase_order_line pol set purchase_format_id = r.survivor_id
  from _fmt_remap_20260815 r where pol.purchase_format_id = r.loser_id;

  update user_item_unit_pref u set purchase_format_id = r.survivor_id
  from _fmt_remap_20260815 r where u.purchase_format_id = r.loser_id;

  update recipe_item_purchase_format f set is_active = false, archived_at = now()
  from _fmt_remap_20260815 r where f.id = r.loser_id;
end $$;
