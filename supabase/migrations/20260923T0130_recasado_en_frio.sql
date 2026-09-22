-- ============================================================================
-- Recasado en frio: casar hacia atras SIN mover stock
-- ----------------------------------------------------------------------------
-- 22/09/2026. Cuenta Foodint 51ad1792-6629-4ef7-833a-b57b09a86710.
-- Decision de Julio, 22/09 23:3x: «recasar en frio, sin consumir».
-- PROPUESTA. NO APLICADA.
--
-- ── POR QUE HACE FALTA ESTO Y NO VALE `recast_lastapp_sales` ──────────────
-- El encargo pide recasar EL CASADO, no el stock. Medido:
--
--   CREATE TRIGGER trg_sale_line_consumption
--     AFTER INSERT OR UPDATE OF menu_item_id ON public.sale_line
--     FOR EACH ROW EXECUTE FUNCTION tg_sale_line_consumption()
--
-- Tocar `menu_item_id` ES mover stock. Y las 553 lineas rescatables de 30 dias
-- (7.112,64 EUR) estan TODAS por debajo del ultimo conteo aprobado
-- (21/09 23:45), cero por encima: no existe la version inocua.
-- `recast_lastapp_sales` llama a `reprocess_sale`, que consume. Por eso esto
-- es una pieza aparte y no un parametro de aquella.
--
-- ── LO QUE ESTO NO ES ─────────────────────────────────────────────────────
-- No toca `_sale_line_raw_consumption`, ni `generate_sale_consumption`, ni
-- `tg_sale_line_consumption`, ni ningun adaptador. No crea articulos de carta.
-- No arregla nombres a mano. Solo escribe `menu_item_id` / `map_source` /
-- `unmapped_reason` en lineas que hoy estan SIN CASAR, y deja constancia.
--
-- ── LA DEUDA QUE CREA, Y VA ESCRITA PORQUE ES EL PRECIO ───────────────────
-- Una linea recasada en frio tiene `menu_item_id` y NO tiene movimiento de
-- stock. `sale_line` y `stock_movement` dejan de contar la misma historia para
-- esas filas, y eso no se recupera. Por eso cada linea recasada deja fila en
-- `sale_line_recast_frio`: el vigia del 100 % tiene que poder distinguir
-- «no consumio porque se recaso en frio» de «no consumio porque esta rota».
-- Sin esa tabla, este arreglo le mete ruido al cierre por euros.
--
-- ── EL DESARME, Y POR QUE ASI ─────────────────────────────────────────────
-- Se desarma UN SOLO disparador, no la sesion entera:
--   * `session_replication_role='replica'` apagaria TAMBIEN las claves ajenas
--     y `trg_sales_hourly_agg_sync`, que SI tiene que correr: el agregado por
--     horas cuenta unidades por `demand_kind` via `menu_item`, y una linea
--     recien casada cambia esa celda. Descartado.
--   * `ALTER TABLE ... DISABLE TRIGGER` deja vivas las ajenas y el agregado.
--     A cambio vale para TODAS las sesiones mientras dure, asi que la pasada
--     va fuera de servicio y con hueco medido. Y toma SHARE ROW EXCLUSIVE
--     sobre `sale_line`: un pedido que entrase ESPERA, no falla, pero espera.
--
-- ── POR QUE `map_source` NO LLEVA UN VALOR NUEVO ──────────────────────────
-- La primera version escribia `map_source='recast_frio'`. No se puede, y el
-- motivo importa: existe
--   CHECK (map_source = ANY (ARRAY['unmapped','manual','ai','fuzzy','pos']))
-- Ampliar ese CHECK toma ACCESS EXCLUSIVE sobre `sale_line`, que es el camino
-- del pedido: eso espera a la banda, y ademas dejaria un valor que ninguna
-- pantalla ni vigia de hoy sabe leer. Asi que se escribe el valor VERDADERO de
-- como caso —`pos` si fue por id, `fuzzy` si fue por nombre— y el «esto se
-- caso en frio» vive donde tiene que vivir: en `sale_line_recast_frio`, que
-- es una tabla nueva y no cierra nada.
--
-- **El desarme no vive en esta funcion**: vive en el script de la pasada, a la
-- vista, con su re-armado y su comprobacion antes del commit. Un
-- `DISABLE TRIGGER` que se commitea desarmado deja Folvy sin descontar PARA
-- SIEMPRE y en silencio — el fallo mas caro que puede tener este fichero.
-- La funcion se NIEGA a correr si el disparador esta armado, para que no se
-- pueda llamar por error contra produccion viva.
-- ============================================================================

begin;

-- ── 1. La tabla de constancia ─────────────────────────────────────────────
create table if not exists public.sale_line_recast_frio (
  id               uuid primary key default gen_random_uuid(),
  -- Sin clave ajena a `accounts`, como el resto: `sale_line.account_id` tampoco
  -- la lleva (medido: cero FK de account_id en sale_line). Y la tabla se llama
  -- `accounts`, en plural — escribi `account` de memoria y habria reventado
  -- la migracion entera. Regla 40.
  account_id       uuid not null,
  sale_line_id     uuid not null references public.sale_line(id) on delete cascade,
  sale_id          uuid not null references public.sale(id) on delete cascade,
  sold_at          timestamptz not null,
  menu_item_id     uuid not null references public.menu_item(id),
  via              text not null check (via in ('id','nombre')),
  nombre_en_venta  text,
  external_id      text,
  line_total       numeric,
  motivo_anterior  text,
  corte_vigente    timestamptz,
  bajo_corte       boolean not null,
  recasado_en      timestamptz not null default now(),
  recasado_por     text
);

