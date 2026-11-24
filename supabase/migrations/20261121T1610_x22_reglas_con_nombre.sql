-- supabase/migrations/20261121T1610_x22_reglas_con_nombre.sql
--
-- X22 · Las reglas del banco que dicen la explicación de su cuenta en lugar de su nombre. La 0210 (B02, «las reglas
-- de Foodint») escribió el texto de tres reglas con la explicación de la cuenta de destino («Cuando el concepto tenga
-- «…» → <explicación> · <código>»). Las reglas nuevas ya no lo hacen; este fichero arregla las que quedaron escritas
-- así, en cualquier empresa: donde el texto lleva « → <explicación> · <código>» de su propia cuenta de destino, pasa a
-- « → <nombre del plan> · <código>». Nada más de la regla cambia (ni lo que busca, ni a qué cuenta va, ni su estado).
--
-- Es un update sobre lo que existe: SOLO con «autorizo». Lo de antes y lo de después de cada regla queda en su
-- registro (bank_rule_log, «cambiada»), y de ahí lo devuelve la vuelta atrás
-- (supabase/vuelta-atras/20261121T1610_x22_reglas_con_nombre.down.sql), regla a regla y solo si nadie la ha tocado
-- después.
--
-- Nada en el camino del pedido. El real lo lanza Julio.

drop table if exists _x22_reglas;
create temp table _x22_reglas on commit drop as
select r.id, r.account_id, r.words as antes,
       replace(r.words, ' → ' || ca.plain_name || ' · ' || ca.code, ' → ' || ca.name || ' · ' || ca.code) as despues
  from public.bank_rule r
  join public.company_account ca on ca.company_id = r.company_id and ca.account_id = r.account_id and ca.code = r.target ->> 'cuenta'
 where ca.plain_name is not null and btrim(ca.plain_name) <> '' and ca.plain_name <> ca.name
   and position(' → ' || ca.plain_name || ' · ' || ca.code in r.words) > 0;

insert into public.bank_rule_log (account_id, rule_id, action, before, after, created_by, created_by_name)
select x.account_id, x.id, 'cambiada', jsonb_build_object('palabras', x.antes), jsonb_build_object('palabras', x.despues), null, 'Tanda X22 · 1610'
  from _x22_reglas x;

update public.bank_rule r set words = x.despues, updated_at = now()
  from _x22_reglas x where x.id = r.id;

do $$
declare n int;
begin
  select count(*) into n from _x22_reglas;
  raise notice 'X22 · 1610: % % con el nombre de su cuenta en lugar de su explicación.', n, case n when 1 then 'regla' else 'reglas' end;
end $$;
