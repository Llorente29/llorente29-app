-- C9 · Lote 2 §2 (04/09/2026). El bucket de la evidencia.
--
-- PRIVADO, y no es una preferencia: cada foto lleva impreso el nombre de pila
-- del cliente en la etiqueta. Es un dato personal.
--
-- NO SE REPITE EL PATRON DE B51/E19. Medido hoy: `delivery-proof` y
-- `employee-documents` siguen PUBLICOS, con documentos de empleados dentro.
-- Este lote no los arregla -- no es su encargo -- pero nace al reves que ellos.
--
-- Se crea tambien `l3-muestras`, privado, para el corpus del banco del lector:
-- esas 8 fotos llevan nombres de pila impresos (Jerome, Alvaro, Angela, Samy,
-- Virginia) y estaban en el repositorio por un error mio. Ya no.
--
-- LECTURA SOLO POR URL FIRMADA. No se crea ninguna politica de SELECT para
-- `authenticated`: quien quiera ver una foto pide una URL firmada de vida corta
-- a la edge function, que comprueba antes que el pedido es de su cuenta. Una
-- politica de SELECT por prefijo seria mas comoda y filtraria peor: el prefijo
-- es adivinable y una URL firmada caduca.
--
-- ESCRITURA SOLO service_role, que en Supabase salta la RLS de storage.objects.
-- Por eso aqui no hay politica de INSERT: la ausencia ES la regla.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('order-evidence', 'order-evidence', false, 10485760, array['image/jpeg','image/webp']),
  ('l3-muestras',    'l3-muestras',    false, 10485760, array['image/jpeg','image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Nada de anon/authenticated sobre estos dos buckets. Se limpian por si acaso.
drop policy if exists oe_no_anon    on storage.objects;
drop policy if exists oe_lectura    on storage.objects;
drop policy if exists l3m_lectura   on storage.objects;

do $verif$
declare v_pub boolean; v_n int;
begin
  foreach v_pub in array array[false] loop null; end loop;

  select count(*) into v_n from storage.buckets
   where id in ('order-evidence','l3-muestras') and public is true;
  if v_n > 0 then
    raise exception 'C9 L2: algun bucket de evidencia ha quedado PUBLICO.';
  end if;

  select count(*) into v_n from storage.buckets
   where id in ('order-evidence','l3-muestras');
  if v_n <> 2 then
    raise exception 'C9 L2: faltan buckets (esperados 2, hay %).', v_n;
  end if;

  -- Ninguna politica de storage.objects puede nombrar estos buckets: la lectura
  -- va por URL firmada y la escritura por service_role.
  select count(*) into v_n from pg_policies
   where schemaname='storage' and tablename='objects'
     and (qual ilike '%order-evidence%' or with_check ilike '%order-evidence%'
       or qual ilike '%l3-muestras%'    or with_check ilike '%l3-muestras%');
  if v_n > 0 then
    raise exception 'C9 L2: hay % politica(s) de storage.objects que abren estos buckets.', v_n;
  end if;
end
$verif$;
