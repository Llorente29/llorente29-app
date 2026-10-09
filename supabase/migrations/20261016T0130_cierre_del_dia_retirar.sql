-- ============================================================================
-- El día se cierra a las 6:00 — 4 · SE RETIRA LO PROPUESTO ANTES DE SU CIERRE
-- ----------------------------------------------------------------------------
-- Los asientos de ventas del día que se propusieron ANTES de que su día
-- llegara a la hora de cierre, y que siguen «propuesto», se retiran: se
-- borra el asiento (sus líneas van con él; sales_day_summary se queda, con
-- entry_id a vacío, y el proponedor lo reutiliza cuando el día se cierre).
--
-- SIN descarte, a propósito: journal_entry_descartar deja una fila en
-- journal_dismissal y ese día no se volvería a proponer nunca. Aquí no se
-- descarta nada: el día se propondrá entero, a su hora.
--
-- En producción el 09/10 es UNO: b4eb11ca-d1ea-48e1-aeda-6835a92be35e,
-- Carabanchel, día 09/10, propuesto a las 17:15 de Madrid de ese mismo día
-- (T1). La función no lo nombra: lo encuentra por la regla, y por eso PARA si
-- encuentra algo que no sea «propuesto» sin número.
-- Ni validados ni borradores: esos no se tocan nunca.
--
-- Va detrás de la 0120: desde ella, un día sin cerrar ya no se vuelve a
-- proponer, y lo retirado no reaparece.
-- Borra datos: pide «autorizo».
-- Vuelta atrás: supabase/vuelta-atras/20261016T0130_cierre_del_dia_retirar.down.sql
-- (no devuelve el asiento: se volverá a proponer, completo, cuando su día cierre).
-- ============================================================================

create table if not exists public._retirado_cierre_del_dia (
  entry_id     uuid primary key,
  company_id   uuid not null,
  location_id  uuid,
  sales_day    date not null,
  created_at   timestamptz not null,
  lineas       jsonb not null,
  retirado_at  timestamptz not null default now()
);
alter table public._retirado_cierre_del_dia enable row level security;
revoke all on table public._retirado_cierre_del_dia from anon, authenticated;

do $$
declare
  v_n   int;
  v_mal int;
  v_ids text;
begin
  create temp table _a_retirar on commit drop as
  select e.id, e.company_id, d.location_id, d.sales_day, e.created_at, e.status, e.number
    from public.journal_entry e
    join public.sales_day_summary d on d.entry_id = e.id
    left join public.company_tax_profile t on t.company_id = e.company_id
   where e.source_type = 'sales_day'
     and e.status = 'propuesto'
     -- Propuesto antes de la hora de cierre de su día (6:00 de Madrid del día siguiente).
     and e.created_at < (((d.sales_day + 1)::timestamp + coalesce(t.sales_day_close_time, time '06:00')) at time zone 'Europe/Madrid');

  select count(*), count(*) filter (where status <> 'propuesto' or number is not null), string_agg(id::text || ' (' || sales_day || ')', ', ' order by sales_day)
    into v_n, v_mal, v_ids from _a_retirar;
  if v_mal > 0 then
    raise exception 'Retirar lo propuesto antes del cierre: % no son «propuesto» sin número; no se toca nada.', v_mal;
  end if;
  raise notice 'Retirar lo propuesto antes del cierre: % asiento(s): %', v_n, coalesce(v_ids, 'ninguno');

  -- La copia de lo que se retira, con sus líneas, para que quede escrito.
  insert into public._retirado_cierre_del_dia (entry_id, company_id, location_id, sales_day, created_at, lineas)
  select r.id, r.company_id, r.location_id, r.sales_day, r.created_at,
         coalesce((select jsonb_agg(to_jsonb(l)) from public.journal_line l where l.entry_id = r.id), '[]')
    from _a_retirar r
  on conflict (entry_id) do nothing;

  delete from public.journal_entry e using _a_retirar r where e.id = r.id;

  if exists (select 1 from public.journal_entry e join _a_retirar r on r.id = e.id) then
    raise exception 'Retirar lo propuesto antes del cierre: alguno sigue ahí.';
  end if;
end $$;
