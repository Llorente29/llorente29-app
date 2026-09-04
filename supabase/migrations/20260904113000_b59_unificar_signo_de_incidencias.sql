-- B59 §4 · 04/09/2026 — UN COSTE SE GUARDA EN POSITIVO. LOS DOS NIVELES IGUAL.
-- ===========================================================================
-- NO HABIA DESCUADRE, HABIA UNA CONVENCION SIN DECIDIR. Medido el 04/09 por
-- settlement_ref: CERO liquidaciones difieren de verdad. 26 tienen la MISMA
-- MAGNITUD Y SIGNO OPUESTO (973,26 EUR) — por eso la «diferencia» salia siempre
-- exactamente el doble, que es la firma inconfundible de un signo cambiado.
--
-- Y no es un campo: son LOS DOS, cruzados en direcciones contrarias. Medido:
--
--   channel_settlement.incidents_cost         52 negativos ·   0 positivos
--   channel_settlement_order.incidents_cost    0 negativos · 130 positivos
--   channel_settlement.incidents_refund        0 negativos ·   4 positivos
--   channel_settlement_order.incidents_refund  8 negativos ·   0 positivos
--
-- Los dos importadores se escribieron por separado y cada uno eligio su signo.
-- Ninguno es «el correcto»: lo que faltaba era decidir.
--
-- DECISION (recomendada por Code, compartida por Julio): POSITIVO EN LOS DOS
--   NIVELES Y EN LOS DOS CAMPOS. Un importe guardado en positivo se suma sin
--   sorpresas; el signo lo pone la pantalla, que es quien sabe si eso resta.
--   Guardarlo negativo en un sitio y positivo en otro es lo que produjo el susto.
--
-- ⚠️ ESTO ESCRIBE DATOS, no esquema. Respaldo previo COMPLETO antes de tocar
--    (regla 13). El respaldo no se borra sin decidirlo: es la unica vuelta atras.
--    No toca el camino vivo de los pedidos, pero aun asi va fuera de la banda
--    12:15 -> 23:45. Consecuencia esperada, escrita ANTES: los importes cambian
--    de signo a positivo; NINGUNA magnitud cambia; ningun total en valor
--    absoluto se mueve. Se verifica abajo antes de cerrar.

begin;

-- ── RESPALDO (regla 13) ─────────────────────────────────────────────────────
create table if not exists public._backup_b59_signo_incidencias_20260904 as
select 'channel_settlement'::text as tabla, id,
       incidents_cost as incidents_cost_antes,
       incidents_refund as incidents_refund_antes,
       now() as snapshot_at
  from public.channel_settlement
 where coalesce(incidents_cost,0) <> 0 or coalesce(incidents_refund,0) <> 0
union all
select 'channel_settlement_order', id, incidents_cost, incidents_refund, now()
  from public.channel_settlement_order
 where coalesce(incidents_cost,0) <> 0 or coalesce(incidents_refund,0) <> 0;

-- El respaldo tambien nace cerrado (B51): en `public` toda tabla nueva nace con
-- ALL para anon y authenticated. El 03/09 ya nacieron dos asi.
alter table public._backup_b59_signo_incidencias_20260904 enable row level security;
revoke all on public._backup_b59_signo_incidencias_20260904 from anon, authenticated;

comment on table public._backup_b59_signo_incidencias_20260904 is
  'B59 §4: estado de incidents_cost/refund ANTES de unificar el signo a positivo (04/09/2026). Unica vuelta atras; no borrar sin decidirlo.';

-- ── UNIFICACION ─────────────────────────────────────────────────────────────
update public.channel_settlement
   set incidents_cost   = abs(incidents_cost),
       incidents_refund = abs(incidents_refund)
 where coalesce(incidents_cost,0) < 0 or coalesce(incidents_refund,0) < 0;

update public.channel_settlement_order
   set incidents_cost   = abs(incidents_cost),
       incidents_refund = abs(incidents_refund)
 where coalesce(incidents_cost,0) < 0 or coalesce(incidents_refund,0) < 0;

comment on column public.channel_settlement.incidents_cost is
  'Coste de incidencias, SIEMPRE POSITIVO (B59 §4, 04/09/2026). El signo lo pone la pantalla. Antes se guardaba negativo aqui y positivo en channel_settlement_order, y por eso los dos niveles parecian no reconciliar.';
comment on column public.channel_settlement_order.incidents_cost is
  'Coste de incidencias, SIEMPRE POSITIVO (B59 §4, 04/09/2026). Misma convencion que channel_settlement.';

-- ── VERIFICACION: ninguna MAGNITUD puede haber cambiado ─────────────────────
do $verif$
declare
  v_mal int;
begin
  select count(*) into v_mal from (
    select b.id, b.tabla, b.incidents_cost_antes, b.incidents_refund_antes,
           case b.tabla when 'channel_settlement'
                then (select cs.incidents_cost from public.channel_settlement cs where cs.id = b.id)
                else (select o.incidents_cost from public.channel_settlement_order o where o.id = b.id) end as coste_ahora,
           case b.tabla when 'channel_settlement'
                then (select cs.incidents_refund from public.channel_settlement cs where cs.id = b.id)
                else (select o.incidents_refund from public.channel_settlement_order o where o.id = b.id) end as refund_ahora
      from public._backup_b59_signo_incidencias_20260904 b
  ) t
  where round(abs(coalesce(incidents_cost_antes,0)),2)   <> round(abs(coalesce(coste_ahora,0)),2)
     or round(abs(coalesce(incidents_refund_antes,0)),2) <> round(abs(coalesce(refund_ahora,0)),2);

  if v_mal > 0 then
    raise exception 'B59 §4: % filas cambiaron de MAGNITUD, no solo de signo. Se aborta.', v_mal;
  end if;

  if exists (select 1 from public.channel_settlement where incidents_cost < 0 or incidents_refund < 0)
     or exists (select 1 from public.channel_settlement_order where incidents_cost < 0 or incidents_refund < 0) then
    raise exception 'B59 §4: quedan importes negativos despues de unificar.';
  end if;

  if has_table_privilege('anon','public._backup_b59_signo_incidencias_20260904','SELECT')
     or has_table_privilege('authenticated','public._backup_b59_signo_incidencias_20260904','SELECT') then
    raise exception 'B59 §4: el respaldo NO nace cerrado.';
  end if;
end
$verif$;

commit;
