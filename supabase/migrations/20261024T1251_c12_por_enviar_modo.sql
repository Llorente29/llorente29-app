-- C12 · conta_diez_por_enviar deja fuera las empresas que traspasan una vez al mes.
-- cambia: public.conta_diez_por_enviar · prueba: supabase/staging/sql/20261024_c12_traspaso_prueba.sql
--
-- Misma firma y mismo cuerpo que el C07 (20261201T0450_c07_diez_todo.sql), con
-- una condición más: la empresa no está en modo 'mensual' (la columna la añade
-- 20261024T1250_c12_traspaso_mensual.sql, que va antes en la tanda). Como
-- ninguna empresa lo está, sale exactamente lo mismo que hoy.
-- Vuelta atrás: supabase/vuelta-atras/20261024T1250_c12_traspaso_mensual.down.sql
-- (devuelve este cuerpo al del C07, byte a byte).

-- conta_diez_por_enviar: igual que hoy, pero sin las empresas en modo mensual.
create or replace function public.conta_diez_por_enviar(p_limite integer DEFAULT 10)
 returns table(entry_id uuid, account_id uuid, company_id uuid, origen text, kind text, tiene_envio boolean)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select e.id, e.account_id, e.company_id, e.source_type,
         case when e.source_type in ('sales_day', 'supplier_invoice') or o.source_type in ('sales_day', 'supplier_invoice') then 'factura' else 'asiento' end,
         s.id is not null
    from public.journal_entry e
    join public.conta_diez_envio_empresa z on z.company_id = e.company_id and z.account_id = e.account_id and z.enviar
     and coalesce(z.modo, 'al_validar') = 'al_validar'
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
$function$;