comment on table public.sale_line_recast_frio is
  'Lineas casadas hacia atras SIN generar consumo (22/09/2026, decision de Julio). '
  'Una fila aqui significa: esta linea tiene menu_item_id y NO tiene movimiento de '
  'stock, a proposito. El vigia del 100 % la lee para no contarla como rota.';

create unique index if not exists sale_line_recast_frio_linea_uq
  on public.sale_line_recast_frio (sale_line_id);
create index if not exists sale_line_recast_frio_cuenta_idx
  on public.sale_line_recast_frio (account_id, sold_at);

alter table public.sale_line_recast_frio enable row level security;

drop policy if exists sale_line_recast_frio_read  on public.sale_line_recast_frio;
drop policy if exists sale_line_recast_frio_write on public.sale_line_recast_frio;

create policy sale_line_recast_frio_read on public.sale_line_recast_frio
  for select using (account_id = any (public.current_user_account_ids()));
create policy sale_line_recast_frio_write on public.sale_line_recast_frio
  for all using (public.current_user_is_admin_of(account_id))
      with check (public.current_user_is_admin_of(account_id));

-- ── 2. La funcion ─────────────────────────────────────────────────────────
-- Regla 2: si algun dia se le anade un parametro, es DROP + CREATE.
drop function if exists public.recasar_lastapp_en_frio(uuid, boolean, integer);

