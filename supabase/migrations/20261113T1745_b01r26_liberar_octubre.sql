-- supabase/migrations/20261113T1745_b01r26_liberar_octubre.sql
--
-- B01r·26 · Libera el freno «nunca dos veces» de octubre, DESPUÉS de que Julio
-- borre en Diez (C0008) todo lo que había desde el 01/10 (decisión de Julio,
-- 13/11: octubre entra limpio desde Sumied).
--
-- Los 215 envíos de Foodint a Diez (213 «enviado» y 2 «enlazado», todos de
-- asientos del 01/10 al 24/10) pasan a «rechazado», con el motivo y su
-- referencia de antes en last_error. Así:
--   · las filas se quedan, como historia;
--   · external_send_entry_uq y external_send_ext_uq dejan sitio a los envíos
--     nuevos (los dos excluyen lo rechazado);
--   · el traspaso de octubre (conta_traspaso_lista) vuelve a contar esos
--     asientos como «no están en Diez», y sus anulaciones, como las de algo que
--     nunca llegó (no viaja ninguno de los dos).
-- Foodint está en modo «mensual»: nada sale solo; sale cuando Julio confirma el
-- traspaso del mes en Contabilidad › Cierre.
--
-- LA GUARDA DE DIEZ: este fichero no puede leer Diez. La tanda lleva
-- guarda-diez.json y el real («Aplicar SQL en PRODUCCIÓN») lee antes la C0008,
-- solo con GET: si hay algún asiento con fecha desde el 01/10, PARA sin aplicar
-- nada (scripts/conta/diez/guarda-desde.ts). Aquí dentro, la guarda de Sumied:
-- tienen que ser exactamente esos 215, o no se cambia nada.
--
-- SIN VUELTA ATRÁS, a propósito: devolverlos a «enviado» diría que están en
-- Diez cuando Julio los ha borrado. Si hiciera falta, se vuelve a medir Diez.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_env int; v_enl int; v_fuera int; v_n int;
  v_hoy constant text := to_char(now() at time zone 'Europe/Madrid', 'DD/MM/YYYY');
begin
  if not exists (select 1 from public.company where id = v_e and account_id = v_acc) then
    raise notice 'B01r26: sin la empresa de Foodint (staging), no hay nada que liberar.';
    return;
  end if;

  select count(*) filter (where s.status = 'enviado'), count(*) filter (where s.status = 'enlazado'),
         count(*) filter (where e.entry_date < date '2026-10-01' or s.ext_year is distinct from '2026')
    into v_env, v_enl, v_fuera
    from public.external_send s join public.journal_entry e on e.id = s.entry_id and e.account_id = s.account_id
   where s.company_id = v_e and s.account_id = v_acc and s.status in ('enviado', 'enlazado');
  if v_env <> 213 or v_enl <> 2 or v_fuera <> 0 then
    raise exception 'B01r26: se esperaban 213 «enviado» y 2 «enlazado», todos de octubre de 2026; hay %, % y % de fuera. No se cambia nada: vuelve a medir.', v_env, v_enl, v_fuera;
  end if;

  update public.external_send s
     set status = 'rechazado',
         next_try_at = null,
         updated_at = now(),
         last_error = format('Borrado en Diez (C0008) por Julio; comprobado vacío desde el 01/10 el %s. Octubre entra limpio desde Sumied (B01r26). Antes: %s %s/%s/%s',
                             v_hoy, s.status, s.ext_year, s.ext_series, s.ext_number)
   where s.company_id = v_e and s.account_id = v_acc and s.status in ('enviado', 'enlazado');
  get diagnostics v_n = row_count;
  if v_n <> 215 then
    raise exception 'B01r26: se han cambiado % envíos y tenían que ser 215.', v_n;
  end if;
  raise notice 'B01r26: 215 envíos de octubre a «rechazado» (borrados en Diez el %).', v_hoy;
end $$;
