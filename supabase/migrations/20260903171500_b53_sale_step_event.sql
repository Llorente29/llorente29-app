-- B53 · 03/09/2026 — EL REGISTRO DE PASOS DEL PEDIDO. LA TABLA NACE CERRADA.
-- ===========================================================================
-- POR QUE EXISTE: Cloudtown reclamo que solo el 57,1 % de los pedidos de una de
--   sus marcas llego marcado como "listo" a Glovo. En Folvy los 74 pedidos de esa
--   semana tienen su sello de listo con hora exacta, pero NO pudimos rebatirlo:
--   el acuse de la plataforma existia y lo estabamos tirando.
--     1. trg_sale_push_status hace `perform net.http_post(...)` — `perform`
--        descarta el bigint que devuelve, que es el id de la peticion.
--     2. pg_net guarda la respuesta en net._http_response indexada por ese id.
--     3. Esa tabla se purga: la fila mas antigua tenia 6 HORAS. Por eso W35 es
--        irrecuperable y lo seguira siendo.
--   Con la ventana viva se midio el 03/09 (10:39-16:38 UTC): 21 empujes enviados
--   y aceptados por Last, 0 fallos, 23 no intentados a proposito. La cadena
--   Folvy -> Last FUNCIONA. Lo que falta es conservar la prueba mas de 6 horas.
--
-- REGISTRO, NO CONTADOR: un contador mutable no se puede auditar; un registro de
--   eventos si. Misma leccion que B43.
--
-- ⚠️ POR QUE LA TABLA SE CIERRA EN ESTA MISMA MIGRACION (deuda B51):
--   En este proyecto toda tabla nueva de `public` NACE con ALL para anon y
--   authenticated. Comprobado hoy contra pg_default_acl, y es POR PARTIDA DOBLE:
--   hay ALTER DEFAULT PRIVILEGES desde `supabase_admin` Y desde `postgres`, los
--   dos con arwdDxtm sobre tablas y rwU sobre secuencias. Ya mordio el 03/09 con
--   dos tablas de respaldo, que nacieron legibles y escribibles desde internet.
--   Por eso crear + encender RLS + revocar + VERIFICAR va todo junto: si el
--   has_table_privilege del final no da falso, la migracion falla y no queda a
--   medias.
--
-- DESVIACION DECLARADA respecto al encargo (§1 vs §2), para que se pueda vetar:
--   El §1 documenta `paso` con vocabulario castellano ('listo', 'en_reparto'...)
--   pero el insert del §2 mete `new.order_status`, que es ingles
--   ('awaiting_collection', 'in_delivery'...). Las dos cosas no pueden ser
--   ciertas a la vez. Y mapear a secas colapsaria 'rejected', 'cancelled' y
--   'delivery_failed' en un unico 'cancelado' — justo la distincion que B47
--   demostro que importa (el delivery_failed conserva consumo A PROPOSITO:
--   la comida se hizo).
--   Solucion: `paso` en castellano, que es el contrato del §1 y lo que necesita
--   la respuesta legible del §4, MAS `paso_origen` con el order_status crudo.
--   Una columna de mas y no se pierde nada. Si se prefiere el ingles a secas,
--   se quita `paso_origen` y se cambia el mapeo del trigger.

begin;

create table if not exists public.sale_step_event (
  id            bigserial primary key,
  account_id    uuid not null,
  location_id   uuid,
  sale_id       uuid not null,
  paso          text not null,          -- 'recibido','aceptado','en_preparacion','listo','en_reparto','entregado','cancelado'
  paso_origen   text,                   -- el order_status crudo que lo genero (ver desviacion arriba)
  ocurrido_en   timestamptz not null default now(),
  origen        text not null,          -- 'trigger','edge','app','plataforma'
  -- empuje a la plataforma, cuando lo hay
  push_request_id  bigint,              -- el id que devuelve net.http_post
  push_estado      text,                -- 'pendiente','aceptado','rechazado','sin_respuesta','no_procede'
  push_http_status int,
  push_detalle     text,
  push_resuelto_en timestamptz
);

comment on table public.sale_step_event is
  'B53: registro append-only de los pasos de un pedido y del acuse de la plataforma. Escriben el trigger y el cron (security definer); nadie mas. Ver cabecera de la migracion 20260903171500.';
comment on column public.sale_step_event.paso_origen is
  'order_status crudo (ingles) que genero el paso. Distingue rejected / cancelled / delivery_failed, que `paso` colapsa en cancelado.';
comment on column public.sale_step_event.push_estado is
  'no_procede NO es un fallo: es el completed de un pedido de reparto por plataforma, que a proposito no se empuja porque Glovo cierra en su sistema.';

create index if not exists ix_sse_sale     on public.sale_step_event (sale_id, ocurrido_en);
create index if not exists ix_sse_cuenta   on public.sale_step_event (account_id, ocurrido_en desc);
-- para que el cosechador encuentre rapido lo que le queda por cerrar
create index if not exists ix_sse_pendiente on public.sale_step_event (push_request_id)
  where push_estado = 'pendiente';

alter table public.sale_step_event enable row level security;

revoke all on public.sale_step_event from anon, authenticated;
revoke all on sequence public.sale_step_event_id_seq from anon, authenticated;

-- Lectura: solo los de tu cuenta. SIN politica de escritura a proposito —
-- escriben el trigger y el cron, que van con security definer.
drop policy if exists sse_read on public.sale_step_event;
create policy sse_read on public.sale_step_event
  for select to authenticated
  using (public.belongs_to_account(account_id));

-- ── VERIFICACION EN EL MISMO MOVIMIENTO ────────────────────────────────────
-- Si algo de lo de arriba no agarro, esto revienta y la migracion no queda a medias.
do $verif$
declare
  v_rol  text;
  v_priv text;
begin
  foreach v_rol in array array['anon','authenticated'] loop
    foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      if has_table_privilege(v_rol, 'public.sale_step_event', v_priv) then
        raise exception 'B53: % conserva % sobre sale_step_event. La tabla NO nace cerrada.', v_rol, v_priv;
      end if;
    end loop;
  end loop;

  if not has_table_privilege('service_role', 'public.sale_step_event', 'SELECT') then
    raise exception 'B53: service_role se ha quedado sin SELECT sobre sale_step_event.';
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'sale_step_event' and c.relrowsecurity
  ) then
    raise exception 'B53: RLS no esta encendida en sale_step_event.';
  end if;

  if has_sequence_privilege('anon', 'public.sale_step_event_id_seq', 'USAGE')
     or has_sequence_privilege('authenticated', 'public.sale_step_event_id_seq', 'USAGE') then
    raise exception 'B53: la secuencia sigue accesible desde anon/authenticated.';
  end if;
end
$verif$;

commit;
