-- Vuelta atrás de 20261024T1250_c12_traspaso_mensual.sql y 20261024T1251_c12_por_enviar_modo.sql (C12).
-- Devuelve conta_diez_por_enviar al texto del C07 (20261201T0450_c07_diez_todo.sql),
-- tal cual; quita las funciones del traspaso, su tabla y la columna modo.
-- PARA si ya hay algún traspaso apuntado o alguna empresa en modo mensual: eso
-- es historia (quién autorizó escribir en Diez real) y no se borra a ciegas.
-- Un solo bloque: el freno y lo que quita, juntos (si para, no quita nada, y
-- el último error es el del freno).

do $c12$
begin
  if to_regclass('public.conta_diez_traspaso') is not null
     and exists (select 1 from public.conta_diez_traspaso) then
    raise exception 'C12 · vuelta atrás: ya hay traspasos apuntados. No se borra su registro.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_diez_envio_empresa' and column_name = 'modo') then
    if exists (select 1 from public.conta_diez_envio_empresa where modo = 'mensual') then
      raise exception 'C12 · vuelta atrás: hay empresas en modo mensual. Primero se devuelven a «al validar».';
    end if;
  end if;

  execute $q$
create or replace function public.conta_diez_por_enviar(p_limite integer default 10)
returns table (entry_id uuid, account_id uuid, company_id uuid, origen text, kind text, tiene_envio boolean)
language sql stable security definer set search_path = public as $$
  select e.id, e.account_id, e.company_id, e.source_type,
         case when e.source_type in ('sales_day', 'supplier_invoice') or o.source_type in ('sales_day', 'supplier_invoice') then 'factura' else 'asiento' end,
         s.id is not null
    from public.journal_entry e
    join public.conta_diez_envio_empresa z on z.company_id = e.company_id and z.account_id = e.account_id and z.enviar
    left join public.journal_entry o on o.id = e.reverses_entry_id and o.account_id = e.account_id
    left join public.external_send s on s.entry_id = e.id and s.account_id = e.account_id and s.status <> 'rechazado'
   where e.status = 'validado'
     and e.entry_date >= z.desde
     and e.source_type not in ('migrated', 'opening', 'closing', 'template')
     and (e.reverses_entry_id is null or exists (
           select 1 from public.external_send x
            where x.entry_id = e.reverses_entry_id and x.account_id = e.account_id and x.status in ('enviado', 'enlazado')))
     and (
           (s.id is null and e.validated_at < now() - interval '2 minutes')
        or (s.status = 'pendiente' and s.next_try_at is not null and s.next_try_at <= now() and s.attempts < 3 and s.updated_at < now() - interval '2 minutes')
     )
   order by e.validated_at, e.id
   limit greatest(1, least(coalesce(p_limite, 10), 50))
$$
  $q$;

  drop function if exists public.conta_traspaso_terminar(uuid, jsonb, boolean);
  drop function if exists public.conta_traspaso_apuntar(uuid, integer, integer, jsonb);
  drop function if exists public.conta_traspaso_confirmar(uuid, date);
  drop function if exists public.conta_traspaso_revisar(uuid, date);
  drop function if exists public.conta_traspaso_saldos(uuid, date);
  drop function if exists public.conta_traspaso_lista(uuid, date);
  drop function if exists public._conta_traspaso_en_diez(uuid);
  drop function if exists public._conta_traspaso_va(uuid);
  drop table if exists public.conta_diez_traspaso;
  alter table public.conta_diez_envio_empresa drop column if exists modo;
end $c12$;
