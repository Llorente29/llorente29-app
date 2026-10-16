-- supabase/migrations/20261111T0750_c06b_diez_autorizo_empresa_datos.sql
--
-- C06b · Respuesta 8, tarea 1, PASO 3 de 3 · DATOS: la autorización de la
-- EMPRESA de Foodint para escribir en la base real C0008 de Diez, desde el
-- 01/10/2026 y SOLO VENTAS (incluye_recibidas = false). Autorizado por Julio.
--
-- Lo que hace y lo que no:
--   · Abre C0008 a los asientos de ventas de la empresa con fecha 01/10/2026 o
--     posterior (y a sus contraasientos, con la fecha de lo que anulan).
--   · No envía nada: se sigue enviando con el botón «Validar y enviar a Diez».
--     Nada sale solo.
--   · No abre las recibidas (serie 2): lo decide Julio aparte, con
--     incluye_recibidas.
--   · No toca la autorización del asiento 1801 (alcance 'asiento').
--
-- Lo leen conta-diez-enviar (desplegada desde main en a08c8a9, versión 8, que
-- ya sabe de «desde» e «incluye_recibidas») y nada más.
--
-- Anclado por cuenta y empresa (regla 9). Para, sin escribir nada, si la
-- empresa no es de la cuenta o no tiene conexión con C0008. Si ya hay una
-- autorización de empresa en C0008: igual, no hace nada; distinta, para (no se
-- cambia en silencio). En una base sin la cuenta de Foodint (staging), no hace
-- nada y lo dice.
-- Vuelta atrás: supabase/vuelta-atras/20261111T0750_c06b_diez_autorizo_empresa_datos.down.sql
do $$
declare
  v_cuenta  constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_empresa constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_desde   constant date := '2026-10-01';
  v_ya record;
begin
  if not exists (select 1 from public.accounts where id = v_cuenta) then
    raise notice 'C06b 0750: esta base no tiene la cuenta de Foodint (staging): no hay nada que autorizar.';
    return;
  end if;
  if not exists (select 1 from public.company where id = v_empresa and account_id = v_cuenta) then
    raise exception 'C06b 0750: la empresa % no es de la cuenta de Foodint. No se autoriza nada.', v_empresa;
  end if;
  if not exists (select 1 from public.account_connector where account_id = v_cuenta and company_id = v_empresa and upper(config->>'nombre_bd') = 'C0008') then
    raise exception 'C06b 0750: la empresa no tiene conexión con Diez C0008. No se autoriza nada.';
  end if;

  select desde, incluye_recibidas into v_ya from public.conta_diez_autorizo
   where account_id = v_cuenta and company_id = v_empresa and alcance = 'empresa' and upper(nombre_bd) = 'C0008';
  if found then
    if v_ya.desde is not distinct from v_desde and v_ya.incluye_recibidas = false then
      raise notice 'C06b 0750: la empresa ya estaba autorizada en C0008 desde el % y sin recibidas. No se toca nada.', v_desde;
      return;
    end if;
    raise exception 'C06b 0750: ya hay otra autorización de empresa en C0008 (desde %, recibidas %). No se cambia aquí: mírala antes.', v_ya.desde, v_ya.incluye_recibidas;
  end if;

  insert into public.conta_diez_autorizo (account_id, company_id, alcance, entry_id, nombre_bd, autorizado_por, motivo, desde, incluye_recibidas)
  values (v_cuenta, v_empresa, 'empresa', null, 'C0008', 'Julio',
          'Respuesta 8, tarea 1 (15/10): toda la empresa en C0008 desde el 01/10/2026, solo ventas (las recibidas, no). Se envía con el botón «Validar y enviar a Diez»; nada sale solo.',
          v_desde, false);

  if not exists (select 1 from public.conta_diez_autorizo
                  where account_id = v_cuenta and company_id = v_empresa and alcance = 'empresa' and nombre_bd = 'C0008'
                    and desde = v_desde and incluye_recibidas = false and entry_id is null) then
    raise exception 'C06b 0750: la autorización no ha quedado como se quería.';
  end if;
  raise notice 'C06b 0750: autorizada la empresa en C0008 desde el %, solo ventas.', v_desde;
end $$;
