-- ============================================================================
-- Folvy · SEMILLA — Curso "Gestión de alérgenos e intolerancias" (plantilla GLOBAL)
-- ----------------------------------------------------------------------------
-- Contenido LITERAL del dosier redactado por Julio Gª Colón (Documentos 1, 2 y 3).
-- Alineado con el Reglamento (UE) 1169/2011 y el Real Decreto 126/2015.
--
-- ⚠️ CONTENIDO DE CUMPLIMIENTO LEGAL: no reescribir ni "mejorar" el texto ni las
--    preguntas sin aprobación de Julio. El solucionario está verificado contra el
--    dosier original: 1-b · 2-c · 3-b · 4-c · 5-b · 6-c · 7-b · 8-b · 9-b · 10-b
--
-- PLANTILLA GLOBAL: account_id IS NULL → visible para todas las cuentas, que la
-- adoptan (patrón ingredient_template). El coste/persona y el responsable de
-- formación los pone cada cuenta al adoptarlo.
--
-- DEPENDE DE: la migración de estructura de Formación C1 (course, course_section,
-- course_question, course_option). Aplicar DESPUÉS de aquella.
--
-- IDEMPOTENTE: se puede reejecutar sin duplicar (borra y recrea el contenido del
-- curso por su `code`, conservando el id del curso para no romper asignaciones).
--
-- Aplicada:
-- ============================================================================

-- Guard: si la estructura no existe, abortar con mensaje claro (regla: no fiarse
-- del "Success" del SQL Editor; que falle ruidoso, no en silencio).
do $guard$
begin
  if to_regclass('public.course') is null
     or to_regclass('public.course_section') is null
     or to_regclass('public.course_question') is null
     or to_regclass('public.course_option') is null then
    raise exception 'Faltan tablas de Formación C1 (course/course_section/course_question/course_option). Aplica primero la migración de estructura.';
  end if;
end
$guard$;

do $seed$
declare
  v_course_id uuid;
  v_q uuid;
