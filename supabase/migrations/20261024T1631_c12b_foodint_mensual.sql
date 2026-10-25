-- C12b · Foodint pasa al traspaso mensual a Diez (Julio, 24/10).
-- Destruye o mueve (update sobre datos existentes): solo con autorizo.
--
-- QUÉ: la empresa de Foodint con «Enviar a Diez» encendido pasa a modo
-- 'mensual'. Desde ese momento no sale nada suelto a Diez (ni la cola del
-- servidor, ni al validar, ni con «Reintentar»): todo va en el traspaso del mes
-- (Contabilidad › Cierre). Y la cola se vacía SIN ENVIAR: a los envíos
-- pendientes de Foodint se les quita el reintento (next_try_at = null); siguen
-- con su motivo y el asiento sigue validado. Pendiente no es «en Diez», así que
-- van en el primer traspaso (el de octubre).
--
-- LA COPIA DE ANTES (C12c, 25/10): antes de cambiar nada se guarda en
-- conta_c12b_antes lo que este fichero va a tocar, tal cual:
--   · de la empresa: modo, cambiado_por_nombre y cambiado_en;
--   · de cada envío pendiente de Foodint (todos, también los que no tienen
--     reintento): next_try_at y updated_at.
-- La vuelta atrás restaura exactamente desde ahí, sin now() ni reglas. Si la
-- tabla ya existe, este fichero PARA: quedó de una vez anterior sin deshacer.
--
-- No borra nada ni toca lo que ya está en Diez. Nada del camino del pedido.
-- Va DESPUÉS de la tanda del C12 (20261024T1250 y 1251), que añade la columna
-- modo y el traspaso, y con conta-diez-traspaso desplegada.
-- Prueba: supabase/staging/sql/20261024_c12b_foodint_mensual_prueba.sql
-- Cuenta: scripts/conta/produccion/cuentas/c12b-foodint-mensual.sql
-- Vuelta atrás: supabase/vuelta-atras/20261024T1631_c12b_foodint_mensual.down.sql

create table public.conta_c12b_antes (
  tabla               text not null check (tabla in ('conta_diez_envio_empresa', 'external_send')),
  fila                uuid not null,
  modo                text,
  cambiado_por_nombre text,
  cambiado_en         timestamptz,
  next_try_at         timestamptz,
  updated_at          timestamptz,
  guardada_en         timestamptz not null default now(),
  primary key (tabla, fila)
);
alter table public.conta_c12b_antes enable row level security;
revoke all on public.conta_c12b_antes from anon, authenticated;
comment on table public.conta_c12b_antes is
  'C12b. La copia de antes del paso de Foodint a mensual (20261024T1631): lo que tocó, tal cual, para que la vuelta atrás lo deje exacto. La borra la vuelta atrás. Sin políticas: no la lee ninguna pantalla.';

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_n int;
begin
  if to_regprocedure('public.conta_traspaso_confirmar(uuid, date)') is null
     or position('modo' in (select prosrc from pg_proc where oid = 'public.conta_diez_por_enviar(integer)'::regprocedure)) = 0 then
    raise exception 'C12b · primero la tanda del C12 (1250 y 1251), después este cambio.';
  end if;

  -- La copia de antes, antes de cambiar nada.
  insert into public.conta_c12b_antes (tabla, fila, modo, cambiado_por_nombre, cambiado_en)
  select 'conta_diez_envio_empresa', company_id, modo, cambiado_por_nombre, cambiado_en
    from public.conta_diez_envio_empresa
   where account_id = v_acc and enviar and coalesce(modo, 'al_validar') <> 'mensual';
  insert into public.conta_c12b_antes (tabla, fila, next_try_at, updated_at)
  select 'external_send', id, next_try_at, updated_at
    from public.external_send
   where account_id = v_acc and status = 'pendiente';

  update public.conta_diez_envio_empresa
     set modo = 'mensual', cambiado_por_nombre = 'Julio (C12b, traspaso mensual)', cambiado_en = now()
   where account_id = v_acc and enviar and coalesce(modo, 'al_validar') <> 'mensual';
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'C12b · se esperaba 1 empresa de Foodint con Diez encendido y al validar, y hay %.', v_n;
  end if;
  update public.external_send set next_try_at = null, updated_at = now()
   where account_id = v_acc and status = 'pendiente' and next_try_at is not null;
end $$;
