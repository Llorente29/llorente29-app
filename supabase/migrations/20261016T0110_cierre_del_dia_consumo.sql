-- ============================================================================
-- El día se cierra a las 6:00 — 2 · EL STOCK NO VUELVE (regla 5 de Julio)
-- ----------------------------------------------------------------------------
-- cambia: public.tg_sale_consumption_on_complete · prueba: supabase/staging/sql/20261016_cierre_del_dia_prueba.sql
-- cambia: public.generate_sale_consumption · prueba: supabase/staging/sql/20261016_cierre_del_dia_prueba.sql
--
-- El cierre del día (0100) pone status = 'cancelled' con unconfirmed_at. Hoy
-- eso es una ANULACIÓN para el consumo, por dos sitios:
--   a) tg_sale_consumption_on_complete, rama 0: si status pasa a 'cancelled'
--      llama a generate_sale_consumption para «devolver el stock»;
--   b) generate_sale_consumption: v_void := status = 'cancelled' OR … → borra
--      los movimientos de consumo de la venta (salvo los protegidos por un
--      recuento aprobado, que anota en sale_consumption_skip).
-- Medido en T1: de los 20 pedidos que cerraría el atraso, 12 tienen consumo
-- (134 movimientos) — 7 «delivery_failed» y 5 «awaiting_collection»: se
-- cocinaron. Julio: el stock no vuelve.
--
-- Los dos cambios, y nada más:
--   a) La rama 0 del disparador no actúa si unconfirmed_at está puesto: al
--      cerrar como no confirmado NO se llama al motor. Ni se borra ni se
--      regenera nada: el almacén no se mueve.
--   b) En el motor, 'cancelled' con unconfirmed_at NO es anulación. Así, si
--      mañana alguien reprocesa esa venta (los botones de reprocesar, o una
--      regeneración), su consumo se recalcula como el de una venta normal en
--      vez de borrarse. Las otras dos causas de anulación (order_status
--      'cancelled' o 'rejected', is_active falso) siguen igual: los 8 que la
--      plataforma ya canceló o rechazó no tienen consumo y siguen sin tenerlo.
--
-- generate_sale_consumption tiene 19.263 caracteres: no se copia a mano. Se
-- reemplaza UNA línea sobre el texto VIVO, como la guarda FV001
-- (20260916180501): PARA si su md5 no es el medido (fa63d5b9…, igual en
-- producción y staging el 09/10) o si la línea no aparece exactamente una
-- vez; guarda el texto anterior en _backup_cierre_del_dia_consumo; y al
-- final comprueba que lo vivo es lo esperado. El «execute» dinámico lo lista
-- el analizador como aviso: está aquí declarado y es eso.
--
-- En el camino del pedido: pide «autorizo».
-- Vuelta atrás: supabase/vuelta-atras/20261016T0110_cierre_del_dia_consumo.down.sql
-- ============================================================================

create table if not exists public._backup_cierre_del_dia_consumo (
  funcion   text primary key,
  prosrc    text not null,
  md5       text not null,
  saved_at  timestamptz not null default now()
);
alter table public._backup_cierre_del_dia_consumo enable row level security;
revoke all on table public._backup_cierre_del_dia_consumo from anon, authenticated;

-- ── a) El disparador ───────────────────────────────────────────────────────
do $$
declare v_md5 text;
begin
  select md5(prosrc) into v_md5 from pg_proc where oid = 'public.tg_sale_consumption_on_complete()'::regprocedure;
  if v_md5 is distinct from 'eada5e6667c33321dfc384c46f9c2300' then
    raise exception 'tg_sale_consumption_on_complete no es la medida el 09/10 (md5 %): alguien la ha cambiado; no se toca.', v_md5;
  end if;
  insert into public._backup_cierre_del_dia_consumo (funcion, prosrc, md5)
  select 'tg_sale_consumption_on_complete()', prosrc, md5(prosrc) from pg_proc where oid = 'public.tg_sale_consumption_on_complete()'::regprocedure
  on conflict (funcion) do nothing;
end $$;

create or replace function public.tg_sale_consumption_on_complete()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  -- 0) ANULACION (nuevo): la venta deja de ser valida -> devolver el stock.
  --    Salvo el cierre del dia (16/10): un pedido cerrado como no confirmado
  --    (unconfirmed_at) no se anula: lo cocinado, cocinado esta.
  if tg_op = 'UPDATE'
     and new.unconfirmed_at is null
     and ( coalesce(new.status,'') = 'cancelled'
           or coalesce(new.order_status,'') in ('cancelled','rejected')
           or not coalesce(new.is_active, true) )
     and ( coalesce(old.status,'')       is distinct from coalesce(new.status,'')
           or coalesce(old.order_status,'') is distinct from coalesce(new.order_status,'')
           or coalesce(old.is_active,true) is distinct from coalesce(new.is_active,true) ) then
    perform public.generate_sale_consumption(new.id);
    return new;
  end if;

  -- 1) AL ENTRAR / ACEPTARSE la venta: descuenta ya.
  if new.order_status in ('accepted','received','new','completed')
     and (tg_op = 'INSERT' or old.order_status is distinct from new.order_status)
     and coalesce(new.status,'') <> 'cancelled'
     and coalesce(new.is_active, true) then
    perform public.generate_sale_consumption(new.id);
  end if;

  return new;
end;
$function$;

-- ── b) El motor: una línea ─────────────────────────────────────────────────
do $$
declare
  v_ancla constant text := $a$v_void := COALESCE(v_sale.status, '') = 'cancelled'$a$;
  v_nueva constant text := $a$-- Cierre del dia (16/10): un pedido cerrado como no confirmado
  -- (unconfirmed_at) NO es una anulacion: su consumo se queda y, si se
  -- regenera, se recalcula como el de cualquier venta.
  v_void := (COALESCE(v_sale.status, '') = 'cancelled' AND v_sale.unconfirmed_at IS NULL)$a$;
  v_src   text;
  v_md5   text;
  v_n     int;
begin
  select prosrc, md5(prosrc) into v_src, v_md5 from pg_proc where oid = 'public.generate_sale_consumption(uuid)'::regprocedure;
  if v_md5 is distinct from 'fa63d5b96be66fbb0238a28599a21656' then
    raise exception 'generate_sale_consumption no es la medida el 09/10 (md5 %): alguien la ha cambiado; no se toca.', v_md5;
  end if;
  v_n := (length(v_src) - length(replace(v_src, v_ancla, ''))) / length(v_ancla);
  if v_n <> 1 then
    raise exception 'generate_sale_consumption: la línea de v_void aparece % veces (tiene que ser 1).', v_n;
  end if;
  insert into public._backup_cierre_del_dia_consumo (funcion, prosrc, md5)
  values ('generate_sale_consumption(uuid)', v_src, v_md5)
  on conflict (funcion) do nothing;

  execute format('create or replace function public.generate_sale_consumption(p_sale_id uuid) returns integer language plpgsql security definer set search_path = public as %L',
                 replace(v_src, v_ancla, v_nueva));

  -- Lo vivo es exactamente lo de antes con esa línea cambiada.
  if (select prosrc from pg_proc where oid = 'public.generate_sale_consumption(uuid)'::regprocedure) <> replace(v_src, v_ancla, v_nueva) then
    raise exception 'generate_sale_consumption: lo que ha quedado no es lo esperado.';
  end if;
end $$;
