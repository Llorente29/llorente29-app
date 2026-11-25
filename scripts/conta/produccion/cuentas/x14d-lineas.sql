-- scripts/conta/produccion/cuentas/x14d-lineas.sql
--
-- X14 · 2 (Julio, 25/11): el 2024 de QBO para en conta_traer_seguir con journal_line_debe_o_haber, que exige
-- (debit > 0) <> (credit > 0). Antes de proponer nada se mide, en lo leído de ERP10 que espera en la cola de las cargas
-- a medias (conta_traer_trozo de las cargas «cargando»), cuántas líneas hay de cada clase. SOLO LEE, y solo columnas que
-- existen antes de la tanda. SOLO NÚMEROS (cuántas líneas y cuántos asientos): ni cuentas, ni importes, ni nombres (T11).
-- Corte fijo (W06): cargas empezadas antes del 25/11/2026 a las 11:00 de Madrid.
--
-- La clase de cada línea (debe y haber en céntimos, como los deja el lector; un nulo cuenta como 0):
--   normal                · un solo lado, positivo: entra tal cual.
--   ceros                 · 0 al debe y 0 al haber.
--   dos lados, positivos  · importe en el debe Y en el haber, los dos positivos.
--   dos lados, con negativo · importe en los dos, y alguno negativo.
--   negativo al debe      · solo el debe, y negativo.
--   negativo al haber     · solo el haber, y negativo.
-- Por cada clase, cuántas líneas y en cuántos asientos; por carga, ejercicio a ejercicio (el año de la fecha del asiento).
with c as (
  select r.id carga, r.account_id cuenta
    from public.import_run r
   where r.kind = 'carga' and r.status = 'cargando' and r.started_at < timestamptz '2026-11-25 11:00:00+01'
), l as (
  select c.cuenta, c.carga, left(q.dato->>'fecha', 4) ej, q.orden, q.hecho,
         coalesce(nullif(x->>'debe', '')::numeric, 0) d, coalesce(nullif(x->>'haber', '')::numeric, 0) h
    from c join public.conta_traer_trozo q on q.carga = c.carga and q.tipo = 'asiento'
   cross join lateral jsonb_array_elements(coalesce(q.dato->'apuntes', '[]')) x
), k as (
  select l.*, case when d = 0 and h = 0 then '2 ceros'
                   when d <> 0 and h <> 0 and d > 0 and h > 0 then '3 dos lados, positivos'
                   when d <> 0 and h <> 0 then '4 dos lados, con negativo'
                   when d < 0 then '5 negativo al debe'
                   when h < 0 then '6 negativo al haber'
                   else '1 normal' end clase
    from l
)
select clave, valor from (
  select 0 o, 'cuenta ' || cuenta || ' · carga ' || carga || ' · asientos en la cola (cuántos · ya pasados)' clave,
         count(distinct orden) || ' · ' || count(distinct orden) filter (where hecho) valor
    from l group by cuenta, carga
  union all
  select 1, 'cuenta ' || cuenta || ' · carga ' || carga || ' · ' || ej || ' · ' || substr(clase, 3) || ' (líneas · asientos)',
         count(*) || ' · ' || count(distinct orden)
    from k group by cuenta, carga, ej, clase
  union all
  select 2, 'cuenta ' || cuenta || ' · carga ' || carga || ' · ' || ej || ' · asientos con alguna línea que no es normal, y de ellos los que se quedarían con menos de 2 líneas sin las de ceros',
         count(*) || ' · ' || count(*) filter (where n_buenas_o_no_cero < 2)
    from (select cuenta, carga, ej, orden, count(*) filter (where clase <> '2 ceros') n_buenas_o_no_cero
            from k group by cuenta, carga, ej, orden having bool_or(clase <> '1 normal')) a
   group by cuenta, carga, ej
) t order by clave;
