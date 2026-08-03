-- ============================================================================
-- Folvy · "Prevención de Riesgos Laborales (PRL)" — FICHA DE SOLO ARCHIVO
-- Noveno y último del catálogo · OLEADA 3
-- ----------------------------------------------------------------------------
-- 🔴 ESTE CURSO NO SE IMPARTE. Es la excepción del catálogo.
--
-- POR QUÉ (límite legal duro, verificado):
--   La formación en PRL es ACTIVIDAD PREVENTIVA reservada. Solo puede impartirla
--   y certificarla el Servicio de Prevención (propio o ajeno acreditado), o la
--   empresa con medios propios si dispone de personal con la titulación técnica
--   exigida (Nivel Intermedio o Superior, RD 39/1997). La Inspección de Trabajo
--   ha sido tajante: no puede impartirla un tercero externo que no esté
--   acreditado como Servicio de Prevención Ajeno.
--   → Folvy, como SaaS, NO es el servicio de prevención de su cliente. No puede
--     emitir este certificado. Fingir lo contrario sería vender un cumplimiento
--     inválido y dejar al cliente descubierto ante una inspección.
--
-- QUÉ SÍ HACE FOLVY: archivar el certificado emitido por el SPA, vigilar su
--   caducidad, avisar antes de que venza y demostrarlo en el informe de
--   inspección. Eso es real y tiene valor.
--
-- MODELO DE DATOS: delivery_mode='solo_archivo'. Se siembra SIN preguntas de
--   test (no hay nada que evaluar: la evaluación la hace el SPA) y con secciones
--   informativas que explican al cliente qué debe hacer. El sistema debe tratar
--   este curso como no-asignable a empleados para hacer/firmar: su cumplimiento
--   se acredita vía employee_formations (certificado externo).
--
-- ⚠️ DEUDA DECLARADA (frente futuro): hoy la UI no distingue visualmente un
--    curso 'solo_archivo'. Debería mostrarse en el catálogo con una etiqueta
--    clara ("lo imparte tu servicio de prevención — súbelo aquí") y NO ofrecer
--    el botón de asignar/hacer. Mientras no exista, este curso se siembra en
--    'draft' para que no aparezca como si fuera realizable.
--    Disparador: al construir la vista de catálogo por delivery_mode.
--
-- ⚠️ REVISIÓN DE JULIO PENDIENTE — status 'draft'.
--
-- DEPENDE DE: 20260806T1500_formacion_c1.sql · IDEMPOTENTE · Aplicada:
-- ============================================================================

do $guard$
begin
  if to_regclass('public.course') is null or to_regclass('public.course_section') is null then
    raise exception 'Faltan tablas de Formación C1.';
  end if;
end
$guard$;

do $seed$
declare
  v_course_id uuid;
