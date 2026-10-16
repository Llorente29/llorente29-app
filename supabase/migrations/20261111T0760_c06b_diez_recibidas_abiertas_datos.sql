-- supabase/migrations/20261111T0760_c06b_diez_recibidas_abiertas_datos.sql
--
-- C06b · DATOS: Julio abre también las FACTURAS RECIBIDAS (serie 2) en la base
-- real C0008 de Diez (15/10). Cambia la autorización de EMPRESA de Foodint en
-- C0008: incluye_recibidas pasa a true. Su `desde` (2026-10-01) se queda.
--
-- Por qué ahora, y no antes: las recibidas se cerraron (0740) porque duplicaban
-- en Diez. Ya no: conta-diez-enviar, desplegada desde main en 05d4edf (versión
-- 9, byte a byte la de main, comprobado el 15/10), lleva
--   · #190: la recibida se busca en Diez antes de escribir (desde el mes de la
--     factura hasta hoy, número normalizado, proveedor por cuenta o NIF): se
--     enlaza, no se duplica;
--   · #192: anular una recibida ya enviada manda su «-ANUL», con los mismos frenos.
--
-- No envía nada: se sigue enviando con el botón. No toca la autorización del
-- asiento 1801 ni ninguna otra fila. Al motivo se le añade quién y cuándo, para
-- que se lea en la fila (la tabla no tiene «actualizado en»).
--
-- Anclado por cuenta y empresa (regla 9). Para, sin cambiar nada, si la
-- autorización de empresa en C0008 no existe o no es la de desde 2026-10-01.
-- Si ya incluye las recibidas, no hace nada. En una base sin la cuenta de
-- Foodint (staging), no hace nada y lo dice.
-- Vuelta atrás: supabase/vuelta-atras/20261111T0760_c06b_diez_recibidas_abiertas_datos.down.sql
do $$
declare
  v_cuenta  constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_empresa constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_desde   constant date := '2026-10-01';
  v_nota    constant text := ' · 15/10: Julio abre también las recibidas (incluye_recibidas).';
  v_ya record;
  n int;
begin
  if not exists (select 1 from public.accounts where id = v_cuenta) then
    raise notice 'C06b 0760: esta base no tiene la cuenta de Foodint (staging): no hay nada que abrir.';
    return;
  end if;

  select desde, incluye_recibidas into v_ya from public.conta_diez_autorizo
   where account_id = v_cuenta and company_id = v_empresa and alcance = 'empresa' and upper(nombre_bd) = 'C0008';
  if not found then
    raise exception 'C06b 0760: no hay autorización de empresa en C0008 (la 0750). No se abre nada.';
  end if;
  if v_ya.desde is distinct from v_desde then
    raise exception 'C06b 0760: la autorización de empresa en C0008 no es la de desde el % (es desde %). No se cambia aquí: mírala antes.', v_desde, v_ya.desde;
  end if;
  if v_ya.incluye_recibidas then
    raise notice 'C06b 0760: la empresa ya tenía abiertas las recibidas en C0008. No se toca nada.';
    return;
  end if;

  update public.conta_diez_autorizo
     set incluye_recibidas = true, motivo = motivo || v_nota
   where account_id = v_cuenta and company_id = v_empresa and alcance = 'empresa' and upper(nombre_bd) = 'C0008'
     and desde = v_desde and incluye_recibidas = false;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'C06b 0760: esperaba cambiar UNA autorización y han sido %.', n;
  end if;
  raise notice 'C06b 0760: abiertas las recibidas en C0008 para la empresa (desde el %).', v_desde;
end $$;
