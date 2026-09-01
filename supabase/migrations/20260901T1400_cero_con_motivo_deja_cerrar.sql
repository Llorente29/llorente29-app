-- 20260901T1400_cero_con_motivo_deja_cerrar.sql
--
-- EL SISTEMA BLOQUEA EL CASO PARA EL QUE SE CONSTRUYÓ.
--
-- `confirm_goods_receipt` mete en el mismo saco dos cosas distintas:
--   · una línea SIN DECIDIR (nadie ha dicho qué es), y
--   · una línea DECIDIDA cuya decisión es «no ha llegado, cantidad 0».
-- Las dos caen en la misma condición y las dos impiden cerrar el albarán.
--
-- Y como el aviso a CTB se escribe en `ctb_notification_queue` DENTRO de esa
-- misma función, con `has_differences` sacado de `discrepancy_reason`, la línea
-- con más motivo de reclamación es justo la que impide mandar la reclamación.
--
-- Caso real: ALB-00136 (CLOUDTOWN, Foodint Alcalá, 01/09), línea 13,
-- "SOBRE AMERICANO BIG MIKE'S CAJA 250 UD": 46,60 € que el albarán cobra y que
-- no llegaron, con el motivo ya escrito ("cambio oficina: lo dice el albarán").
--
-- ── UNA CORRECCIÓN SOBRE EL ENCARGO, CON LA FILA DELANTE ────────────────────
-- El encargo pedía exonerar `qty_in_base = 0` con motivo. Medido sobre la línea
-- real, ESO NO HABRÍA DESBLOQUEADO NADA: la línea de Julio tiene
-- `qty_in_base = NULL`, no 0. Y es coherente, no una rareza — `qty_in_base` sale
-- de `qty_received × formato`, y con `qty_received = 0` ese cálculo no llega a
-- hacerse nunca (ver _post_goods_receipt_lines: `and v_line.qty_received > 0`).
-- Así que la exención cubre las DOS formas en que aparece «cantidad cero»:
-- NULL y <= 0. Es la misma exención del encargo, escrita contra el dato real.
--
-- Lo que NO cambia, y es la mitad del arreglo:
--   · Sin artículo (`recipe_item_id is null`) SIGUE bloqueando siempre.
--   · Cero SIN motivo escrito SIGUE bloqueando. Cero con motivo es una
--     decisión; cero a secas es un olvido, y el guard existe para eso.
--
-- Medido antes de aplicar, en toda la BBDD y por cuenta (regla 9):
--   Foodint        1 línea se exonera · 0 ceros sin motivo · 65 sin artículo siguen
--   Folvy Interno  0 se exoneran      · 1 cero sin motivo sigue · 1 sin artículo sigue
-- Es decir: desbloquea exactamente la línea de ALB-00136 y ni una más.
--
-- ── EL MISMO CRITERIO EN needs_review ──────────────────────────────────────
-- El `update` repite la condición palabra por palabra. Sin tocarlo, el albarán
-- cerraría pero quedaría marcado «pendiente de revisar» para siempre: sería
-- cambiar un bloqueo por una mancha.
--
-- ── FORMA ──────────────────────────────────────────────────────────────────
-- CREATE OR REPLACE, NUNCA DROP: replace conserva el OID y con él los permisos.
-- Un DROP+CREATE aquí no "perdería" los grants — los REPONDRÍA a lo ancho, por
-- el default_acl de public, que fue justo el susto de esta mañana. Y el revoke
-- de anon va por nombre, explícito, para que se lea en el fichero.
-- `authenticated` CONSERVA el execute: esta función la llama la pantalla de
-- oficina con la sesión del usuario.

begin;

