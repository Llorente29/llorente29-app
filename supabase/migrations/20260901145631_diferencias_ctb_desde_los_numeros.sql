alter table app_settings
  add column if not exists ctb_diff_pct numeric not null default 10,
  add column if not exists ctb_diff_eur numeric not null default 15;

comment on column app_settings.ctb_diff_pct is
  'Diferencia mínima, en % de lo facturado, para reclamar una línea de cantidad continua (peso/volumen/longitud). Las unidades no usan umbral.';
comment on column app_settings.ctb_diff_eur is
  'Valor en euros a partir del cual una diferencia se reclama aunque no llegue al %. Evita perdonar en silencio en cantidades grandes.';

create or replace function public._ctb_receipt_differences_core(p_receipt_id uuid)
returns table (
  -- `linea` y no `position`: position es funcion de SQL y plpgsql puede
  -- confundir la variable de salida con ella.
  linea          integer,
  product_name   text,
  doc_qty        numeric,
  qty_received   numeric,
  diferencia     numeric,
  dimension      text,
  valor_eur      numeric,
  motivo         text,
  -- diferencia    · cuenta como reclamación
  -- ruido         · hay diferencia pero por debajo del umbral
  -- no_comparable · el papel no dice cantidad
  -- solo_nota     · sin diferencia de cantidad, pero alguien escribió algo
  clase          text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_pct numeric;
  v_eur numeric;
begin
  -- SIN guarda de sesión, a propósito: la llaman confirm_goods_receipt (que ya
  -- validó el acceso) y la verificación de esta migración, que corre sin
  -- auth.uid(). La protección son los permisos de abajo.
  if not exists (select 1 from goods_receipt where id = p_receipt_id) then
    raise exception '_ctb_receipt_differences_core: albarán % no existe', p_receipt_id;
  end if;

  -- Si la fila de ajustes no existiera, los defaults viajan aquí: el cálculo
  -- nunca se queda sin umbral ni cae en cero (cero reclamaría cada décima).
  select coalesce(s.ctb_diff_pct, 10), coalesce(s.ctb_diff_eur, 15)
    into v_pct, v_eur
    from app_settings s where s.scope = 'global' limit 1;
  v_pct := coalesce(v_pct, 10);
  v_eur := coalesce(v_eur, 15);

  return query
  with base as (
    select grl.position, grl.product_name, grl.doc_qty, grl.qty_received,
           coalesce(btrim(grl.discrepancy_reason), '') as motivo,
           coalesce(ku.dimension, 'unit') as dim,
           -- Precio por unidad DE PAPEL: lo que el proveedor factura. Si no hay
           -- importe en el documento se cae a lo tecleado; si tampoco, null y
           -- entonces el euro no puede decidir (decide solo el %).
           case
             when grl.doc_amount is not null and grl.doc_qty is not null and grl.doc_qty <> 0
               then grl.doc_amount / grl.doc_qty
             else grl.unit_cost
           end as precio_ud
    from goods_receipt_line grl
    left join recipe_item ri on ri.id = grl.recipe_item_id
    left join kitchen_unit ku on ku.id = ri.base_unit_id
    where grl.goods_receipt_id = p_receipt_id
      and not grl.not_goods
  ),
  calc as (
    select b.*,
           case when b.doc_qty is null or b.qty_received is null
                then null else b.qty_received - b.doc_qty end as dif
    from base b
  )
  select c.position, c.product_name, c.doc_qty, c.qty_received, c.dif, c.dim,
         case when c.dif is null or c.precio_ud is null
              then null else round(abs(c.dif) * c.precio_ud, 2) end,
         nullif(c.motivo, ''),
         case
           when c.dif is null then 'no_comparable'
           when c.dif = 0 and c.motivo <> '' then 'solo_nota'
           when c.dif = 0 then 'sin_diferencia'
           -- Unidades: cualquier diferencia cuenta.
           when c.dim = 'unit' then 'diferencia'
           -- Continuas: salta el que se cumpla ANTES, el % o los euros.
           when c.doc_qty is null or c.doc_qty = 0 then 'diferencia'
           when abs(c.dif) / abs(c.doc_qty) * 100 >= v_pct then 'diferencia'
           when c.precio_ud is not null and abs(c.dif) * c.precio_ud > v_eur then 'diferencia'
           else 'ruido'
         end
  from calc c
  where not (c.dif = 0 and c.motivo = '')   -- las líneas correctas y mudas no aportan
  order by
    case when c.dif is null then 2
         when c.dif = 0 then 3
         else 1 end,
    abs(coalesce(c.dif, 0)) desc,
    c.position;
end;
$function$;

-- El núcleo NO tiene guarda: los permisos son su única protección.
revoke execute on function public._ctb_receipt_differences_core(uuid) from public;
revoke execute on function public._ctb_receipt_differences_core(uuid) from anon;
revoke execute on function public._ctb_receipt_differences_core(uuid) from authenticated;
grant  execute on function public._ctb_receipt_differences_core(uuid) to service_role;

create or replace function public.ctb_receipt_differences(p_receipt_id uuid)
returns table (
  linea integer, product_name text, doc_qty numeric, qty_received numeric,
  diferencia numeric, dimension text, valor_eur numeric, motivo text, clase text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $wrap$
declare
  v_acct uuid;
begin
  select account_id into v_acct from goods_receipt where id = p_receipt_id;
  if v_acct is null then
    raise exception 'ctb_receipt_differences: albarán % no existe', p_receipt_id;
  end if;
  if not belongs_to_account(v_acct) then
    raise exception 'ctb_receipt_differences: sin acceso al albarán %', p_receipt_id;
  end if;
  return query select * from public._ctb_receipt_differences_core(p_receipt_id);
end;
$wrap$;

revoke execute on function public.ctb_receipt_differences(uuid) from public;
revoke execute on function public.ctb_receipt_differences(uuid) from anon;
grant  execute on function public.ctb_receipt_differences(uuid) to authenticated, service_role;

do $paso3$
declare
  v_src text;
  v_viejo constant text := $viejo$    select exists (
      select 1 from goods_receipt_line
      where goods_receipt_id = p_receipt_id
        and discrepancy_reason is not null
        and btrim(discrepancy_reason) <> ''
    ) into v_has_diff;$viejo$;
  v_nuevo constant text := $nuevo$    -- (01/09) La diferencia sale de los NUMEROS, no de que alguien se
    -- acordara de escribir un motivo. El criterio viejo se perdia el 89 % de
    -- las diferencias reales (55 de 62 en Foodint) y marcaba como "con
    -- diferencias" 11 lineas que solo tenian una nota. Un solo calculo, el de
    -- ctb_receipt_differences, para el flag y para el texto.
    select exists (
      select 1 from public._ctb_receipt_differences_core(p_receipt_id) d
      where d.clase = 'diferencia'
    ) into v_has_diff;$nuevo$;
begin
  v_src := pg_get_functiondef('public.confirm_goods_receipt(uuid)'::regprocedure);

  if position(v_viejo in v_src) = 0 then
    raise exception 'no se encuentra el bloque de has_differences: confirm_goods_receipt ha cambiado y esta migracion hay que revisarla a mano';
  end if;
  if (length(v_src) - length(replace(v_src, v_viejo, ''))) / length(v_viejo) <> 1 then
    raise exception 'el bloque de has_differences aparece mas de una vez';
  end if;

  execute replace(v_src, v_viejo, v_nuevo);

  -- Se relee de la BBDD: no se da por bueno lo que acabamos de mandar.
  v_src := pg_get_functiondef('public.confirm_goods_receipt(uuid)'::regprocedure);
  if position('_ctb_receipt_differences_core(p_receipt_id)' in v_src) = 0 then
    raise exception 'la sustitucion no quedo aplicada';
  end if;
  if position(v_viejo in v_src) > 0 then
    raise exception 'el bloque viejo sigue vivo';
  end if;
  raise notice 'PASO 3 OK: has_differences sale de los numeros';
end;
$paso3$;

revoke execute on function public.confirm_goods_receipt(uuid) from public;
revoke execute on function public.confirm_goods_receipt(uuid) from anon;
grant  execute on function public.confirm_goods_receipt(uuid) to authenticated, service_role;

do $verif$
declare
  v_dif int; v_ruido int; v_nc int; v_nota int;
begin
  select count(*) filter (where clase='diferencia'),
         count(*) filter (where clase='ruido'),
         count(*) filter (where clase='no_comparable'),
         count(*) filter (where clase='solo_nota')
    into v_dif, v_ruido, v_nc, v_nota
    from public._ctb_receipt_differences_core('d51b3ee9-e43f-4730-bf4b-6dcb3e0e1a5c');

  -- ALB-00136: las dos cajas de sobres son diferencia; cebolla (3,2->3) y
  -- tomate (6,8->7) son decimas de kilo y tienen que quedar en ruido.
  if v_dif <> 2 then
    raise exception 'ALB-00136 deberia dar 2 diferencias (las dos cajas de sobres) y da %', v_dif;
  end if;
  if v_ruido <> 2 then
    raise exception 'ALB-00136 deberia dar 2 de ruido (cebolla y tomate) y da %', v_ruido;
  end if;

  if has_function_privilege('anon', 'public.ctb_receipt_differences(uuid)', 'execute') then
    raise exception 'anon puede ejecutar el envoltorio';
  end if;
  -- El nucleo no tiene guarda: si authenticated lo alcanza, cualquiera lee las
  -- diferencias de cualquier albaran de cualquier cuenta.
  if has_function_privilege('anon', 'public._ctb_receipt_differences_core(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._ctb_receipt_differences_core(uuid)', 'execute') then
    raise exception 'el nucleo sin guarda nacio alcanzable por anon o authenticated';
  end if;
  if not has_function_privilege('authenticated', 'public.ctb_receipt_differences(uuid)', 'execute') then
    raise exception 'authenticated no puede ejecutarla: la pantalla se queda sin componer el texto';
  end if;

  raise notice 'VERIFICACION OK: ALB-00136 -> % diferencias, % ruido, % no comparables, % solo nota',
    v_dif, v_ruido, v_nc, v_nota;
end;
$verif$;