-- 20260806T1610_compliance_docs_due_helper.sql
-- Aplicada: 2026-08-06 por MCP. Verificada.
-- Lista las fichas que vencen (caducan o toca revisar) dentro de p_days y que NO
-- se han recordado en el último ciclo. Uso interno de compliance-doc-notify.
create or replace function public.compliance_docs_due(p_days int default 30)
returns table (
  id uuid, account_id uuid, title text, reference text,
  expires_at date, review_due_at date, last_reminder_at timestamptz,
  supplier_id uuid, supplier_name text, supplier_email text, account_name text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select cd.id, cd.account_id, cd.title, cd.reference,
         cd.expires_at, cd.review_due_at, cd.last_reminder_at,
         cd.supplier_id, s.name, s.email, a.name
  from compliance_document cd
  left join supplier s on s.id = cd.supplier_id
  left join accounts a on a.id = cd.account_id
  where cd.status <> 'superseded'
    and (
      (cd.expires_at    is not null and cd.expires_at    <= current_date + p_days) or
      (cd.review_due_at is not null and cd.review_due_at <= current_date + p_days)
    )
    and (cd.last_reminder_at is null or cd.last_reminder_at < now() - interval '25 days');
$$;

grant execute on function public.compliance_docs_due(int) to service_role;

notify pgrst, 'reload schema';
