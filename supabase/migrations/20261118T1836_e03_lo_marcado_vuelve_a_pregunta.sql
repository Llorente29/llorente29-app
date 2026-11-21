-- supabase/migrations/20261118T1836_e03_lo_marcado_vuelve_a_pregunta.sql
--
-- E03 · Lo que marcó Sumied solo vuelve a ser pregunta (respuesta E02 · 1, 18/11).
-- Escribe sobre lo que existe (update): lleva «autorizo». Va DESPUÉS de la 1833,
-- que pone las columnas de la respuesta y la pregunta (_conta_de_quien).
--
--   a. Lo que ya decidió una persona en la ficha de hoy (conta_recibida_iva_no_deducible
--      deja su apunte en supplier_invoice_change, campo «iva_no_deducible») pasa a ser
--      su respuesta: la última, con quién y cuándo. Así la pregunta no le vuelve a salir.
--   b. Las marcadas «no va a nombre» (no_a_nombre) que nadie decidió (sin ese apunte
--      y sin respuesta), SIN asiento validado y que no están anuladas ni descartadas:
--      su IVA vuelve a deducirse y su motivo se vacía. Desde la 1833 salen como
--      pregunta, con su caso, y no se validan hasta que alguien conteste.
--   Las de asiento validado no se tocan (la ficha dice «Lo marcó Sumied solo; si no
--   es así, anula el asiento»). El ROI (sin_roi) y los demás motivos, tampoco.
--
-- Se puede pasar dos veces (lo ya contestado y lo ya devuelto no se vuelve a tocar):
-- la prueba de staging lo vuelve a pasar, entero, con sus filas sembradas.
-- Cómo estaba cada fila tocada queda en conta_e03_respaldo, para la vuelta atrás:
-- supabase/vuelta-atras/20261118T1836_e03_lo_marcado_vuelve_a_pregunta.down.sql
-- Lo cuenta, por cuenta y caso (regla 9): scripts/conta/produccion/cuentas/e03-de-quien-es.sql

create table if not exists public.conta_e03_respaldo (
  supplier_invoice_id uuid primary key references public.supplier_invoice(id) on delete cascade,
  account_id uuid not null,
  que text not null check (que in ('respuesta_de_la_ficha', 'vuelve_a_pregunta')),
  vat_non_deductible boolean,
  vat_non_deductible_reason text,
  recipient_answer text,
  recipient_answered_at timestamptz,
  recipient_answered_by_name text,
  hecho_en timestamptz not null default now()
);
comment on table public.conta_e03_respaldo is 'E03 (1836): cómo estaba cada recibida antes de que su marca «no va a nombre» volviera a ser pregunta, para la vuelta atrás.';
alter table public.conta_e03_respaldo enable row level security;
revoke all on public.conta_e03_respaldo from public, anon, authenticated;
grant all on public.conta_e03_respaldo to service_role;

-- a · La respuesta que ya dio una persona en la ficha de hoy.
with ultima as (
  select distinct on (h.supplier_invoice_id) h.supplier_invoice_id, h.account_id, h.by_name, h.at,
         coalesce((x->'ahora'->>'no_deducible')::boolean, false) as no_deducible
    from public.supplier_invoice_change h
    cross join lateral jsonb_array_elements(h.cambios) x
   where x->>'campo' = 'iva_no_deducible'
   order by h.supplier_invoice_id, h.at desc
), resp as (
  insert into public.conta_e03_respaldo (supplier_invoice_id, account_id, que, vat_non_deductible, vat_non_deductible_reason,
                                         recipient_answer, recipient_answered_at, recipient_answered_by_name)
  select si.id, si.account_id, 'respuesta_de_la_ficha', si.vat_non_deductible, si.vat_non_deductible_reason,
         si.recipient_answer, si.recipient_answered_at, si.recipient_answered_by_name
    from public.supplier_invoice si join ultima u on u.supplier_invoice_id = si.id and u.account_id = si.account_id
   where si.recipient_answer is null
  on conflict (supplier_invoice_id) do nothing
  returning supplier_invoice_id
)
update public.supplier_invoice si
   set recipient_answer = case when u.no_deducible then 'no_deduce' else 'deduce' end,
       recipient_answered_at = u.at, recipient_answered_by_name = u.by_name
  from ultima u
 where u.supplier_invoice_id = si.id and u.account_id = si.account_id and si.recipient_answer is null
   and si.id in (select supplier_invoice_id from resp);

-- b · Lo que marcó Sumied solo, sin asiento validado: vuelve a ser pregunta.
with sola as (
  select si.id, si.account_id
    from public.supplier_invoice si
   where si.vat_non_deductible is true and si.vat_non_deductible_reason = 'no_a_nombre' and si.recipient_answer is null
     and si.status not in ('anulada', 'descartada')
     and not exists (select 1 from public.journal_entry e where e.account_id = si.account_id and e.source_type = 'supplier_invoice'
                       and e.source_id = si.id and e.status = 'validado')
     and not exists (select 1 from public.supplier_invoice_change h where h.supplier_invoice_id = si.id
                       and h.cambios @> '[{"campo": "iva_no_deducible"}]'::jsonb)
), resp as (
  insert into public.conta_e03_respaldo (supplier_invoice_id, account_id, que, vat_non_deductible, vat_non_deductible_reason,
                                         recipient_answer, recipient_answered_at, recipient_answered_by_name)
  select si.id, si.account_id, 'vuelve_a_pregunta', si.vat_non_deductible, si.vat_non_deductible_reason,
         si.recipient_answer, si.recipient_answered_at, si.recipient_answered_by_name
    from public.supplier_invoice si join sola s on s.id = si.id
  on conflict (supplier_invoice_id) do nothing
  returning supplier_invoice_id, account_id
), hecho as (
  update public.supplier_invoice si
     set vat_non_deductible = false, vat_non_deductible_reason = null, updated_at = now()
    from resp r
   where r.supplier_invoice_id = si.id and r.account_id = si.account_id
  returning si.id, si.account_id
)
insert into public.supplier_invoice_change (account_id, supplier_invoice_id, by_name, what, cambios)
select h.account_id, h.id, 'Sumied (E03)', 'guardar', jsonb_build_array(jsonb_build_object('campo', 'de_quien_es',
       'antes', jsonb_build_object('no_deducible', true, 'motivo', 'no_a_nombre', 'quien', 'lo marcó Sumied solo'),
       'ahora', jsonb_build_object('no_deducible', false, 'motivo', null, 'quien', 'vuelve a ser pregunta: lo decide una persona')))
  from hecho h;

do $$
declare v_a int; v_b int;
begin
  select count(*) filter (where que = 'respuesta_de_la_ficha'), count(*) filter (where que = 'vuelve_a_pregunta') into v_a, v_b from public.conta_e03_respaldo;
  raise notice 'E03 · % con la respuesta que ya dio una persona en la ficha; % vuelven a ser pregunta (en total, desde la primera pasada).', v_a, v_b;
end $$;