create function public.recasar_lastapp_en_frio(
  p_account_id  uuid,
  p_dry_run     boolean default true,
  p_dias        integer default 30
)
returns table (
  lineas_miradas    integer,
  casadas_por_id    integer,
  casadas_por_nom   integer,
  ambiguas          integer,
  sin_casar         integer,
  euros_recuperados numeric,
  bajo_corte        integer,
  corte_vigente     timestamptz,
  aplicado          boolean
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_arm   "char";
  v_corte timestamptz;
  v_r     record;
  v_mi    uuid;
  v_n     integer;
  v_via   text;
  v_look  integer := 0; v_id integer := 0; v_nom integer := 0;
  v_amb   integer := 0; v_no  integer := 0; v_bajo integer := 0;
  v_eur   numeric := 0;
begin
  -- Guarda de tenencia, como `recast_lastapp_sales`, MAS el dueno de la base.
  -- El anadido no es comodidad: `recast_lastapp_sales` solo se puede llamar
  -- desde la aplicacion, porque sin JWT `current_user_is_admin()` es false
  -- (medido: como `postgres`, false / false / {}). Esta pasada se ejecuta
  -- desde un script revisado, no desde una pantalla, asi que tiene que poder
  -- correr por conexion directa.
  -- `session_user` y no `current_user`: la funcion es SECURITY DEFINER, asi
  -- que para un usuario de la app `current_user` YA es postgres y esto seria
  -- una puerta abierta a cualquiera. `session_user` solo vale 'postgres' en
  -- una conexion directa, que es el mismo privilegio que borrar la tabla.
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account_id)
          or session_user = 'postgres') then
    raise exception 'recasar_lastapp_en_frio: sin acceso a la cuenta %', p_account_id;
  end if;

  -- ENCLAVAMIENTO. Si el disparador de consumo esta armado, esto NO corre:
  -- escribir `menu_item_id` con el armado es exactamente lo que Julio dijo
  -- que no. Quien quiera correrlo tiene que desarmarlo a la vista, en el
  -- script de la pasada, y volver a armarlo antes del commit.
  select t.tgenabled into v_arm
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'sale_line'
     and t.tgname = 'trg_sale_line_consumption';

  if v_arm is null then
    raise exception 'recasar_lastapp_en_frio: no encuentro trg_sale_line_consumption. '
                    'Si lo han renombrado, este enclavamiento ya no protege nada: para.';
  end if;

  if v_arm <> 'D' and not p_dry_run then
    raise exception 'recasar_lastapp_en_frio: trg_sale_line_consumption esta ARMADO (%). '
                    'Escribir menu_item_id ahora generaria consumo, que es justo lo que '
                    'esta pasada NO debe hacer. Desarmalo en el script de la pasada.', v_arm;
  end if;

  select max(ic.closed_at) into v_corte
    from public.inventory_count ic
   where ic.account_id = p_account_id
     and ic.status in ('aprobado','en_revision');

  for v_r in
    select sl.id, sl.external_product_id, sl.line_total, sl.unmapped_reason,
           coalesce(sl.product_name, sl.raw_text) as nombre,
           s.id as sale_id, s.sold_at, s.brand_id
      from public.sale_line sl
      join public.sale s on s.id = sl.sale_id
     where sl.account_id = p_account_id
       and s.account_id  = p_account_id          -- regla 9, las dos puntas
       and s.source = 'lastapp'
       and sl.map_source = 'unmapped'
       and sl.menu_item_id is null
       and coalesce(sl.unmapped_reason,'') not in ('ignored','delisted')
       and coalesce(s.status,'') <> 'cancelled'
       and coalesce(s.order_status,'') not in ('cancelled','rejected')
       and coalesce(s.is_active, true)
       and s.sold_at >= now() - make_interval(days => p_dias)
     order by s.sold_at
  loop
    v_look := v_look + 1;
    v_mi := null; v_via := null;

    -- Puerta principal: el id del canal.
    if v_r.external_product_id is not null then
      select count(*) into v_n
        from public.menu_item mi
       where mi.account_id = p_account_id and mi.external_source = 'lastapp'
         and mi.archived_at is null and mi.external_id = v_r.external_product_id;

      if v_n = 1 then
        select mi.id into v_mi from public.menu_item mi
         where mi.account_id = p_account_id and mi.external_source = 'lastapp'
           and mi.archived_at is null and mi.external_id = v_r.external_product_id;
        v_via := 'id';
      elsif v_n > 1 and v_r.brand_id is not null then
        select count(*) into v_n
          from public.menu_item mi
         where mi.account_id = p_account_id and mi.external_source = 'lastapp'
           and mi.archived_at is null and mi.external_id = v_r.external_product_id
           and mi.brand_id = v_r.brand_id;
        if v_n = 1 then
          select mi.id into v_mi from public.menu_item mi
           where mi.account_id = p_account_id and mi.external_source = 'lastapp'
             and mi.archived_at is null and mi.external_id = v_r.external_product_id
             and mi.brand_id = v_r.brand_id;
          v_via := 'id';
        end if;
      end if;
    end if;

    -- Red: el nombre EXACTO, dentro de la marca de la venta.
    -- Exacto a proposito: hay 43 grupos de carta con el mismo nombre suave y
    -- los dos activos, y 3 de ellos apuntan a FICHAS DISTINTAS. Aflojar el
    -- normalizador aqui, hoy, seria elegir ficha a cara o cruz. Primero se
    -- limpian los duplicados (punto 4), despues se afloja (punto 5).
    if v_mi is null and v_r.brand_id is not null and v_r.nombre is not null then
      select count(*) into v_n
        from public.menu_item mi
       where mi.account_id = p_account_id and mi.archived_at is null
         and mi.brand_id = v_r.brand_id
         and lower(public.unaccent(mi.name)) = lower(public.unaccent(v_r.nombre));
      if v_n = 1 then
        select mi.id into v_mi from public.menu_item mi
         where mi.account_id = p_account_id and mi.archived_at is null
           and mi.brand_id = v_r.brand_id
           and lower(public.unaccent(mi.name)) = lower(public.unaccent(v_r.nombre));
        v_via := 'nombre';
      elsif v_n > 1 then
        -- Dos candidatos y ningun criterio: NO se elige. Una linea sin casar
        -- se ve; una linea casada contra la ficha equivocada, no.
        v_amb := v_amb + 1;
        continue;
      end if;
    end if;

    if v_mi is null then
      v_no := v_no + 1;
      continue;
    end if;

    if v_via = 'id' then v_id := v_id + 1; else v_nom := v_nom + 1; end if;
    v_eur := v_eur + coalesce(v_r.line_total, 0);
    if v_corte is not null and v_r.sold_at <= v_corte then v_bajo := v_bajo + 1; end if;

    if not p_dry_run then
      update public.sale_line
         set menu_item_id    = v_mi,
             map_source      = case when v_via = 'id' then 'pos' else 'fuzzy' end,
             map_needs_review= false,
             unmapped_reason = null
       where id = v_r.id;

      insert into public.sale_line_recast_frio (
        account_id, sale_line_id, sale_id, sold_at, menu_item_id, via,
        nombre_en_venta, external_id, line_total, motivo_anterior,
        corte_vigente, bajo_corte, recasado_por)
      values (
        p_account_id, v_r.id, v_r.sale_id, v_r.sold_at, v_mi, v_via,
        v_r.nombre, v_r.external_product_id, v_r.line_total, v_r.unmapped_reason,
        v_corte, (v_corte is not null and v_r.sold_at <= v_corte),
        coalesce(current_setting('request.jwt.claim.email', true), current_user))
      on conflict (sale_line_id) do nothing;
    end if;
  end loop;

  lineas_miradas    := v_look;
  casadas_por_id    := v_id;
  casadas_por_nom   := v_nom;
  ambiguas          := v_amb;
  sin_casar         := v_no;
  euros_recuperados := round(v_eur, 2);
  bajo_corte        := v_bajo;
  corte_vigente     := v_corte;
  aplicado          := not p_dry_run;
  return next;
end;
$function$;

revoke all on function public.recasar_lastapp_en_frio(uuid, boolean, integer) from public, anon;
grant execute on function public.recasar_lastapp_en_frio(uuid, boolean, integer) to authenticated, service_role;

commit;