create or replace function public.confirm_goods_receipt(p_receipt_id uuid)
returns table(posted_lines integer, skipped_lines integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_receipt   goods_receipt%rowtype;
  v_user      uuid;
  v_user_name text;
  v_posted    integer := 0;
  v_skipped   integer := 0;
  v_notify    text;
  v_has_diff  boolean;
  v_undecided integer;
begin
  select * into v_receipt from goods_receipt where id = p_receipt_id;
  if not found then
    raise exception 'confirm_goods_receipt: albarán % no existe', p_receipt_id;
  end if;
  if not belongs_to_account(v_receipt.account_id) then
    raise exception 'confirm_goods_receipt: sin acceso al albarán %', p_receipt_id;
  end if;
  if v_receipt.status not in ('borrador', 'recibido') then
    raise exception 'confirm_goods_receipt: el albarán % no está en borrador ni recibido (está %)',
      p_receipt_id, v_receipt.status;
  end if;

  if v_receipt.status = 'recibido' then
    -- (01/09) Cantidad cero CON motivo escrito es una decisión, no un olvido:
    -- deja de contar como "sin decidir". Sin artículo, y cero sin motivo,
    -- siguen bloqueando igual que antes.
    select count(*) into v_undecided
      from goods_receipt_line
     where goods_receipt_id = p_receipt_id
       and not not_goods
       and (
         recipe_item_id is null
         or (
           (qty_in_base is null or qty_in_base <= 0)
           and coalesce(btrim(discrepancy_reason), '') = ''
         )
       );
    if v_undecided > 0 then
      raise exception 'confirm_goods_receipt: quedan % línea(s) sin decidir en % — cada una tiene '
        'que entrar al almacén o marcarse como que no es mercancía', v_undecided, v_receipt.code;
    end if;

    -- ENCARGO CODE (20/08) §2.3 — sin proveedor ni nº de albarán no se cierra.
    -- Solo en el cierre de OFICINA ('recibido' → 'confirmado'), que es la
    -- pantalla que tiene los campos; un borrador manual sigue como estaba
    -- para no levantar un muro sin puerta donde no se puede arreglar.
    if v_receipt.supplier_id is null then
      raise exception 'confirm_goods_receipt: el albarán % no tiene proveedor — ponlo antes de cerrar',
        coalesce(v_receipt.code, p_receipt_id::text);
    end if;
    if v_receipt.supplier_doc_number is null or btrim(v_receipt.supplier_doc_number) = '' then
      raise exception 'confirm_goods_receipt: el albarán % no tiene nº de albarán — ponlo antes de cerrar',
        coalesce(v_receipt.code, p_receipt_id::text);
    end if;
  end if;

  v_user := auth.uid();
  select display_name into v_user_name from user_profiles where id = v_user;

  if v_receipt.status = 'borrador' then
    select p.posted_lines, p.skipped_lines into v_posted, v_skipped
      from public._post_goods_receipt_lines(p_receipt_id, false) p;
  else
    -- ENCARGO CODE (20/08) §3(C) — 'recibido': entra lo que nunca entró. En un
    -- albarán normal no hay nada que postear (todas sus líneas posteables ya
    -- tienen movimiento); en uno retenido por la IA, entra todo aquí.
    select p.posted_lines, p.skipped_lines into v_posted, v_skipped
      from public._post_goods_receipt_lines(p_receipt_id, true) p;
  end if;

  update goods_receipt
    set status = 'confirmado', received_at = coalesce(received_at, now()),
        -- (01/09) MISMO criterio que el guard, palabra por palabra. Si aquí se
        -- quedara la condición vieja, el albarán cerraría pero nacería marcado
        -- "pendiente de revisar" para siempre: un bloqueo cambiado por una mancha.
        needs_review = exists (
          select 1 from goods_receipt_line
           where goods_receipt_id = p_receipt_id
             and not not_goods
             and (
               recipe_item_id is null
               or (
                 (qty_in_base is null or qty_in_base <= 0)
                 and coalesce(btrim(discrepancy_reason), '') = ''
               )
             )
        ),
        updated_at = now()
    where id = p_receipt_id;

  if v_receipt.purchase_order_id is null then
    v_receipt.purchase_order_id := public.auto_link_goods_receipt_to_order(p_receipt_id);
  end if;

  if v_receipt.purchase_order_id is not null then
    -- ENCARGO CODE (21/08) — casar las líneas ANTES de recalcular: si no,
    -- recompute cuenta 0 recibido y el pedido se queda en 'enviado' para
    -- siempre por mucha mercancía que entre.
    perform public._match_order_lines_for_order(v_receipt.purchase_order_id);
    perform recompute_purchase_order_status(v_receipt.purchase_order_id);
  end if;

  v_notify := null;
  if v_receipt.supplier_id is not null then
    select notify_group into v_notify from supplier where id = v_receipt.supplier_id;
  end if;
  if v_notify = 'ctb' then
    select exists (
      select 1 from goods_receipt_line
      where goods_receipt_id = p_receipt_id
        and discrepancy_reason is not null
        and btrim(discrepancy_reason) <> ''
    ) into v_has_diff;

    insert into ctb_notification_queue (
      account_id, goods_receipt_id, location_id, supplier_id,
      notify_group, has_differences, status
    )
    values (
      v_receipt.account_id, p_receipt_id, v_receipt.location_id, v_receipt.supplier_id,
      v_notify, coalesce(v_has_diff, false), 'pendiente'
    )
    on conflict (goods_receipt_id) do update
      set has_differences = excluded.has_differences,
          location_id     = excluded.location_id,
          supplier_id     = excluded.supplier_id,
          updated_at      = now();
  end if;

  posted_lines := v_posted; skipped_lines := v_skipped;
  return next;
end;
$function$;

-- Por nombre y explícito. `authenticated` la conserva: la llama la pantalla de
-- oficina con la sesión del usuario.
revoke execute on function public.confirm_goods_receipt(uuid) from public;
revoke execute on function public.confirm_goods_receipt(uuid) from anon;
grant  execute on function public.confirm_goods_receipt(uuid) to authenticated, service_role;

-- ── VERIFICACIÓN ───────────────────────────────────────────────────────────
do $verif$
declare
  v_bloquean int;
  v_src      text;
begin
  v_src := pg_get_functiondef('public.confirm_goods_receipt(uuid)'::regprocedure);

  -- La exención tiene que estar en LOS DOS sitios (guard y needs_review). Si
  -- solo estuviera en uno, el albarán cerraría manchado o no cerraría.
  if (length(v_src) - length(replace(v_src, 'btrim(discrepancy_reason)', ''))) / length('btrim(discrepancy_reason)') <> 2 then
    raise exception 'la exencion no aparece exactamente 2 veces: guard y needs_review tienen que ir a la par';
  end if;

  if has_function_privilege('anon', 'public.confirm_goods_receipt(uuid)', 'execute') then
    raise exception 'anon puede ejecutar confirm_goods_receipt';
  end if;
  if not has_function_privilege('authenticated', 'public.confirm_goods_receipt(uuid)', 'execute') then
    raise exception 'authenticated NO puede ejecutarla: la pantalla de oficina se queda sin cerrar albaranes';
  end if;

  -- ALB-00136 tiene que quedarse sin lineas bloqueantes. Si sigue bloqueado,
  -- este arreglo no sirve para lo que se pidio y no debe darse por bueno.
  select count(*) into v_bloquean
    from goods_receipt_line
   where goods_receipt_id = 'd51b3ee9-e43f-4730-bf4b-6dcb3e0e1a5c'
     and not not_goods
     and (recipe_item_id is null
          or ((qty_in_base is null or qty_in_base <= 0)
              and coalesce(btrim(discrepancy_reason), '') = ''));
  if v_bloquean > 0 then
    raise exception 'ALB-00136 sigue con % linea(s) bloqueantes tras el arreglo', v_bloquean;
  end if;

  raise notice 'VERIFICACION OK: exencion en los dos sitios, anon cerrado, ALB-00136 sin bloqueos';
end;
$verif$;

commit;
