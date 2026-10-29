-- supabase/vuelta-atras/20261029T0732_l1a_origen_movil.down.sql
--
-- Devuelve a «kiosko» exactamente las marcas que cambió la 0732: las que tienen
-- en el rastro su fila «edit» con el motivo de la 0732 y siguen en «movil».
-- Deja también su rastro (otra fila «edit» por marca, con su motivo).

do $$
declare v_n int;
begin
  perform set_config('app.clock_edit_reason',
    'Vuelta atrás de la corrección de origen del 29/10/2026 (20261029T0732_l1a_origen_movil): vuelve a «kiosko».', true);
  perform set_config('app.clock_edit_actor', 'Corrección de datos (Folvy)', true);

  update public.clock_entries ce
     set source = 'kiosko'
   where ce.source = 'movil'
     and exists (
       select 1 from public.clock_entry_audit a
        where a.clock_entry_id = ce.id
          and a.action = 'edit'
          and a.reason like 'Origen corregido:%(20261029T0732_l1a_origen_movil)%'
          and a.before ->> 'source' = 'kiosko'
          and a.after ->> 'source' = 'movil');
  get diagnostics v_n = row_count;

  perform set_config('app.clock_edit_reason', '', true);
  perform set_config('app.clock_edit_actor', '', true);
  raise notice 'Vuelven a «kiosko»: % marcas.', v_n;
end $$;
