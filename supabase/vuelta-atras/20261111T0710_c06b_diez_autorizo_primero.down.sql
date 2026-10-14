-- supabase/vuelta-atras/20261111T0710_c06b_diez_autorizo_primero.down.sql
--
-- Vuelta atrás de 20261111T0710: quita la autorización del primer asiento en
-- C0008. PARA si ese asiento ya está en Diez (enviado o enlazado): quitarle la
-- autorización no lo saca de Diez, y Folvy tiene que seguir sabiendo por qué
-- está allí.
do $$
declare v_ids uuid[]; n int;
begin
  select array_agg(entry_id) into v_ids from public.conta_diez_autorizo
   where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and alcance = 'asiento' and nombre_bd = 'C0008';
  if exists (select 1 from public.external_send where entry_id = any (coalesce(v_ids, '{}')) and status in ('enviado', 'enlazado')) then
    raise exception 'Vuelta atrás de la 0710: el asiento autorizado ya está en Diez. No se toca nada.';
  end if;
  delete from public.conta_diez_autorizo where entry_id = any (coalesce(v_ids, '{}'));
  get diagnostics n = row_count;
  raise notice 'Vuelta atrás de la 0710: % autorizaciones quitadas.', n;
end $$;
