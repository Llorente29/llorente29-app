-- ============================================================================
-- Cierre del día · 2 — DATOS: los días que faltan, y el 09/10 entero
-- ----------------------------------------------------------------------------
-- Detrás de la 0100 (que deja al cierre del día proponiendo cada hora), este
-- fichero hace la PRIMERA pasada dentro de la tanda, para que el ensayo diga
-- qué sale antes de que salga.
--
-- Medido en producción el 11/10 (solo lectura), Foodint, una empresa:
--   · conta_dias_por_asentar del 01/10 al 10/10 da 9 días×local sin asiento:
--     Alcalá 02, 07, 09, 10; Carabanchel 06, 07, 08, 09, 10.
--   · El 09/10 de Carabanchel tiene un resumen A MEDIAS (2d36c97e…): 1 ticket,
--     16,90 €, creado el 09/10 a las 15:15 UTC, a media jornada, por el botón
--     de antes del cierre del día. Su asiento lo retiró la 0130 del 09/10 y el
--     resumen se quedó, sin asiento. El día entero tiene 7 tickets, 150,50 €.
--   · Lo que la 0100 propondría para esos 9 (y para los 11 que ya tienen
--     asiento) es igual al núcleo del botón al céntimo: 20 de 20 días×local
--     (docs/conta/cierre-del-dia/CIERRE_PROPONE.md).
--
-- Lo que hace:
--   1. Copia el resumen a medias del 09/10 en _backup_cierre_proponer_resumen
--      y lo BORRA (solo si sigue sin asiento): el día se propone entero, con
--      un resumen nuevo. No se duplica: el índice único (empresa, local, día)
--      no deja dos.
--   2. Propone, en cada empresa, los días cerrados y abiertos sin asiento
--      (conta_proponer_dias), a nombre de «Folvy (cierre del día, puesta al
--      día)». Lo que no se pueda proponer queda dicho en
--      sales_day_proposal_log, con su porqué.
--   3. PARA (y no deja nada) si un día falla, si el 09/10 de Carabanchel no
--      queda con UN resumen y su asiento vivo, o si queda en Foodint algún día
--      de octubre cerrado sin asiento y sin porqué.
--
-- En otra base (staging) no encuentra el resumen del 09/10 y no borra nada;
-- propone lo que haya allí.
-- Borra una fila que existe: pide «autorizo».
-- Vuelta atrás: supabase/vuelta-atras/20261018T0110_cierre_proponer_dias_datos.down.sql
-- ============================================================================

create table if not exists public._backup_cierre_proponer_resumen (like public.sales_day_summary);
alter table public._backup_cierre_proponer_resumen enable row level security;
revoke all on table public._backup_cierre_proponer_resumen from anon, authenticated;

insert into public._backup_cierre_proponer_resumen
select s.* from public.sales_day_summary s
 where s.id = '2d36c97e-be3c-45db-af7b-a9c767b4ff0b' and s.entry_id is null
   and not exists (select 1 from public._backup_cierre_proponer_resumen b where b.id = s.id);

delete from public.sales_day_summary s
 where s.id = '2d36c97e-be3c-45db-af7b-a9c767b4ff0b' and s.entry_id is null;

do $$
declare
  c_foodint  constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  c_carab    constant uuid := '92d7656e-082e-452a-8ebc-236b2d6ebf5f';
  r          record;
  v          jsonb;
  v_n        int;
  v_quedan   text;
begin
  for r in select c.id from public.company c order by c.id loop
    v := public.conta_proponer_dias(r.id, now(), 'Folvy (cierre del día, puesta al día)');
    raise notice 'Proponer % : %', r.id, v;
    if (v->>'fallos')::int > 0 then
      raise exception 'Proponer: % día(s) fallan en la empresa %: %. No se deja nada.', v->>'fallos', r.id, v->>'errores';
    end if;
  end loop;

  if exists (select 1 from public.company where id = c_foodint) then
    -- El 09/10 de Carabanchel: un resumen, con su asiento vivo, el día entero.
    select count(*) into v_n from public.sales_day_summary s
      join public.journal_entry e on e.id = s.entry_id and e.status in ('propuesto', 'borrador', 'validado')
     where s.company_id = c_foodint and s.location_id = c_carab and s.sales_day = date '2026-10-09' and s.tickets_count > 1;
    if v_n <> 1 then
      raise exception 'El 09/10 de Carabanchel no ha quedado con un resumen entero y su asiento (hay %). No se deja nada.', v_n;
    end if;
    -- Ningún día de octubre cerrado sin asiento y sin porqué.
    select string_agg(x.dia || ' ' || x.location_id, ', ' order by x.dia) into v_quedan
      from public.conta_dias_por_asentar(c_foodint, date '2026-10-01', public.conta_ultimo_dia_cerrado(c_foodint, now())) x
     where not exists (select 1 from public.sales_day_proposal_log g where g.company_id = c_foodint and g.location_id = x.location_id
                          and g.sales_day = x.dia and g.result in ('sin_propuesta', 'descartado'));
    if v_quedan is not null then
      raise exception 'Quedan días de octubre cerrados sin asiento y sin porqué: %. No se deja nada.', v_quedan;
    end if;
  end if;
end $$;
