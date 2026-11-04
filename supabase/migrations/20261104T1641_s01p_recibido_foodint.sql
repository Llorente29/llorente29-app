-- supabase/migrations/20261104T1641_s01p_recibido_foodint.sql
--
-- S01p · DATOS de Foodint: lo recibido sin factura de octubre, rehecho con la
-- regla de la 1640. Medido el 04/11 (solo lectura): en octubre no queda ningún
-- albarán pendiente de factura, así que se van la periodificación ec0b1122
-- (Olimpo Gourmet, 149,44 €) y su pareja propuesta (31/10 y 01/11), y no se
-- propone nada nuevo. Julio no las valida: sobran, la factura ya está.
--
-- Antes, la copia de lo que se quita (la periodificación, sus dos asientos y sus
-- apuntes) en conta_s01p_recibido_antes, para su vuelta atrás. Anclada por
-- cuenta y empresa (regla 9); en otra base no encuentra Foodint y no hace nada.
-- Se puede pasar dos veces. Mueve filas que existen: va con «autorizo».

create table if not exists public.conta_s01p_recibido_antes (
  tabla text not null,
  id uuid not null,
  fila jsonb not null,
  guardado_at timestamptz not null default now(),
  primary key (tabla, id)
);
comment on table public.conta_s01p_recibido_antes is
  'S01p · 1641 · Lo recibido sin factura de octubre de Foodint que se quitó (periodificación, asientos y apuntes), para su vuelta atrás.';
alter table public.conta_s01p_recibido_antes enable row level security;
revoke all on public.conta_s01p_recibido_antes from public, anon, authenticated;

do $$
declare
  v_cuenta  constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_empresa constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  r jsonb; v_quedan int; v_prop int;
begin
  if not exists (select 1 from public.company where id = v_empresa and account_id = v_cuenta) then
    raise notice 'S01p·1641: no está Foodint en esta base: no se hace nada.'; return;
  end if;
  if strpos(pg_get_functiondef('public._compras_fin_de_mes(uuid,date)'::regprocedure), '-- S01p: lo periodificado que ya no hace falta') = 0 then
    raise exception 'S01p·1641: falta la 1640 (_compras_fin_de_mes sin el arreglo): no se toca.';
  end if;

  insert into public.conta_s01p_recibido_antes (tabla, id, fila)
  select 'purchase_accrual', a.id, to_jsonb(a) from public.purchase_accrual a
   where a.company_id = v_empresa and a.account_id = v_cuenta and a.month = '2026-10-01'
  on conflict do nothing;
  insert into public.conta_s01p_recibido_antes (tabla, id, fila)
  select 'journal_entry', e.id, to_jsonb(e) from public.journal_entry e
   join public.purchase_accrual a on a.id = e.source_id
   where a.company_id = v_empresa and a.account_id = v_cuenta and a.month = '2026-10-01' and e.account_id = v_cuenta
     and e.source_type in ('purchase_accrual', 'purchase_accrual_reversal') and e.status in ('propuesto', 'borrador')
  on conflict do nothing;
  insert into public.conta_s01p_recibido_antes (tabla, id, fila)
  select 'journal_line', l.id, to_jsonb(l) from public.journal_line l
   where l.entry_id in (select id from public.conta_s01p_recibido_antes where tabla = 'journal_entry')
  on conflict do nothing;

  r := public.conta_proponer_recibidos(v_empresa, '2026-10-01', '2026-10-31', 'Sumied');

  select count(*) into v_quedan from public.purchase_accrual where company_id = v_empresa and month = '2026-10-01';
  select count(*) into v_prop from public.journal_entry
   where company_id = v_empresa and account_id = v_cuenta and source_type in ('purchase_accrual', 'purchase_accrual_reversal')
     and entry_date between '2026-10-31' and '2026-11-01' and status in ('propuesto', 'borrador');
  raise notice 'S01p·1641: lo recibido sin factura de octubre, rehecho (%): quedan % periodificaciones y % asientos propuestos.', r, v_quedan, v_prop;
end $$;
