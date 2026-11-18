-- supabase/migrations/20261118T1952_e04_las_que_esperan_se_pasan.sql
--
-- E04 · La factura de otra sociedad del grupo se pasa sola. 3 de 3: las que HOY
-- esperan la pregunta del E03 «va a nombre de otra sociedad» se pasan al aplicar.
-- Escribe sobre lo que existe (update): lleva «autorizo». Va detrás de la 1950.
--
-- Cuáles: las mismas que pasaría _conta_pasar_sola (1950) — va a nombre de OTRA
-- sociedad de la misma cuenta (_conta_de_quien del E03, caso otra_sociedad, con la
-- pregunta en pie: sin asiento validado y sin respuesta de una persona) y sin
-- trabas (_conta_recibida_trabas: pagos, banco, impuesto, liquidación, recepción).
-- Qué: lo de «Pasarla» (_conta_recibida_mover), escrito aquí a la vista: su
-- asiento propuesto fuera, la factura, su llegada, su actividad y su apunte de
-- «apunta sola» a la otra sociedad, y el apunte en supplier_invoice_change como
-- Sumied, «sola», con su porqué. Las de asiento validado no se mueven: sigue la pregunta.
-- Cómo estaba cada una, en conta_e04_respaldo, para la vuelta atrás.
-- Se puede pasar dos veces (lo ya pasado no es candidata: ya va a nombre de su sociedad).
-- sin hueco: retira el asiento PROPUESTO (o borrador) de lo que mueve, como «Pasarla»: se vuelve
--   a proponer en su sociedad. Ninguno validado.
-- Lo cuenta, por cuenta (regla 9): scripts/conta/produccion/cuentas/e04-otra-sociedad-sola.sql
-- Vuelta atrás: supabase/vuelta-atras/20261118T1952_e04_las_que_esperan_se_pasan.down.sql

create table if not exists public.conta_e04_respaldo (
  supplier_invoice_id uuid primary key references public.supplier_invoice(id) on delete cascade,
  account_id uuid not null,
  desde uuid not null,
  hacia uuid not null,
  location_id uuid,
  vat_non_deductible boolean,
  vat_non_deductible_reason text,
  journal_entry_id uuid,
  hecho_en timestamptz not null default now()
);
comment on table public.conta_e04_respaldo is 'E04 (1952): de qué sociedad venía cada recibida que se pasó sola al aplicar, y cómo estaba, para la vuelta atrás.';
alter table public.conta_e04_respaldo enable row level security;
revoke all on public.conta_e04_respaldo from public, anon, authenticated;
grant all on public.conta_e04_respaldo to service_role;

-- Las candidatas (regla 9: la otra sociedad, de la misma cuenta).
drop table if exists pg_temp.e04_sola;
create temp table e04_sola as
  select si.id, si.account_id, si.company_id as desde, o.id as hacia, c.legal_name as desde_nombre, o.legal_name as hacia_nombre,
         coalesce(nullif(btrim(o.tax_id), ''), x.q->>'nif') as hacia_nif
    from public.supplier_invoice si
    cross join lateral (select public._conta_de_quien(si.id) as q) x
    join public.company o on o.id = (x.q->>'sociedad_id')::uuid and o.account_id = si.account_id
    join public.company c on c.id = si.company_id and c.account_id = si.account_id
   where si.recipient_answer is null
     and x.q->>'caso' = 'otra_sociedad' and coalesce((x.q->>'pregunta')::boolean, false)
     and public._conta_recibida_trabas(si.id) is null
     and not exists (select 1 from public.conta_e04_respaldo r where r.supplier_invoice_id = si.id);

insert into public.conta_e04_respaldo (supplier_invoice_id, account_id, desde, hacia, location_id, vat_non_deductible, vat_non_deductible_reason, journal_entry_id)
select si.id, si.account_id, s.desde, s.hacia, si.location_id, si.vat_non_deductible, si.vat_non_deductible_reason, si.journal_entry_id
  from public.supplier_invoice si join e04_sola s on s.id = si.id and s.account_id = si.account_id
on conflict (supplier_invoice_id) do nothing;

-- Su asiento propuesto (o borrador) fuera: se vuelve a proponer en su sociedad.
delete from public.journal_entry e
 using e04_sola s
 where e.account_id = s.account_id and e.source_type = 'supplier_invoice' and e.source_id = s.id and e.status in ('propuesto', 'borrador');

update public.supplier_invoice si
   set company_id = s.hacia,
       location_id = case when exists (select 1 from public.location_company lc where lc.location_id = si.location_id and lc.company_id = s.hacia) then si.location_id end,
       vat_non_deductible = case when si.vat_non_deductible_reason = 'no_a_nombre' then false else si.vat_non_deductible end,
       vat_non_deductible_reason = case when si.vat_non_deductible_reason = 'no_a_nombre' then null else si.vat_non_deductible_reason end,
       journal_entry_id = case when si.journal_entry_id is not null and not exists (select 1 from public.journal_entry e where e.id = si.journal_entry_id) then null else si.journal_entry_id end,
       updated_at = now()
  from e04_sola s
 where si.id = s.id and si.account_id = s.account_id;

update public.document_inbox d set company_id = s.hacia, updated_at = now()
  from e04_sola s where d.supplier_invoice_id = s.id and d.account_id = s.account_id;
update public.document_activity a set company_id = s.hacia
  from e04_sola s where a.supplier_invoice_id = s.id and a.account_id = s.account_id;
update public.supplier_invoice_auto u set company_id = s.hacia
  from e04_sola s where u.invoice_id = s.id and u.account_id = s.account_id;

insert into public.supplier_invoice_change (account_id, supplier_invoice_id, by_name, what, cambios)
select s.account_id, s.id, 'Sumied', 'guardar', jsonb_build_array(jsonb_build_object('campo', 'sociedad',
       'antes', jsonb_build_object('id', s.desde, 'nombre', s.desde_nombre), 'ahora', jsonb_build_object('id', s.hacia, 'nombre', s.hacia_nombre),
       'sola', true, 'porque', format('va a nombre de %s (%s); al aplicar el E04', s.hacia_nombre, s.hacia_nif)))
  from e04_sola s;

do $$
declare v_n int; v_cuentas text;
begin
  select count(*), string_agg(distinct account_id::text, ', ') into v_n, v_cuentas from e04_sola;
  raise notice 'E04 · % recibidas pasadas solas a su sociedad al aplicar (cuentas: %).', v_n, coalesce(v_cuentas, 'ninguna');
end $$;
drop table if exists pg_temp.e04_sola;