begin
  insert into public.course (
    account_id, code, title, summary, legal_basis, delivery_mode,
    reeval_months, is_mandatory, appcc_prerequisite, estimated_minutes,
    pass_threshold_pct, version, status
  ) values (
    null, 'prl_riesgos_laborales',
    'Prevención de Riesgos Laborales (PRL)',
    'Formación obligatoria que Folvy NO imparte: la da tu servicio de prevención. Aquí se archiva el certificado, se vigila su caducidad y se demuestra en inspección.',
    'Ley 31/1995 (LPRL), art. 19 · RD 39/1997, Reglamento de los Servicios de Prevención',
    'solo_archivo',
    null,   -- la vigencia la marca el SPA y el puesto: no la fija Folvy
    true, false, 0, 0, 1, 'draft'
  )
  on conflict (code) where account_id is null
  do update set title = excluded.title, summary = excluded.summary,
    legal_basis = excluded.legal_basis, delivery_mode = excluded.delivery_mode,
    reeval_months = excluded.reeval_months, estimated_minutes = excluded.estimated_minutes
  returning id into v_course_id;

  if v_course_id is null then
    select id into v_course_id from public.course
     where code = 'prl_riesgos_laborales' and account_id is null;
  end if;

  delete from public.course_option
   where question_id in (select id from public.course_question where course_id = v_course_id);
  delete from public.course_question where course_id = v_course_id;
  delete from public.course_section  where course_id = v_course_id;

  -- ═══ SECCIONES INFORMATIVAS (para la oficina, no para examinar) ═══════════

  insert into public.course_section (course_id, ord, title, body) values

  (v_course_id, 1, 'Por qué Folvy no imparte esta formación',
$md$De los nueve cursos del catálogo, este es el único que **Folvy no puede darte**. Y conviene explicar por qué, porque hay mucha oferta en el mercado que sí lo hace y no siempre es válida.

La formación en prevención de riesgos laborales es **actividad preventiva reservada**. Solo puede impartirla y certificarla:

- El **servicio de prevención ajeno (SPA)** acreditado que tenga contratado la empresa, o
- La propia empresa **con medios propios**, si cuenta con personal que tenga la titulación técnica exigida (Nivel Intermedio o Superior del RD 39/1997).

La Inspección de Trabajo ha sido clara en esto: un tercero externo que no esté acreditado como servicio de prevención **no puede impartir formación preventiva válida**. Folvy es un software de gestión, no el servicio de prevención de nadie.

**Podríamos haber montado el curso igual.** Habría quedado bien en el catálogo y habría sumado un número. Pero el certificado no valdría, y el cliente se enteraría el día de la inspección — que es el peor día posible para enterarse.

> **Marco legal** — Ley 31/1995 (LPRL), art. 19: el empresario debe garantizar que cada trabajador reciba formación teórica y práctica, suficiente y adecuada, en materia preventiva. RD 39/1997: regula los servicios de prevención y las titulaciones necesarias para desarrollar funciones preventivas.$md$),

  (v_course_id, 2, 'Qué formación de PRL necesita tu plantilla',
$md$La formación en PRL **no es genérica**: tiene que ser específica del puesto de trabajo y de los riesgos reales de ese puesto. No es lo mismo un cocinero que un repartidor.

En hostelería, lo habitual es:

- **Formación inicial** al incorporarse, y cuando cambian las funciones o se introduce un equipo nuevo.
- **Riesgos específicos de cocina**: cortes, quemaduras, superficies calientes, suelos deslizantes, manipulación de cargas, productos químicos de limpieza, ruido y temperatura.
- **Riesgos de sala**: manipulación manual de cargas, posturas, atención al público.
- **Riesgos de reparto**, si hay: seguridad vial, uso del vehículo, tráfico.
- **Medidas de emergencia**: evacuación, extintores, primeros auxilios (art. 20 LPRL).

Muchos convenios del sector fijan además horas mínimas por puesto. **Consúltalo con tu SPA y con tu convenio**: ellos determinan el contenido y la vigencia, no Folvy.

> **Datos técnicos** — LPRL art. 19: la formación debe impartirse dentro de la jornada de trabajo o, en su defecto, en otras horas con descuento del tiempo invertido; su coste no puede recaer en ningún caso sobre los trabajadores. Debe repetirse periódicamente si cambian los riesgos o aparecen nuevos.$md$),

  (v_course_id, 3, 'Qué hace Folvy con ella (que no es poco)',
$md$Que Folvy no la imparta no significa que se desentienda. De hecho, aquí está el problema real que sí resuelve.

**El problema:** los certificados de PRL llegan en PDF por correo, se guardan en una carpeta, y **caducan sin que nadie se entere**. Cuando llega la inspección, falta la mitad y nadie sabe de quién es cada papel.

**Lo que hace Folvy:**

1. **Archiva el certificado** de cada empleado en su ficha, con su fecha de emisión y de caducidad.
2. **Vigila las caducidades** y avisa antes de que venzan, no después.
3. **Lo incluye en el informe "Listo para la inspección"**, junto con la formación interna: un solo documento con todo.
4. **Marca los huecos**: quién no tiene certificado, a quién le caduca en 30 días.

Así, el día de la inspección la pregunta *"¿me acredita la formación en PRL de esta persona?"* se responde en un clic, tenga el certificado quien lo tenga.

**Cómo se registra:** ficha del empleado → pestaña Formaciones → añadir formación externa, con el PDF, el emisor (tu SPA) y la fecha de caducidad.

> **Datos técnicos** — La documentación de la actividad preventiva, incluida la formación, debe estar a disposición de la autoridad laboral. LPRL art. 23: obligación de elaborar y conservar la documentación relativa a la actividad preventiva.$md$),

  (v_course_id, 4, 'Qué preguntar a tu servicio de prevención',
$md$Si estás poniendo esto en orden, esta es la lista útil para tu próxima llamada al SPA:

- **¿Qué formación tiene que tener cada puesto** de mi plantilla (cocina, sala, reparto, oficina)?
- **¿Cuántas horas** y con qué vigencia? ¿Cada cuánto hay que repetirla?
- **¿Quién de mi plantilla la tiene ya** y quién no? ¿Me pasáis el listado?
- **¿Me enviáis los certificados individuales** con nombre, DNI y fecha? *(Son los que se archivan en Folvy.)*
- **¿Qué formación hace falta al incorporarse alguien nuevo**, y en qué plazo?
- **¿Quién está designado** para las medidas de emergencia y primeros auxilios?
- **¿La evaluación de riesgos del centro está actualizada?** ¿Incluye la violencia sexual entre los riesgos, como exige la LO 10/2022?

**Un aviso práctico:** en hostelería la rotación es alta, y la formación inicial de PRL suele ser lo primero que se queda atrás cuando entra gente en temporada alta. Es exactamente lo que mira una inspección tras un accidente.

> **Datos técnicos** — La formación debe adaptarse a la evolución de los riesgos y a la aparición de otros nuevos, y repetirse periódicamente si es necesario. En caso de accidente laboral, la ausencia de formación acreditada del trabajador accidentado agrava la responsabilidad empresarial (recargo de prestaciones, sanciones administrativas y eventual responsabilidad penal).$md$);

  raise notice 'Ficha PRL sembrada (solo_archivo, sin test, draft). id: %', v_course_id;
end
$seed$;

-- ── VERIFICACIÓN (POR SEPARADO) ────────────────────────────────────────────
-- select c.code, c.status, c.delivery_mode, c.reeval_months,
--   (select count(*) from course_section  s where s.course_id=c.id) as secciones,
--   (select count(*) from course_question q where q.course_id=c.id) as preguntas
-- from course c where c.code='prl_riesgos_laborales' and c.account_id is null;
-- Esperado: draft · solo_archivo · reeval NULL · 4 secciones · 0 preguntas.
--
-- Y el catálogo completo (9 cursos):
-- select code, status, delivery_mode, is_mandatory, reeval_months
--   from course where account_id is null order by code;
