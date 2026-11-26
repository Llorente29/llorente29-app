-- supabase/migrations/20261126T1605_k14b_lectura_completa.sql
--
-- K14b · La última lectura completa del extracto de cada banco, y si los cobros de clientes ya están casados con ella
-- (pregunta de R, 26/11: «Te deben» se da por cruzado con el banco solo con una lectura completa, no con cualquier
-- entrada suelta).
--
-- conta_banco_lectura_completa: una fila por banco activo (kind bank) de cada empresa, con su última lectura COMPLETA:
-- un extracto (bank_statement) que cuadra (saldo inicial + movimientos = saldo final: balanced, sin «sin comprobar»)
-- y que sigue al anterior sin hueco (continuity «primero» o «sigue»). Lo de antes ya estaba en bank_statement; esto lo
-- dice en un solo sitio. Y cuándo casó el motor del K14 los cobros de esa empresa (conta_banco_cobro.calculado_en):
-- «cruzada» es que lo casado es de después de esa lectura. Un banco sin ninguna lectura completa sale igual, con todo
-- vacío y «cruzada» falso (regla 7: no se esconde).
--
-- Solo añade una vista (security_invoker: cada uno ve lo de su cuenta, como en bank_statement). Nada en el camino del
-- pedido. Vuelta atrás: supabase/vuelta-atras/20261126T1605_k14b_lectura_completa.down.sql

create or replace view public.conta_banco_lectura_completa with (security_invoker = true) as
select t.company_id, t.account_id, t.id as treasury_account_id, t.name as banco,
       s.id as statement_id, s.source as fuente, s.period_from as desde, s.period_to as hasta,
       s.closing_balance as saldo_final, s.imported_at as leida_en,
       c.casados_en,
       (s.id is not null and c.casados_en is not null and c.casados_en >= s.imported_at) as cruzada
  from public.treasury_account t
  left join lateral (
    select x.* from public.bank_statement x
     where x.treasury_account_id = t.id and x.balanced is true and x.unchecked_reason is null and x.continuity in ('primero', 'sigue')
     order by x.period_to desc, x.imported_at desc limit 1) s on true
  left join lateral (select max(b.calculado_en) as casados_en from public.conta_banco_cobro b where b.company_id = t.company_id) c on true
 where t.kind = 'bank' and t.is_active;
comment on view public.conta_banco_lectura_completa is
  'K14b · Por banco activo, su última lectura completa del extracto (cuadra y sigue a la anterior sin hueco): desde, hasta, saldo final y cuándo se leyó; y si los cobros de clientes del K14 se casaron después (cruzada). «Te deben» (R) se da por cruzado con el banco hasta «hasta» solo si «cruzada».';
revoke all on public.conta_banco_lectura_completa from anon;
grant select on public.conta_banco_lectura_completa to authenticated, service_role;
