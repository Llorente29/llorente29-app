-- supabase/migrations/20261126T1606_k14b_fechas_al_reves.sql
--
-- K14b · Las fechas al revés de la empresa dc43e21d (autónomo de QBO), 26/11. Su extracto de CaixaBank de noviembre se leyó
-- con el mes delante: SheetJS escribe las celdas de fecha al estilo de EE. UU. («11/03/26» es el 3 de noviembre) y el
-- lector las leía día/mes. Quedaron 40 movimientos el día 11 de cada mes (del 11/01 al 11/12/2026, tres en el futuro):
-- son los de los días 1 al 12 de noviembre. Los de los días 13 en adelante (23) no entraron, sin aviso.
--
-- Esta tanda, todo o nada:
--   1. Los 40, a su fecha de verdad: 2026-MM-11 pasa a 2026-11-MM (fecha y fecha valor), y su huella y su huella suave
--      igual (empiezan por la fecha). Medido: con la fecha corregida, las 40 huellas son las mismas que da volver a
--      leer el fichero con el lector arreglado; las otras 23 entran como nuevas al subirlo otra vez, sin duplicar.
--   2. Su extracto: del 01/11 al 12/11, y marcado «sin comprobar» (no es una lectura completa: le faltan 23 filas), y su
--      huella de fichero apartada para que el mismo fichero se pueda volver a subir.
--   3. Sus cobros del K14 (conta_banco_cobro, 6 filas): la misma fecha y su mes. El motor los vuelve a casar al subir el
--      extracto otra vez.
--   4. Lo de antes del día de inicio, recalculado con las fechas buenas (_bank_antes_del_inicio_recalcular, de la 1240).
--
-- Ninguno estaba casado (los 40, «por aclarar»): no hay asientos que tocar. Cambia filas: AUTORIZO. Vuelta atrás:
-- supabase/vuelta-atras/20261126T1606_k14b_fechas_al_reves.down.sql (lo devuelve como estaba). Nada en el camino del pedido.

do $$
declare
  emp constant uuid := 'dc43e21d-2992-4eb3-a378-c867f86d6644';
  ext constant uuid := '301d51b6-f1bb-45f9-a39f-cb7ddc1709f5';
  v_n int; v_c int;
begin
  if not exists (select 1 from public.company where id = emp) then
    raise notice 'K14b: esta base no tiene la empresa dc43e21d: no hay fechas que corregir.';
    return;
  end if;
  -- 0 · Como se midió el 26/11 (si no, para y no hace nada).
  select count(*) into v_n from public.bank_movement where company_id = emp;
  if v_n <> 40
     or exists (select 1 from public.bank_movement where company_id = emp
                 and (statement_id <> ext or extract(day from op_date) <> 11 or extract(year from op_date) <> 2026 or value_date <> op_date
                      or substr(fingerprint, 1, 11) <> to_char(op_date, 'YYYY-MM-DD') || '|' or substr(soft_fingerprint, 1, 11) <> to_char(op_date, 'YYYY-MM-DD') || '|'
                      or status in ('casado', 'ignorado')))
     or exists (select 1 from public.bank_match b join public.bank_movement m on m.id = b.movement_id where m.company_id = emp and b.status = 'vivo')
     or not exists (select 1 from public.bank_statement where id = ext and company_id = emp and period_from = date '2026-01-11' and period_to = date '2026-12-11'
                    and unchecked_reason is null and file_sha256 not like '%:k14b') then
    raise exception 'K14b · 0: los movimientos de la empresa dc43e21d no están como se midieron el 26/11 (40, todos el día 11, sin casar).';
  end if;

  -- 1 · La fecha de verdad, y su huella.
  update public.bank_movement m
     set op_date = make_date(2026, 11, extract(month from m.op_date)::int),
         value_date = make_date(2026, 11, extract(month from m.value_date)::int),
         fingerprint = '2026-11-' || substr(m.fingerprint, 6, 2) || substr(m.fingerprint, 11),
         soft_fingerprint = '2026-11-' || substr(m.soft_fingerprint, 6, 2) || substr(m.soft_fingerprint, 11),
         updated_at = now()
   where m.company_id = emp;
  get diagnostics v_n = row_count;

  -- 2 · Su extracto.
  update public.bank_statement
     set period_from = date '2026-11-01', period_to = (select max(op_date) from public.bank_movement where statement_id = ext),
         unchecked_reason = 'K14b: leído con las fechas al revés y sin las filas del 13 en adelante; no es una lectura completa. Las fechas, corregidas el 26/11.',
         file_sha256 = file_sha256 || ':k14b'
   where id = ext;

  -- 3 · Sus cobros del K14.
  update public.conta_banco_cobro c
     set fecha = m.op_date, mes = date_trunc('month', m.op_date)::date
    from public.bank_movement m
   where m.id = c.movement_id and c.company_id = emp;
  get diagnostics v_c = row_count;

  -- 4 · Lo de antes del día de inicio.
  perform public._bank_antes_del_inicio_recalcular(emp);

  if exists (select 1 from public.bank_movement where company_id = emp and (op_date < date '2026-11-01' or op_date > date '2026-11-12')) then
    raise exception 'K14b · 1: queda algún movimiento de la empresa dc43e21d fuera del 01/11–12/11.';
  end if;
  raise notice 'K14b · empresa dc43e21d: % movimientos a su fecha de noviembre; % cobros del K14 con su fecha; su extracto, «sin comprobar».', v_n, v_c;
end $$;