begin
  -- ── 1. CURSO ──────────────────────────────────────────────────────────────
  insert into public.course (
    account_id, code, title, summary, legal_basis, delivery_mode,
    reeval_months, is_mandatory, appcc_prerequisite, estimated_minutes,
    pass_threshold_pct, version, status
  ) values (
    null,
    'alergenos_intolerancias',
    'Gestión de alérgenos e intolerancias en hostelería',
    'Formación interna sobre los 14 alérgenos de declaración obligatoria, prevención de la contaminación cruzada y protocolo operativo en recepción, cocina y sala.',
    'Reglamento (UE) 1169/2011 · Real Decreto 126/2015',
    'folvy_imparte',
    12, true, true, 25, 70, 1, 'published'
  )
  on conflict (code) where account_id is null
  do update set
    title = excluded.title,
    summary = excluded.summary,
    legal_basis = excluded.legal_basis,
    reeval_months = excluded.reeval_months,
    estimated_minutes = excluded.estimated_minutes,
    status = excluded.status
  returning id into v_course_id;

  if v_course_id is null then
    select id into v_course_id from public.course
     where code = 'alergenos_intolerancias' and account_id is null;
  end if;

  -- Contenido regenerable: se limpia y se vuelve a sembrar (el id del curso NO
  -- cambia, así las asignaciones existentes siguen apuntando bien).
  delete from public.course_option
   where question_id in (select id from public.course_question where course_id = v_course_id);
  delete from public.course_question where course_id = v_course_id;
  delete from public.course_section  where course_id = v_course_id;

  -- ── 2. TEORÍA (Documento 1 y 2 del dosier) ────────────────────────────────

  insert into public.course_section (course_id, ord, title, body) values
  (v_course_id, 1, 'Conceptos fundamentales',
$md$**Alergia alimentaria**: reacción inmunológica adversa generada por la ingesta de proteínas alimentarias específicas. Puede ser desencadenada por cantidades mínimas (trazas) y producir cuadros severos como el shock anafiláctico, que pone en riesgo la vida en minutos.

**Intolerancia alimentaria**: reacción adversa no inmunológica vinculada al metabolismo o la digestión (por ejemplo, la deficiencia de lactasa en la intolerancia a la lactosa). Produce malestar digestivo grave, pero generalmente no es letal de forma inmediata.

**Contaminación cruzada**: proceso involuntario por el cual un alérgeno es transferido desde un alimento, superficie, utensilio o mano hacia un alimento destinado a un cliente con alergia.$md$),

  (v_course_id, 2, 'Los 14 alérgenos de declaración obligatoria',
$md$Anexo II del Reglamento (UE) 1169/2011.

**1. Cereales con gluten** — Trigo, centeno, cebada, avena, espelta, kamut o sus variedades híbridas. Presente en pan, rebozados, pastas y salsas espesadas con harina.

**2. Crustáceos** — Cangrejos, langostas, gambas, langostinos, camarones. También pastas de gamba y caldos concentrados.

**3. Huevos** — En todas sus formas y derivados: mayonesas, rebozados, postres, pincelados en bollería, pastas al huevo.

**4. Pescado** — Todo tipo de pescados, gelatinas de pescado, surimi, salsa de pescado, caldos de pescado.

**5. Cacahuetes** — Cacahuetes enteros, aceites de cacahuete, mantequilla de cacahuete, toppings en cocina asiática o repostería.

**6. Soja** — Brotes de soja, salsa de soja, tofu, edamame, lecitina de soja (aditivo E-322).

**7. Leche y derivados** — Incluye la lactosa: queso, mantequilla, nata, yogur, suero lácteo en embutidos o salsas.

**8. Frutos de cáscara** — Almendras, avellanas, nueces, anacardos, pacanas, castañas de Pará, pistachos, macadamias. Pesto, pralinés.

**9. Apio** — Apio en rama, raíz, sal de apio, caldos de verduras procesados, fondos de cocina.

**10. Mostaza** — Mostaza en grano, en polvo, salsas preparadas, aliños de ensalada, marinados.

**11. Granos de sésamo** — Semillas sueltas en panes, aceite de sésamo, pasta tahini, hummus.

**12. Sulfitos / dióxido de azufre** — En concentraciones superiores a 10 mg/kg o 10 mg/l. Vinos, vinagres, frutos secos desecados, conserva de patata.

**13. Altramuces** — Altramuces enteros, harina de altramuz presente en ciertos productos de panadería o aperitivos.

**14. Moluscos** — Mejillones, almejas, calamares, pulpos, caracoles, ostras y sus extractos.$md$),

  (v_course_id, 3, 'Protocolo (POE) · Fase A: recepción y almacenamiento',
$md$- Revisar las etiquetas de todas las materias primas al recibirlas. Verificar los alérgenos resaltados en negrita o cursiva.
- Almacenar los productos libres de gluten o especiales para alergias en estantes superiores o armarios separados, debidamente cerrados y etiquetados.
- No trasvasar ingredientes a recipientes genéricos sin etiquetar con la lista completa de ingredientes.$md$),

  (v_course_id, 4, 'Protocolo (POE) · Fase B: preparación y cocina',
$md$- Lavar y desinfectar la zona de trabajo (encimera) y las manos, y colocarse un delantal limpio antes de preparar una comanda para alérgicos.
- Utilizar utillaje exclusivo o específicamente higienizado (tablas, cuchillos, sartenes).
- **Prohibición estricta de compartir freidoras o planchas.** El calor de la freidora NO elimina el alérgeno. Las patatas para un celíaco NUNCA se fríen en la misma freidora usada para croquetas o empanados.
- Si se comete un error en un plato (por ejemplo, se añade queso por olvido), **NUNCA se debe retirar el ingrediente a mano**. El plato debe desecharse y elaborarse de nuevo por completo.$md$),

  (v_course_id, 5, 'Protocolo (POE) · Fase C: sala y servicio al cliente',
$md$- Anotar en la comanda del TPV o comandero la alerta clara (por ejemplo: "¡¡ALERGIA GRAVE AL GLUTEN!!").
- El camarero debe comunicar directamente el pedido en voz alta al jefe de cocina.
- Llevar el plato del alérgico de manera individual, nunca en la misma bandeja pegado a otros platos tradicionales.
- Servir identificando el plato en la mesa de forma explícita al cliente.$md$);

  -- ── 3. TEST (Documento 3 del dosier) ──────────────────────────────────────
  -- Solucionario verificado: 1-b 2-c 3-b 4-c 5-b 6-c 7-b 8-b 9-b 10-b

  -- P1
  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 1, '¿Cuál es la diferencia fundamental entre una alergia y una intolerancia alimentaria?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Las intolerancias afectan al sistema inmune y las alergias al digestivo.', false, 'Es justo al revés: la alergia es inmunológica.'),
   (v_q, 'Las alergias involucran al sistema inmunológico y pueden causar reacciones mortales (anafilaxia); las intolerancias afectan principalmente al sistema digestivo.', true, 'Correcto. La alergia puede ser mortal en minutos; la intolerancia produce malestar digestivo.'),
   (v_q, 'No existe diferencia, ambas son exactamente lo mismo.', false, 'Son mecanismos distintos y con gravedad muy distinta.'),
   (v_q, 'La intolerancia se produce únicamente por ingerir productos caducados.', false, 'La intolerancia es metabólica o digestiva, no depende de la caducidad.');

  -- P2
  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 2, '¿Cuántos alérgenos son de declaración obligatoria según el Reglamento (UE) 1169/2011?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, '10', false, 'Son 14, recogidos en el Anexo II del Reglamento.'),
   (v_q, '12', false, 'Son 14, recogidos en el Anexo II del Reglamento.'),
   (v_q, '14', true, 'Correcto. Los 14 del Anexo II del Reglamento (UE) 1169/2011.'),
   (v_q, '20', false, 'Son 14, recogidos en el Anexo II del Reglamento.');

  -- P3
  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 3, 'Si un cliente alérgico al pescado pide patatas fritas, ¿podemos freírlas en la freidora habitual donde también freímos rebozados de bacalao?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Sí, porque las altas temperaturas del aceite destruyen los alérgenos.', false, 'FALSO y peligroso: el calor NO elimina el alérgeno.'),
   (v_q, 'No, porque las proteínas del pescado permanecen en el aceite y contaminarán las patatas por contaminación cruzada.', true, 'Correcto. Nunca se comparte freidora con un alérgeno.'),
   (v_q, 'Sí, si las patatas se fríen durante más de 10 minutos.', false, 'El tiempo de fritura no elimina la proteína alergénica.'),
   (v_q, 'Sí, siempre que se escurran bien antes de servir.', false, 'Escurrir no elimina el alérgeno transferido.');

  -- P4
  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 4, 'Si un plato preparado contiene por error un ingrediente alérgeno (por ejemplo, queso en una hamburguesa para un alérgico a la proteína de la leche), ¿qué debemos hacer?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Retirar el queso con un tenedor y servir la hamburguesa.', false, 'NUNCA se retira el alérgeno a mano: el resto del plato ya está contaminado.'),
   (v_q, 'Calentar de nuevo la hamburguesa para fundir los restos de queso.', false, 'El calor no elimina el alérgeno.'),
   (v_q, 'Desechar la preparación y volver a hacer la hamburguesa desde cero con utensilios limpios.', true, 'Correcto. El plato se desecha y se elabora de nuevo por completo.'),
   (v_q, 'Limpiar la carne con papel de cocina.', false, 'Limpiar no elimina las trazas de proteína.');

  -- P5
  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 5, '¿El apio y la mostaza son alérgenos de declaración obligatoria?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'No, solo son condimentos opcionales.', false, 'Ambos están en la lista oficial de los 14.'),
   (v_q, 'Sí, ambos figuran en la lista oficial de los 14 alérgenos obligatorios.', true, 'Correcto. Apio (9) y mostaza (10) del Anexo II.'),
   (v_q, 'Solo si se sirven frescos, en salsa no.', false, 'También en salsas, caldos y aliños procesados.'),
   (v_q, 'La mostaza sí, pero el apio no.', false, 'Los dos son de declaración obligatoria.');

  -- P6
  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 6, '¿Qué se debe hacer si un cliente pregunta por la presencia de un alérgeno y el camarero no está seguro del ingrediente de una salsa?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Asegurar al cliente que no lleva nada para no perder la venta.', false, 'Poner en riesgo la vida del cliente por una venta es inaceptable.'),
   (v_q, 'Indicar que "cree" que no lleva pero que es bajo su responsabilidad.', false, 'La responsabilidad es del establecimiento; nunca se traslada al cliente.'),
   (v_q, 'Consultar inmediatamente la ficha técnica del plato o preguntar al cocinero antes de responder.', true, 'Correcto. Ante la duda, siempre verificar antes de responder.'),
   (v_q, 'Decirle que todos los platos de la carta contienen todos los alérgenos.', false, 'Información falsa; además incumple el deber de informar.');

  -- P7
  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 7, '¿Cuál es la forma correcta de almacenar materias primas sin gluten en el almacén o cámara?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Debajo de las harinas de trigo para aprovechar espacio.', false, 'Peligroso: las trazas de harina caen por gravedad.'),
   (v_q, 'En estantes superiores o espacios aislados, cerrados y etiquetados, para evitar que caigan trazas.', true, 'Correcto. Arriba, aislado, cerrado y etiquetado.'),
   (v_q, 'Junto a los pescados frescos para mantenerlos fríos.', false, 'Introduce riesgo de contaminación cruzada con otro alérgeno.'),
   (v_q, 'No requiere ningún almacenamiento especial.', false, 'Sí lo requiere: separación e identificación.');

  -- P8
  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 8, '¿Los sulfitos deben declararse siempre obligatoriamente?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Sí, en cualquier cantidad.', false, 'Solo por encima del umbral reglamentario.'),
   (v_q, 'Solo si están presentes en concentraciones superiores a 10 mg/kg o 10 mg/litro.', true, 'Correcto. Ese es el umbral que fija el Reglamento.'),
   (v_q, 'No, los sulfitos no están regulados por la normativa europea.', false, 'Sí lo están: son el alérgeno 12 del Anexo II.'),
   (v_q, 'Solo si el producto es vino tinto.', false, 'Afecta también a vinagres, frutos secos desecados y conservas.');

  -- P9
  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 9, 'Al llevar el plato preparado para un cliente alérgico a la mesa:')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Se transporta junto con los platos del resto de la mesa rozándose en la misma bandeja.', false, 'El roce entre platos transfiere alérgenos.'),
   (v_q, 'Se lleva de forma aislada e identificada, evitando el contacto con otros platos.', true, 'Correcto. Individual, identificado y sin contacto.'),
   (v_q, 'Se le pide al cliente que vaya a buscarlo a la barra.', false, 'No es el procedimiento; además no garantiza la identificación.'),
   (v_q, 'No requiere ninguna atención diferente.', false, 'Requiere transporte y entrega diferenciados.');

  -- P10
  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 10, '¿Qué se considera "contaminación cruzada"?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'La pérdida de temperatura en un plato preparado.', false, 'Eso es un problema de servicio, no de alérgenos.'),
   (v_q, 'El paso involuntario de un alérgeno de un alimento a otro a través de manos, utensilios o fuego.', true, 'Correcto. Es la vía de riesgo más frecuente en cocina.'),
   (v_q, 'Mezclar vino blanco con vino tinto en la misma copa.', false, 'No guarda relación con la seguridad alimentaria por alérgenos.'),
   (v_q, 'La descomposición natural de los alimentos frescos.', false, 'Eso es deterioro microbiológico, no contaminación cruzada.');

  raise notice 'Curso de alérgenos sembrado. Curso id: %', v_course_id;
end
$seed$;

-- ── VERIFICACIÓN (ejecutar POR SEPARADO, en otra pestaña/Run) ────────────────
-- select c.code, c.title, c.status,
--        (select count(*) from course_section s where s.course_id = c.id) as secciones,
--        (select count(*) from course_question q where q.course_id = c.id) as preguntas,
--        (select count(*) from course_option o
--           join course_question q2 on q2.id = o.question_id
--          where q2.course_id = c.id and o.is_correct) as respuestas_correctas
--   from course c where c.code = 'alergenos_intolerancias' and c.account_id is null;
-- Esperado: 5 secciones · 10 preguntas · 10 respuestas correctas (una por pregunta).
