-- C9 · Lote 3 §5 (04/09/2026). El certificado en texto legible.
--
-- El JSON es para la maquina; esto es lo que se le enseña a una persona y lo
-- que se adjunta a una reclamacion. Misma regla dura: lo que no existe sale
-- como «no disponible» con su motivo, nunca en blanco.
--
-- SOLO LEE: llama a certificado_de_salida y lo formatea. Si el dato cambia, el
-- texto cambia solo; no hay dos verdades.

create or replace function public.certificado_de_salida_texto(p_sale_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  c   jsonb;
  t   text := '';
  e   jsonb;
  raya text := repeat('-', 74);
begin
  c := public.certificado_de_salida(p_sale_id);
  if c ? 'error' then
    return 'CERTIFICADO NO EMITIDO: ' || (c->>'error') || ' (' || (c->>'sale_id') || ')';
  end if;

  t := t || raya || E'\n';
  t := t || 'CERTIFICADO DE SALIDA DE PEDIDO' || E'\n';
  t := t || raya || E'\n';
  t := t || format('Pedido      %s   (plataforma: %s)', c->'pedido'->>'codigo', c->'pedido'->>'codigo_plataforma') || E'\n';
  t := t || format('Canal       %s', c->'pedido'->>'canal') || E'\n';
  t := t || format('Local       %s', c->'pedido'->>'local') || E'\n';
  t := t || format('Marca%s      %s',
        case when (c->'pedido'->>'multimarca')::boolean then 's' else ' ' end,
        c->'pedido'->>'marcas') || E'\n';
  t := t || format('Cliente     %s', c->'pedido'->>'cliente') || E'\n';
  t := t || format('Estado      %s', c->'pedido'->>'estado') || E'\n';
  t := t || format('Emitido     %s   (%s)', c->>'generado_madrid', c->>'zona_horaria') || E'\n';
  t := t || E'\n';

  t := t || 'HORAS' || E'\n' || raya || E'\n';
  for e in select * from jsonb_array_elements(c->'pasos') loop
    if e->>'estado' = 'ok' then
      t := t || format('  %-26s %s', e->>'paso', e->>'hora_madrid');
      if (e->>'fuerza') = 'debil' then t := t || '   [SELLO DEBIL]'; end if;
      t := t || E'\n';
      t := t || format('  %-26s fuente: %s', '', e->>'fuente') || E'\n';
    else
      t := t || format('  %-26s NO DISPONIBLE', e->>'paso') || E'\n';
      t := t || format('  %-26s fuente: %s', '', e->>'fuente') || E'\n';
    end if;
    if e ? 'nota' then
      t := t || format('  %-26s %s', '', e->>'nota') || E'\n';
    end if;
    t := t || E'\n';
  end loop;

  t := t || 'IMPRESIONES' || E'\n' || raya || E'\n';
  if jsonb_array_length(c->'impresiones') = 0 then
    t := t || '  NO DISPONIBLE - no hay ningun trabajo de impresion para este pedido.' || E'\n';
  else
    for e in select * from jsonb_array_elements(c->'impresiones') loop
      t := t || format('  %-9s %-6s creado %s  enviado %s  terminado %s  (intentos %s)',
            e->>'documento', e->>'estado_trabajo', e->>'creado_madrid',
            e->>'enviado_madrid', e->>'terminado_madrid', e->>'intentos') || E'\n';
      if (e->>'ultimo_error') <> 'ninguno' then
        t := t || format('  %-16s error: %s', '', e->>'ultimo_error') || E'\n';
      end if;
    end loop;
  end if;
  t := t || E'\n';

  t := t || 'UNIDADES ETIQUETADAS' || E'\n' || raya || E'\n';
  if (c->'unidades'->>'estado') = 'no_disponible' then
    t := t || '  NO DISPONIBLE' || E'\n';
    t := t || format('  %s', c->'unidades'->>'nota') || E'\n';
  else
    t := t || format('  %s etiquetas acuñadas, %s escaneadas por el cliente. Primera: %s',
          c->'unidades'->>'total', c->'unidades'->>'escaneadas',
          c->'unidades'->>'primera_acunada_madrid') || E'\n';
    for e in select * from jsonb_array_elements(c->'unidades'->'detalle') loop
      t := t || format('    [%s] %-34s ud %-3s  escaneada: %s',
            e->>'token', left(e->>'unidad', 34), e->>'n', e->>'escaneada_madrid') || E'\n';
    end loop;
  end if;
  t := t || E'\n';

  t := t || 'FOTO DE SALIDA' || E'\n' || raya || E'\n';
  if (c->'foto'->>'estado') = 'no_disponible' then
    t := t || '  NO DISPONIBLE' || E'\n';
    t := t || format('  %s', c->'foto'->>'nota') || E'\n';
  else
    for e in select * from jsonb_array_elements(c->'foto'->'fotos') loop
      t := t || format('  %s  hecha %s  recibida %s%s',
            e->>'tipo', e->>'hecha_madrid', e->>'recibida_madrid',
            case when (e->>'en_diferido')::boolean then '  [SUBIDA EN DIFERIDO]' else '' end) || E'\n';
      t := t || format('  medidas %s, %s bytes', e->>'medidas', e->>'bytes') || E'\n';
      t := t || format('  sha256  %s', e->>'sha256') || E'\n';
    end loop;
  end if;
  t := t || E'\n';

  t := t || 'VERIFICACION DE EMBOLSADO' || E'\n' || raya || E'\n';
  if (c->'verificacion'->>'estado') = 'no_disponible' then
    t := t || '  NO DISPONIBLE' || E'\n';
    t := t || format('  %s', c->'verificacion'->>'nota') || E'\n';
  else
    for e in select * from jsonb_array_elements(c->'verificacion'->'intentos') loop
      t := t || format('  %s  %s  leidas %s de %s  completo: %s',
            e->>'cuando_madrid', e->>'modo', e->>'leidas', e->>'esperadas', e->>'completo') || E'\n';
      if (e->>'salio_igual')::boolean then
        t := t || format('  SALIO IGUAL. Motivo: %s. Firmado por: %s',
              e->>'motivo', e->>'firmado_por') || E'\n';
      end if;
    end loop;
  end if;
  t := t || E'\n';

  t := t || 'LO QUE ESTE CERTIFICADO NO PRUEBA' || E'\n' || raya || E'\n';
  if jsonb_array_length(c->'avisos') = 0 then
    t := t || '  Nada: todas las fuentes estan disponibles.' || E'\n';
  else
    for e in select * from jsonb_array_elements(c->'avisos') loop
      t := t || format('  - %s', trim(both '"' from e::text)) || E'\n';
    end loop;
  end if;
  t := t || raya || E'\n';
  t := t || c->>'aviso_general' || E'\n';
  t := t || raya;

  return t;
end;
$function$;

comment on function public.certificado_de_salida_texto(uuid) is
  'C9 L3 §5: el certificado en texto legible, para adjuntar a una reclamacion. Formatea certificado_de_salida; no hay dos verdades.';

revoke all on function public.certificado_de_salida_texto(uuid) from public, anon;
grant execute on function public.certificado_de_salida_texto(uuid) to authenticated, service_role;
