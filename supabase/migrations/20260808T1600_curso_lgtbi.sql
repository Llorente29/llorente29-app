-- ============================================================================
-- Folvy · CURSO "Igualdad y no discriminación de las personas LGTBI"
-- Molde didáctico de docs/folvy_formacion_guia_contenido.md · OLEADA 2
-- ----------------------------------------------------------------------------
-- MARCO LEGAL (verificado):
--   · Ley 4/2023, art. 15.1 — obligación de medidas planificadas y protocolo
--     de acoso LGTBI para empresas de MÁS DE 50 personas trabajadoras.
--   · RD 1026/2024 (vigente desde 10/10/2024) — desarrolla el contenido:
--     planes negociados, protocolo de acoso/violencia y FORMACIÓN. Los planes
--     de formación deben incluir módulos específicos sobre derechos LGTBI en
--     el ámbito laboral, dirigidos a TODA la plantilla, incluidos mandos
--     intermedios, dirección y responsables de personal/RRHH. No fija horas:
--     fija contenido mínimo (Anexo I).
--
-- ⚠️ ALCANCE — MATIZ IMPORTANTE (no confundir con el curso de acoso sexual):
--   · El PLAN LGTBI obliga a empresas de +50 personas. Por debajo es voluntario.
--   · PERO la protección frente a la discriminación por orientación sexual,
--     identidad de género, expresión de género y características sexuales se
--     aplica a TODA empresa, sea cual sea su tamaño.
--   → Por eso is_mandatory = false (depende del tamaño del cliente) pero el
--     contenido es plenamente aplicable a cualquiera. Un grupo de 150 locales
--     SÍ está obligado.
--
-- ⚠️⚠️ REVISIÓN REFORZADA — status 'draft'. Contenido legal-laboral sensible:
--    revisión de Julio y, preferiblemente, de un asesor laboral. Las medidas
--    deben NEGOCIARSE con la representación legal de las personas trabajadoras;
--    el curso remite al protocolo propio de cada empresa, NO lo sustituye.
--
-- Correctas del test: c b d a c b a d b c (verificado)
-- DEPENDE DE: 20260806T1500_formacion_c1.sql · IDEMPOTENTE · Aplicada:
-- ============================================================================

do $guard$
begin
  if to_regclass('public.course') is null or to_regclass('public.course_section') is null
     or to_regclass('public.course_question') is null or to_regclass('public.course_option') is null then
    raise exception 'Faltan tablas de Formación C1.';
  end if;
end
$guard$;

do $seed$
declare
  v_course_id uuid;
  v_q uuid;
