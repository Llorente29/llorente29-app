-- Vuelta atrás de B02 · 0210: cada regla vuelve a lo que tenía antes de la
-- tanda (palabras, destino, estado, confirmaciones y correcciones), leído de su
-- registro («Tanda B02 · 0210»). PARA si alguna ha casado algo desde entonces.
do $$
begin
  if exists (select 1 from public.bank_match b where b.rule_id in (select rule_id from public.bank_rule_log where created_by_name = 'Tanda B02 · 0210') and b.status = 'vivo') then
    raise exception 'Alguna regla corregida por la 0210 ya ha casado algo: deshaz esos casados antes.';
  end if;
end $$;
update public.bank_rule r
   set words = l.before->>'palabras', target = l.before->'destino', status = l.before->>'estado',
       confirmations = (l.before->>'confirmaciones')::int, corrections = (l.before->>'correcciones')::int, updated_at = now()
  from (select distinct on (rule_id) rule_id, before from public.bank_rule_log where created_by_name = 'Tanda B02 · 0210' order by rule_id, created_at desc) l
 where l.rule_id = r.id;
insert into public.bank_rule_log (account_id, rule_id, action, before, after, created_by, created_by_name)
select r.account_id, r.id, 'cambiada', null, jsonb_build_object('destino', r.target, 'estado', r.status), null, 'Vuelta atrás B02 · 0210'
  from public.bank_rule r where r.id in (select rule_id from public.bank_rule_log where created_by_name = 'Tanda B02 · 0210');
