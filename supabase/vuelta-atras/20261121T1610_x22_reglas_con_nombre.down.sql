-- supabase/vuelta-atras/20261121T1610_x22_reglas_con_nombre.down.sql
--
-- X22 · Vuelta atrás de la 1610: cada regla que cambió vuelve a su texto de antes (de su registro, «Tanda X22 · 1610»),
-- solo si sigue diciendo lo que dejó la 1610 (si alguien la ha tocado después, se queda como está).

update public.bank_rule r set words = l.before ->> 'palabras', updated_at = now()
  from public.bank_rule_log l
 where l.rule_id = r.id and l.created_by_name = 'Tanda X22 · 1610' and l.action = 'cambiada'
   and r.words = l.after ->> 'palabras';
delete from public.bank_rule_log where created_by_name = 'Tanda X22 · 1610' and action = 'cambiada';