begin
  insert into public.course (
    account_id, code, title, summary, legal_basis, delivery_mode,
    reeval_months, is_mandatory, appcc_prerequisite, estimated_minutes,
    pass_threshold_pct, version, status
  ) values (
    null, 'lgtbi_no_discriminacion',
    'Igualdad y no discriminación de las personas LGTBI',
    'Qué derechos tienen tus compañeros y compañeras LGTBI en el trabajo, qué es discriminación aunque no lo parezca, y cómo se actúa. Obligatorio en empresas de más de 50 personas.',
    'Ley 4/2023, art. 15.1 · RD 1026/2024',
    'folvy_imparte', 24, false, false, 20, 70, 1, 'draft'
  )
  on conflict (code) where account_id is null
  do update set title = excluded.title, summary = excluded.summary,
    legal_basis = excluded.legal_basis, reeval_months = excluded.reeval_months,
    estimated_minutes = excluded.estimated_minutes
  returning id into v_course_id;

  if v_course_id is null then
    select id into v_course_id from public.course
     where code = 'lgtbi_no_discriminacion' and account_id is null;
  end if;

  delete from public.course_option
   where question_id in (select id from public.course_question where course_id = v_course_id);
  delete from public.course_question where course_id = v_course_id;
  delete from public.course_section  where course_id = v_course_id;

  -- ═══ TEORÍA ═══════════════════════════════════════════════════════════════

  insert into public.course_section (course_id, ord, title, body) values

  (v_course_id, 1, 'De qué va esto exactamente',
$md$Este curso no va de ideología ni de opinar sobre nada. Va de una cosa muy concreta: **que nadie lo pase mal en el trabajo por quién es o a quién quiere**.

Desde 2023 la ley obliga a las empresas de más de 50 personas a tener medidas y un protocolo específico para esto, y a **formar a toda la plantilla**: cocina, sala, mandos intermedios y dirección. Por debajo de 50 el plan es voluntario, pero ojo: **la protección frente a la discriminación se aplica a cualquier empresa**, tenga el tamaño que tenga.

Cuatro palabras que conviene distinguir bien, porque se mezclan constantemente:

- **Orientación sexual** — de quién te enamoras o te atrae.
- **Identidad de género** — cómo se siente cada persona: hombre, mujer, u otra identidad. Es independiente de la orientación.
- **Expresión de género** — cómo se viste, se mueve o se presenta cada uno.
- **Características sexuales** — rasgos biológicos, que en algunas personas (intersexuales) no encajan en las categorías habituales.

Que alguien sea trans no dice nada de su orientación sexual. Y que un hombre tenga gestos que a alguien le parezcan "poco masculinos" no dice nada de nada.

**En tu equipo esto pasa así:** la hostelería tiene mucha gente joven y mucha rotación, y suele ser un sector bastante abierto. Aun así, hay una diferencia enorme entre "aquí nadie tiene problema con eso" y que una persona trans se sienta cómoda diciendo cómo quiere que la llamen. Lo primero es fácil; lo segundo hay que construirlo.

> **Marco legal** — Ley 4/2023, art. 15.1: obligación de medidas planificadas y protocolo frente al acoso o violencia contra personas LGTBI en empresas de más de 50 personas trabajadoras. RD 1026/2024: desarrolla el contenido y exige módulos formativos específicos dirigidos a toda la plantilla, incluidos mandos y dirección.$md$),

  (v_course_id, 2, 'La discriminación que no parece discriminación',
$md$Casi nadie en una cocina va a decir "no te doy el puesto por ser gay". Lo que ocurre es más sutil, y por eso cuesta más pararlo.

**La broma continua.** El chiste sobre la pluma de un compañero, el mote, el comentario cada vez que pasa. Cada uno por separado parece poca cosa; repetido cada día es hostigamiento.

**El "yo no tengo problema, pero…"** — "pero que no lo vaya diciendo", "pero que no se ponga eso para atender mesas", "pero mejor que no lo sepan los clientes". Eso es pedirle a alguien que se esconda para que a otros no les incomode.

**El trato distinto disfrazado de organización.** Cambiar a alguien de turno o quitarlo de sala "porque los clientes son mayores y se pueden extrañar". Es discriminación aunque se explique con la mejor educación.

**El deadnaming y el género equivocado.** Llamar a una persona trans por su nombre anterior o referirse a ella en el género que no es. Una vez sin querer se corrige y ya está. Hacerlo a propósito y repetido es acoso.

**Lo que sí es un derecho concreto:** que se use el **nombre y el género con el que la persona se identifica** en el trato diario, aunque su DNI aún no esté cambiado. En nóminas y documentos oficiales hará falta el trámite legal, pero para llamarte por tu nombre no hace falta ningún papel.

**En tu equipo esto pasa así:** la frase más peligrosa es *"aquí somos así, es humor negro y nos lo decimos todos"*. Puede ser verdad para nueve personas y falso para la décima, que sonríe porque acaba de entrar. El humor compartido se nota en que **nadie se queda fuera**.

> **Datos técnicos** — Ley 4/2023: prohíbe la discriminación por orientación sexual, identidad de género, expresión de género y características sexuales en el acceso al empleo, la promoción, las condiciones de trabajo y la formación. El derecho al trato conforme a la identidad manifestada no exige rectificación registral previa.$md$),

  (v_course_id, 3, 'Lo que la empresa tiene que garantizar',
$md$El RD 1026/2024 no se queda en buenas intenciones: fija áreas concretas donde la empresa tiene que actuar.

- **Selección** — Procesos con criterios objetivos. Nada de preguntar por la vida privada en una entrevista.
- **Clasificación y promoción** — Los ascensos, por criterios objetivos. Nadie se queda sin ser jefe de partida por esto.
- **Formación** — Módulos específicos para **toda la plantilla**, incluidos mandos y dirección. Este curso es esa medida.
- **Entornos laborales diversos** — Vestuarios, aseos y uniformes accesibles y respetuosos con la identidad de cada persona.
- **Permisos y beneficios sociales** — Las parejas del mismo sexo tienen exactamente los mismos derechos: matrimonio, permisos, excedencias, seguros.
- **Protocolo frente al acoso LGTBI** — Con canal, plazos y garantías, igual que el de acoso sexual.

**Un caso muy de hostelería, el uniforme:** cuando el uniforme está partido en "de chico" y "de chica", se convierte en un problema para quien no encaja en esa división. La solución no es complicada: que cada persona use el que corresponde a su identidad, o que el uniforme deje de estar sexuado.

**En tu equipo esto pasa así:** el conflicto típico no es una agresión, es una duda práctica que nadie sabe resolver: qué vestuario usa una compañera trans, qué nombre va en el cuadrante, cómo se la presenta a un cliente. Si nadie lo aclara, cada uno improvisa y alguien acaba incómodo. **Preguntar a la persona cómo prefiere que se haga es casi siempre la mejor respuesta.**

> **Datos técnicos** — RD 1026/2024, Anexos I y II: contenidos mínimos de las medidas planificadas — cláusulas de igualdad de trato, criterios objetivos en clasificación y promoción, formación y sensibilización, entornos laborales diversos y protocolo de acoso. Las medidas deben negociarse con la representación legal de las personas trabajadoras.$md$),

  (v_course_id, 4, 'Privacidad: lo que no se cuenta',
$md$Hay una regla sencilla y muy importante que se salta con frecuencia sin mala intención.

**Nadie está obligado a contar su orientación ni su identidad.** Y si te lo cuenta a ti, **no te está autorizando a contárselo a nadie más**. Decirlo por tu cuenta —a compañeros, a un cliente, en el grupo del equipo— se llama *outing*, y puede hacer mucho daño: a veces la persona no se lo ha contado a su familia, o viene de un entorno donde tendría consecuencias.

Tampoco se pregunta. Ni por curiosidad, ni "por interés". Preguntas sobre el cuerpo de una persona trans, sobre operaciones o tratamientos, no se hacen: son datos de salud, íntimos, y ni siquiera la empresa tiene derecho a conocerlos.

Los datos sobre orientación sexual y salud son **categorías especiales protegidas por el RGPD**: tienen un nivel de protección reforzado.

**En tu equipo esto pasa así:** el *outing* casi nunca es malicioso. Suele ser un comentario suelto, "ah, pues su novia trabaja en el bar de al lado", dicho sin pensar delante de gente que no lo sabía. Por eso la regla es tan simple: **lo que te cuenten en confianza, se queda contigo**.

> **Datos técnicos** — RGPD, art. 9: los datos relativos a la vida sexual, la orientación sexual y la salud son categorías especiales de datos, con protección reforzada. Ley 4/2023: garantía del derecho a la intimidad y prohibición de revelar información sobre la identidad o la orientación sin consentimiento.$md$),

  (v_course_id, 5, 'Qué hacer si lo ves o te pasa',
$md$El esquema es el mismo que en el protocolo de acoso, y funciona por las mismas razones.

**Si eres tú quien lo sufre:** anótalo con fechas y testigos, guarda los mensajes, y comunícalo por el canal del protocolo de tu empresa. Si no te sientes seguro dentro, hay vías fuera: Inspección de Trabajo, los servicios de atención LGTBI de tu comunidad autónoma, o la vía judicial. **Las represalias por denunciar están prohibidas.**

**Si lo ves en otro** —y esta es la parte que de verdad cambia el ambiente—:
- **No le rías la gracia.** Igual que en el otro curso: sin público, la broma se cae.
- **Córtalo sin montar un escándalo.** Un "va, déjalo" en el momento vale más que un discurso.
- **Pregúntale después en privado** si está bien.
- **Avísalo** si se repite, aunque la persona aún no se atreva.

**Y si metes la pata**, que pasa: llamar a alguien por el nombre antiguo, usar el género equivocado. **Corrige y sigue.** No hace falta una disculpa larga ni un drama; eso solo hace que la persona tenga que consolarte a ti. Un "perdón, quería decir ella" y adelante.

**En tu equipo esto pasa así:** el miedo más común es *"no sé cómo hablar de esto, prefiero no meterme por si digo algo mal"*. Ese silencio deja sola a la persona. Se agradece mucho más a alguien que se equivoca de palabra y lo intenta que a alguien que se aparta para no complicarse.

> **Datos técnicos** — Los protocolos LGTBI deben garantizar confidencialidad, investigación imparcial, plazos definidos y protección frente a represalias, con el mismo estándar que los protocolos de acoso sexual y por razón de sexo.$md$),

  (v_course_id, 6, 'Por qué le conviene también al negocio',
$md$Más allá de la ley, hay razones prácticas que en hostelería se notan rápido.

**La rotación cuesta dinero.** Formar a alguien nuevo cuesta semanas. La gente que se siente respetada se queda; la que aguanta comentarios cada día, se va a la primera oferta. Y en este sector la plantilla se pierde por el ambiente mucho más que por el sueldo.

**El equipo funciona mejor cuando nadie está gastando energía en esconderse.** Alguien que teme que se enteren de algo no está al cien por cien en el pase.

**Y hay riesgo real.** Las sanciones por discriminación son serias, la Inspección de Trabajo puede pedir prueba de que la formación se impartió, y un caso mal gestionado se convierte en un problema de reputación en cuestión de horas.

**Antes de terminar**, dos cosas prácticas:
- Pregunta a tu responsable si tu empresa tiene **protocolo LGTBI** y quién es la persona de contacto.
- Y si en tu equipo hay alguien nuevo, la forma más fácil de hacerlo bien es la más simple: **preguntarle cómo quiere que le llamen y llamarle así.**

> **Datos técnicos** — La formación debe llegar a toda la plantilla, incluidos mandos intermedios y dirección, y la empresa debe poder acreditar su cumplimiento ante la Inspección de Trabajo si lo requiere. El RD 1026/2024 no fija un número de horas: fija el contenido mínimo que debe cubrirse.$md$);

  -- ═══ TEST SITUACIONAL ═════════════════════════════════════════════════════
  -- Correctas: c b d a c b a d b c

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 1, 'Un compañero te cuenta en confianza que es gay. Al día siguiente sale el tema en el vestuario. ¿Qué haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Lo comento con naturalidad: no hay nada de malo en ello.', false, 'Aunque no haya nada malo, no es información tuya para compartir.'),
   (v_q, 'Lo cuento solo a los del turno, que son de confianza.', false, 'Sigue siendo outing: él decide a quién y cuándo.'),
   (v_q, 'No digo nada: lo que me contó en confianza se queda conmigo. Es él quien decide a quién contárselo.', true, 'Correcto. Contarlo por tu cuenta es outing y puede tener consecuencias graves para él.'),
   (v_q, 'Le pregunto delante de todos si le importa que se sepa.', false, 'Preguntarlo en público ya lo expone: el daño está hecho.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 2, 'Una compañera trans pide que la llamen por su nombre, aunque su DNI aún no está cambiado. ¿Qué corresponde?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Usar el nombre del DNI hasta que haga el cambio legal.', false, 'Para el trato diario no hace falta ningún papel.'),
   (v_q, 'Usar en el trato diario el nombre y el género con los que se identifica.', true, 'Correcto. El trato conforme a la identidad manifestada no exige rectificación registral.'),
   (v_q, 'Decidirlo el encargado según lo que le parezca menos lío.', false, 'No es una preferencia organizativa: es un derecho de la persona.'),
   (v_q, 'Preguntar al resto del equipo qué prefieren.', false, 'La identidad de una persona no se somete a votación.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 3, 'El encargado quita de sala a un camarero gay "por si algún cliente mayor se extraña", y lo pasa a cocina. ¿Qué es esto?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Una decisión organizativa legítima del encargado.', false, 'La facultad organizativa no ampara decidir por orientación sexual.'),
   (v_q, 'Correcto si al trabajador no le importa el cambio.', false, 'El motivo sigue siendo ilícito aunque no proteste.'),
   (v_q, 'Aceptable si es temporal.', false, 'La duración no cambia la naturaleza discriminatoria.'),
   (v_q, 'Discriminación: se le cambian las condiciones por su orientación sexual, por muy educadamente que se explique.', true, 'Correcto. Es discriminación en las condiciones de trabajo, prohibida por la Ley 4/2023.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 4, 'Te equivocas y llamas a una compañera trans por su nombre anterior. ¿Cómo lo gestionas?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Corrijo en el momento, sigo hablando con normalidad y procuro no repetirlo.', true, 'Correcto. Un "perdón, quería decir ella" y adelante. Sin drama.'),
   (v_q, 'Me disculpo largamente y le explico que me cuesta acostumbrarme.', false, 'Convierte su situación en tu problema y la obliga a consolarte.'),
   (v_q, 'No digo nada para no hacerlo más incómodo.', false, 'Corregir en el momento es justo lo que normaliza el trato correcto.'),
   (v_q, 'Le pido que no se lo tome a mal porque "es difícil".', false, 'Trasladar la carga a la persona afectada no ayuda.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 5, 'En el equipo hay bromas continuas sobre la forma de hablar de un compañero. Él sonríe pero nunca se ríe.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Si sonríe, es que le hace gracia.', false, 'Sonreír es la forma más habitual de sobrellevar algo incómodo en grupo.'),
   (v_q, 'Es humor de cocina, forma parte del ambiente.', false, '"Aquí somos así" es exactamente la frase que sostiene el hostigamiento.'),
   (v_q, 'Repetido en el tiempo es hostigamiento: dejo de reírme, lo corto y hablo con él en privado.', true, 'Correcto. Cada broma parece poca cosa; el patrón repetido es lo que hace daño.'),
   (v_q, 'Le digo a él que responda con otra broma para quedar por encima.', false, 'Le traslada la responsabilidad de resolver algo que no ha provocado.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 6, 'Un compañero pregunta a una persona trans por sus operaciones o tratamientos, "por curiosidad sana". ¿Es adecuado?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Sí, si se pregunta con respeto y en privado.', false, 'El tono no cambia que sea información médica íntima.'),
   (v_q, 'No: son datos de salud, categoría especialmente protegida. No se preguntan.', true, 'Correcto. Ni la empresa ni los compañeros tienen derecho a esa información.'),
   (v_q, 'Sí, forma parte de conocerse en el equipo.', false, 'Conocerse no incluye el historial médico de nadie.'),
   (v_q, 'Solo si ya hay confianza.', false, 'La confianza no convierte un dato de salud en información compartible.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 7, '¿A qué empresas obliga el plan de medidas LGTBI del RD 1026/2024?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'A las de más de 50 personas trabajadoras; por debajo es voluntario, aunque la protección frente a la discriminación aplica a todas.', true, 'Correcto. Ojo: el protocolo de acoso sexual sí obliga a todas, sea cual sea el tamaño.'),
   (v_q, 'A todas las empresas sin excepción.', false, 'Se confunde con el protocolo de acoso sexual, que sí obliga a todas.'),
   (v_q, 'Solo a las empresas públicas.', false, 'Aplica al sector privado con ese umbral de plantilla.'),
   (v_q, 'Solo a las que tengan personas LGTBI en plantilla.', false, 'Es una obligación preventiva: no depende de quién trabaje allí.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 8, 'El uniforme está dividido en "de chico" y "de chica" y una persona no binaria no sabe cuál usar. ¿Cómo se resuelve?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Que use el que corresponda a su sexo registral.', false, 'Ignora la identidad de la persona y es fuente de conflicto.'),
   (v_q, 'Que decida el encargado por uniformidad de imagen.', false, 'La imagen de marca no justifica imponer una categoría a alguien.'),
   (v_q, 'Que no use uniforme.', false, 'Excluirla del uniforme la señala aún más.'),
   (v_q, 'Preguntándole cómo prefiere y facilitando que el uniforme deje de estar sexuado.', true, 'Correcto. Entornos laborales diversos es una de las áreas del RD 1026/2024.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 9, 'La pareja del mismo sexo de un trabajador está enferma y él pide el permiso correspondiente. ¿Qué corresponde?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Depende de si están casados o solo son pareja.', false, 'El criterio de matrimonio o pareja de hecho es el mismo que para cualquier otro trabajador.'),
   (v_q, 'Exactamente el mismo permiso que a cualquier otro trabajador en la misma situación.', true, 'Correcto. Mismos derechos en permisos, excedencias y beneficios sociales.'),
   (v_q, 'Hay que consultarlo con dirección por ser un caso especial.', false, 'No es un caso especial: tratarlo como tal ya es discriminación.'),
   (v_q, 'Solo si lo recoge expresamente el convenio.', false, 'La igualdad de trato no necesita mención expresa para aplicarse.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 10, '¿A quién debe llegar la formación en materia LGTBI según el RD 1026/2024?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Solo a RRHH, que es quien gestiona estos temas.', false, 'La formación es para toda la plantilla, no solo para quien la gestiona.'),
   (v_q, 'Solo a quienes traten con clientes.', false, 'No se limita a puestos de cara al público.'),
   (v_q, 'A toda la plantilla, incluidos mandos intermedios, dirección y responsables de personal.', true, 'Correcto. Y la empresa debe poder acreditarlo ante la Inspección de Trabajo.'),
   (v_q, 'A quien lo solicite voluntariamente.', false, 'No es voluntaria en las empresas obligadas.');

  raise notice 'Curso LGTBI sembrado (draft, revisión reforzada). id: %', v_course_id;
end
$seed$;

-- ── VERIFICACIÓN (POR SEPARADO) ────────────────────────────────────────────
-- select c.code, c.status, c.is_mandatory,
--   (select count(*) from course_section  s where s.course_id=c.id) as secciones,
--   (select count(*) from course_question q where q.course_id=c.id) as preguntas,
--   (select count(*) from course_option o join course_question q2 on q2.id=o.question_id
--     where q2.course_id=c.id and o.is_correct) as correctas
-- from course c where c.code='lgtbi_no_discriminacion' and c.account_id is null;
-- Esperado: draft · false · 6 secciones · 10 preguntas · 10 correctas.
