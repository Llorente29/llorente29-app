-- ============================================================================
-- Folvy · CURSO "Igualdad y prevención del acoso en el trabajo"
-- Molde didáctico de docs/folvy_formacion_guia_contenido.md · OLEADA 2
-- ----------------------------------------------------------------------------
-- MARCO LEGAL (verificado):
--   · LO 3/2007 de igualdad efectiva (arts. 46 y 48)
--   · RD 901/2020, art. 2.1 — TODAS las empresas, con independencia del número
--     de personas en plantilla, deben promover condiciones que eviten el acoso
--     sexual y por razón de sexo y arbitrar procedimientos de prevención y cauce
--     de denuncias. NO es solo para empresas de 50+.
--   · LO 10/2022 (garantía integral de la libertad sexual), art. 12 — deberes de
--     prevención y sensibilización en el ámbito laboral, incluido el ámbito digital.
--   · RD 1026/2024 — refuerza los protocolos con medidas específicas LGTBI.
--   · Criterio Técnico 69/2009 de la Inspección de Trabajo.
--
-- CONTENIDO MÍNIMO EXIGIDO a la formación (fuente: análisis de obligación
-- formativa): marco normativo · tipos de acoso (sexual, por razón de sexo,
-- moral/mobbing, digital) · protocolo de actuación y canales · derechos y
-- obligaciones · sensibilización. Todo ello está cubierto en las 6 secciones.
--
-- SANCIONES: la Inspección de Trabajo puede exigir prueba de que la formación
-- se impartió; multas de 7.501 € a 225.018 € según gravedad. De ahí el valor
-- del acta firmada de Folvy.
--
-- ⚠️⚠️ REVISIÓN REFORZADA — status 'draft'.
--    Contenido legal-laboral sensible. Debe revisarlo Julio Y preferiblemente
--    un asesor laboral antes de publicarse. Además, el RD 901/2020 exige que
--    las medidas preventivas (incluida la formación) se NEGOCIEN con la
--    representación legal de las personas trabajadoras: cada empresa cliente
--    debe validar que este curso encaja con SU protocolo y su plan de igualdad.
--    ⚠️ El curso remite al protocolo propio de cada empresa; NO lo sustituye.
--
-- Correctas del test: b c a d b a c b d c (verificado)
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
    null, 'igualdad_acoso',
    'Igualdad y prevención del acoso en el trabajo',
    'Qué es y qué no es acoso, cómo se actúa cuando ocurre, y qué puedes hacer tú si te pasa a ti o lo ves en un compañero. Obligatorio en toda empresa, sea del tamaño que sea.',
    'LO 3/2007 · RD 901/2020 · LO 10/2022 · RD 1026/2024',
    'folvy_imparte', 24, true, false, 25, 70, 1, 'draft'
  )
  on conflict (code) where account_id is null
  do update set title = excluded.title, summary = excluded.summary,
    legal_basis = excluded.legal_basis, reeval_months = excluded.reeval_months,
    estimated_minutes = excluded.estimated_minutes
  returning id into v_course_id;

  if v_course_id is null then
    select id into v_course_id from public.course
     where code = 'igualdad_acoso' and account_id is null;
  end if;

  delete from public.course_option
   where question_id in (select id from public.course_question where course_id = v_course_id);
  delete from public.course_question where course_id = v_course_id;
  delete from public.course_section  where course_id = v_course_id;

  -- ═══ TEORÍA ═══════════════════════════════════════════════════════════════

  insert into public.course_section (course_id, ord, title, body) values

  (v_course_id, 1, 'Esto no va de política, va de tu turno',
$md$La hostelería tiene condiciones que hacen esto especialmente importante: equipos jóvenes, mucha rotación, jerarquías fuertes en cocina, turnos de noche, alcohol de por medio y trato constante con clientes. No es que aquí haya peor gente: es que hay **más ocasiones**.

Y algo que sorprende a mucha gente: **la ley obliga a TODAS las empresas**, tengan 3 trabajadores o 300, a tener un protocolo contra el acoso y a formar a su plantilla. No es cosa solo de grandes cadenas.

Este curso no va de "lo que se puede decir y lo que no". Va de tres cosas concretas:
- **Reconocer** una situación de acoso, sobre todo cuando le pasa a otro y no se atreve a decirlo.
- **Saber qué hacer**, tanto si te pasa a ti como si lo ves.
- **Entender qué va a hacer la empresa** cuando alguien lo cuenta.

**En tu equipo esto pasa así:** casi nadie denuncia la primera vez. Lo normal es aguantar, quitarle importancia ("es su forma de ser"), o cambiar de turno para no coincidir. Cuando alguien por fin habla, muchas veces lleva meses pasándolo mal. Por eso importa que todo el mundo sepa que hay una vía y que se usa.

> **Marco legal** — RD 901/2020, art. 2.1: todas las empresas, con independencia del número de personas en plantilla, deben promover condiciones de trabajo que eviten el acoso sexual y el acoso por razón de sexo, y arbitrar procedimientos específicos para su prevención y para dar cauce a las denuncias. LO 10/2022, art. 12: deberes de prevención y sensibilización, incluido el ámbito digital.$md$),

  (v_course_id, 2, 'Los cuatro tipos que tienes que distinguir',
$md$**Acoso sexual** — Cualquier comportamiento de naturaleza sexual, verbal o físico, que atenta contra la dignidad de una persona, especialmente si crea un ambiente intimidatorio, degradante u ofensivo. Comentarios sobre el cuerpo, insistir en salir después de una negativa, tocamientos "de broma", enviar contenido sexual.

**Acoso por razón de sexo** — No tiene contenido sexual: es tratar peor a alguien **por ser mujer o por ser hombre**. Dar siempre los peores turnos a las mujeres, cuestionar a alguien por estar embarazada, o menospreciar a un hombre por pedir permiso de paternidad.

**Acoso moral (mobbing)** — Hostigamiento repetido en el tiempo para hundir a alguien: humillaciones delante del equipo, aislamiento, cargarle siempre lo peor, gritos sistemáticos. No es un mal día del jefe: es un patrón.

**Acoso digital** — El mismo comportamiento, por WhatsApp, redes o el grupo del equipo. **Cuenta igual**, aunque sea fuera del horario y del local. La ley lo dice expresamente.

Y ahora lo que más cuesta entender: **lo que decide si algo es acoso no es tu intención, es el efecto en la otra persona.** "Yo lo decía de broma" no cambia lo que la otra persona ha sentido. Si alguien dice que le molesta y sigue pasando, ahí ya no hay broma que valga.

**En tu equipo esto pasa así:** el comentario sobre el físico de la camarera nueva que hace reír a la cocina. Nadie lo vive como acoso porque "es el rollo de aquí". Ella no dice nada porque acaba de entrar y no quiere ser la rara. Así empieza casi siempre: normalizado y con público.

> **Datos técnicos** — LO 3/2007, art. 7: definiciones legales de acoso sexual y acoso por razón de sexo. Ambos se consideran discriminación y son infracción muy grave en el orden social. LO 10/2022: incluye expresamente las conductas cometidas en el ámbito digital.$md$),

  (v_course_id, 3, 'Los clientes también, y ahí la empresa te respalda',
$md$En hostelería hay una situación específica que conviene decir claramente: **el acoso de un cliente hacia un trabajador también es acoso, y la empresa está obligada a protegerte.**

El comentario al servir la mesa, la mano en la cintura al pasar, la insistencia en pedir el teléfono, la "propina" a cambio de algo. Es frecuente, se ha normalizado durante décadas con el "el cliente siempre tiene razón", y no es parte del trabajo de nadie.

**El cliente tiene razón sobre el pedido. No sobre tu cuerpo.**

Lo que debe pasar cuando ocurre:
- **No tienes que aguantarlo** ni resolverlo tú solo.
- **Avisa a tu responsable en el momento.** No es "ser flojo": es el procedimiento.
- La empresa puede cambiar la atención de esa mesa, llamar la atención al cliente o pedirle que se marche.
- Y queda registrado, igual que cualquier otro incidente.

**En tu equipo esto pasa así:** viernes noche, mesa que ha bebido, comentarios subiendo de tono con una compañera. La reacción habitual del equipo es reírse un poco, apretar los dientes y terminar el servicio. La reacción correcta es que otra persona atienda esa mesa y que el responsable lo sepa **esa misma noche**, no al día siguiente.

> **Datos técnicos** — LO 10/2022, art. 12: obligación empresarial de promover condiciones de trabajo que eviten conductas contra la libertad sexual, incluidas las procedentes de terceros. La evaluación de riesgos laborales debe contemplar la violencia sexual entre los riesgos concurrentes, con obligación de formar e informar.$md$),

  (v_course_id, 4, 'Qué hacer si te pasa a ti',
$md$No hay una única forma correcta, y **nada de lo que hagas o dejes de hacer justifica lo que te están haciendo**. Pero estas cosas ayudan:

**Dilo claro, si te ves capaz.** A veces basta un "esto no me hace gracia, para". No siempre es posible —sobre todo si quien lo hace es tu superior— y no estás obligada a hacerlo.

**Apúntalo.** Fechas, qué pasó, qué se dijo, quién estaba delante. Guarda mensajes y capturas. Suena frío, pero es lo que después sostiene lo que cuentas.

**Cuéntaselo a alguien.** Tu responsable, RRHH, la persona de contacto del protocolo, o la representación de los trabajadores. Y si dentro no te sientes segura: Inspección de Trabajo, el **016** (atención a la violencia contra la mujer, gratuito y no deja rastro en la factura) o la vía judicial.

**No tienes que aguantar hasta estar "segura de que es grave".** El protocolo existe también para lo que empieza pequeño.

**Y esto es importante que lo sepas:** **tomar represalias contra quien denuncia está prohibido.** Cambiarte de turno como castigo, apartarte, dejar de darte horas o despedirte por haber denunciado es ilegal, y una empresa que lo hace se mete en un problema mucho mayor que el inicial.

**En tu equipo esto pasa así:** lo que más frena a la gente no es el miedo al acosador, es el miedo a **quedarse sin trabajo o a que el equipo se ponga en su contra**. Por eso la confidencialidad del protocolo no es un formalismo: es lo que hace posible que alguien hable.

> **Datos técnicos** — Los protocolos deben garantizar confidencialidad, imparcialidad en la investigación, plazos definidos y protección frente a represalias. LO 3/2007, art. 9: prohibición de trato adverso como reacción ante una denuncia o procedimiento por incumplimiento del principio de igualdad.$md$),

  (v_course_id, 5, 'Qué hacer si lo ves (y por qué importa tanto)',
$md$Aquí está la parte que más cambia las cosas y de la que menos se habla. **La mayoría de casos los para un compañero, no la víctima.**

Quien lo sufre suele estar bloqueado: duda de sí mismo, teme el conflicto, piensa que exagera. Quien lo ve desde fuera tiene la cabeza mucho más clara.

**Lo que puedes hacer, de menos a más:**
- **No reírle la gracia.** El silencio del grupo desactiva a quien busca público. Muchos comportamientos se sostienen solo porque generan risas.
- **Interrumpir sin montar un número.** "Oye, déjalo ya." O simplemente meterte en medio y cambiar de tema.
- **Preguntarle después en privado.** "¿Estás bien? He visto lo de antes." Muchas veces esa frase es la primera vez que alguien nombra lo que está pasando.
- **Avisar al responsable.** Aunque la persona afectada aún no se atreva.

**Lo que NO ayuda:** contarlo por el grupo del equipo, señalar a la persona en público sin su permiso, o presionarla para que denuncie antes de estar preparada.

**En tu equipo esto pasa así:** las bromas suben de tono progresivamente, sin que haya un momento claro donde alguien diga "esto ya pasó de la raya". Cada uno piensa que si a nadie le parece mal, será que es normal. **Basta con que una persona no se ría para que el ambiente cambie.** Esa persona puedes ser tú.

> **Datos técnicos** — Los protocolos contemplan que la comunicación pueda realizarla la persona afectada o una tercera persona conocedora de los hechos. La sensibilización de toda la plantilla es una medida preventiva exigida por el RD 901/2020 y la LO 10/2022.$md$),

  (v_course_id, 6, 'Qué hace la empresa cuando alguien lo cuenta',
$md$Saber qué va a pasar quita mucho miedo. El protocolo de tu empresa detalla los plazos y las personas concretas, pero el esquema es siempre este:

1. **Se recoge la comunicación** por el canal previsto. Puede hacerla la persona afectada o alguien que lo ha presenciado.
2. **Confidencialidad desde el minuto uno.** Solo lo conocen quienes tienen que instruirlo.
3. **Medidas cautelares si hacen falta**: separar a las dos personas mientras se investiga. Y ojo — **la medida no puede perjudicar a quien denuncia**: no se cambia de turno ni de local a la víctima como "solución".
4. **Investigación imparcial y con plazos.** Se escucha a ambas partes y a los testigos.
5. **Conclusión y consecuencias.** Si se confirma, hay medidas disciplinarias proporcionales a la gravedad, que pueden llegar al despido.
6. **Seguimiento**, para comprobar que no hay represalias ni se repite.

**Presunción de inocencia también cuenta**: se investiga en serio, no se condena por rumores. Precisamente por eso el procedimiento es formal y no un juicio de pasillo.

**En tu equipo esto pasa así:** el mayor enemigo de un buen protocolo es que **nadie sepa que existe**. Un documento firmado por el jefe en un cajón no cumple la ley: la ley exige que se comunique a la plantilla, que se forme y que el canal sea accesible. Esa parte se cumple hoy, contigo, aquí.

**Antes de terminar**: pregunta a tu responsable **quién es la persona de contacto del protocolo en tu empresa y cómo se le comunica algo**. Si no lo sabes, este curso no habrá servido del todo.

> **Datos técnicos** — Contenido mínimo del protocolo: declaración de tolerancia cero, definiciones, medidas preventivas y de sensibilización, canal confidencial y accesible, procedimiento con plazos y garantías, y régimen disciplinario. Para su validez debe implantarse de forma efectiva: comunicarse a toda la plantilla y formarse en él. La Inspección de Trabajo puede exigir prueba de que la formación se ha impartido; las sanciones oscilan entre 7.501 € y 225.018 € según la gravedad.$md$);

  -- ═══ TEST SITUACIONAL ═════════════════════════════════════════════════════
  -- Correctas: b c a d b a c b d c

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 1, 'Un compañero hace comentarios sobre el cuerpo de la camarera nueva y la cocina se ríe. Ella no dice nada. ¿Qué es lo más útil que puedes hacer?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Nada: si a ella no le molestara, ya lo habría dicho.', false, 'Callar es lo más normal cuando acabas de entrar. El silencio no es consentimiento.'),
   (v_q, 'No reírle la gracia, cortarlo con un "déjalo ya" y preguntarle a ella después en privado si está bien.', true, 'Correcto. La mayoría de casos los para un compañero, no la víctima. Sin público, el comportamiento se cae.'),
   (v_q, 'Contarlo en el grupo de WhatsApp del equipo para que todos opinen.', false, 'Exponerla en público sin su permiso la perjudica y rompe la confidencialidad.'),
   (v_q, 'Decirle a ella que denuncie ya mismo o no la podré ayudar.', false, 'Presionar a alguien que no está preparado suele conseguir que se cierre.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 2, 'Un cliente habitual toca la cintura de una compañera cada vez que pasa. Ella pone mala cara pero sigue trabajando.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Es parte del trabajo de cara al público, hay que saber llevarlo.', false, 'No lo es. Ningún puesto incluye aguantar tocamientos.'),
   (v_q, 'Como es cliente y no compañero, la empresa no puede hacer nada.', false, 'La ley obliga a la empresa a proteger frente a conductas de terceros.'),
   (v_q, 'Es acoso: hay que avisar al responsable esa misma noche para que actúe con el cliente y con la atención de esa mesa.', true, 'Correcto. El cliente tiene razón sobre el pedido, no sobre el cuerpo de nadie.'),
   (v_q, 'Hay que esperar a que ella se queje formalmente por escrito.', false, 'Cualquiera que lo presencie puede comunicarlo, y la actuación es inmediata.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 3, 'Alguien dice: "yo lo decía de broma, no era mi intención molestar". ¿Eso cambia si hay acoso o no?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'No: lo que determina si hay acoso es el efecto sobre la persona, no la intención de quien lo hace.', true, 'Correcto. Y si ya se ha pedido que pare y continúa, la intención pierde todo valor.'),
   (v_q, 'Sí: sin intención de hacer daño no puede haber acoso.', false, 'La norma atiende al efecto: ambiente intimidatorio, degradante u ofensivo.'),
   (v_q, 'Sí, siempre que se disculpe después.', false, 'La disculpa está bien, pero no borra lo ocurrido ni legitima repetirlo.'),
   (v_q, 'Depende de si los demás se rieron o no.', false, 'Que el grupo se ría no convierte una conducta en aceptable.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 4, 'Un encargado escribe mensajes insistentes de contenido personal por WhatsApp, siempre fuera del horario. ¿Cuenta como acoso?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'No, porque es fuera del horario laboral.', false, 'El vínculo laboral no desaparece al salir del turno.'),
   (v_q, 'No, porque no hay contacto físico.', false, 'El acoso sexual puede ser verbal o escrito, sin contacto alguno.'),
   (v_q, 'Solo si se lo envía a varias personas.', false, 'Basta con una persona afectada.'),
   (v_q, 'Sí: el acoso digital está expresamente contemplado y la relación jerárquica lo agrava.', true, 'Correcto. La LO 10/2022 incluye el ámbito digital de forma expresa.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 5, 'Una trabajadora denuncia acoso. Para "evitar problemas", la empresa la cambia a otro local. ¿Es correcto?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Sí, es la forma más rápida de separar a las dos personas.', false, 'Rápida sí, pero traslada el coste a quien denunció.'),
   (v_q, 'No: la medida cautelar no puede perjudicar a quien denuncia. Mover a la víctima funciona como un castigo encubierto.', true, 'Correcto. Se separan, sí, pero sin penalizar a quien ha dado el paso.'),
   (v_q, 'Sí, si ella acepta el cambio.', false, 'Aceptar bajo presión no lo convierte en adecuado.'),
   (v_q, 'Sí, mientras se le mantenga el sueldo.', false, 'El perjuicio no es solo económico: es el mensaje que manda al resto.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 6, 'El jefe de cocina da siempre los peores turnos y las peores tareas a las mujeres del equipo, sin hacer ningún comentario sexual. ¿Qué es esto?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Acoso por razón de sexo: trato desfavorable por el hecho de ser mujer, aunque no haya contenido sexual.', true, 'Correcto. No hace falta contenido sexual para que sea acoso ni discriminación.'),
   (v_q, 'Nada: organizar los turnos es facultad del responsable.', false, 'La facultad de organizar no ampara repartir por sexo.'),
   (v_q, 'Solo sería sancionable si alguna se queja por escrito.', false, 'La conducta es ilícita exista o no denuncia formal.'),
   (v_q, 'Acoso sexual.', false, 'No lo es: no hay conducta de naturaleza sexual. Es acoso por razón de sexo.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 7, '¿Qué empresas están obligadas a tener protocolo contra el acoso?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Solo las de más de 50 personas trabajadoras.', false, 'Ese umbral es el del Plan de Igualdad, no el del protocolo.'),
   (v_q, 'Solo las que hayan tenido algún caso previo.', false, 'Es una obligación preventiva: no espera a que ocurra algo.'),
   (v_q, 'Todas, con independencia del número de personas en plantilla.', true, 'Correcto. RD 901/2020, art. 2.1: todas las empresas, sea cual sea su tamaño.'),
   (v_q, 'Solo las de sectores considerados de riesgo.', false, 'No existe tal distinción por sector.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 8, 'Estás pasando por una situación incómoda con un superior pero no sabes si "es lo bastante grave". ¿Qué haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Espero a que ocurra algo más serio para tener un caso sólido.', false, 'El protocolo existe también para lo que empieza pequeño. Esperar solo alarga el daño.'),
   (v_q, 'Lo anoto con fechas y testigos, y lo comunico por el canal del protocolo o a alguien de confianza.', true, 'Correcto. No hay que estar "seguro de que es grave" para pedir ayuda.'),
   (v_q, 'Cambio yo de turno para no coincidir y no digo nada.', false, 'Es la salida más habitual y la que deja el problema intacto para el siguiente.'),
   (v_q, 'Se lo cuento a los compañeros para ver si a ellos les parece grave.', false, 'El pasillo no es el cauce, y puede volverse en tu contra.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 9, 'Tras denunciar, a un trabajador le reducen las horas y dejan de contar con él. ¿Qué ocurre aquí?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Es normal: la relación ya está deteriorada.', false, 'El deterioro no justifica penalizar a quien ejerció un derecho.'),
   (v_q, 'Es correcto si la denuncia no se llegó a demostrar.', false, 'Ni siquiera una denuncia no probada permite represaliar.'),
   (v_q, 'Es un asunto entre él y su encargado.', false, 'Es una conducta prohibida que compromete a la empresa.'),
   (v_q, 'Son represalias, y están expresamente prohibidas por la ley.', true, 'Correcto. El trato adverso como reacción a una denuncia es ilícito.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 10, 'Tu empresa tiene un protocolo firmado, pero nadie de la plantilla sabe que existe ni a quién dirigirse. ¿Cumple la ley?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Sí: lo que exige la ley es tener el documento.', false, 'Tenerlo sin implantarlo no protege a nadie ni cumple la norma.'),
   (v_q, 'Sí, mientras esté a disposición si alguien lo pide.', false, 'La difusión activa es parte de la obligación, no basta con no esconderlo.'),
   (v_q, 'No: para ser válido debe comunicarse a la plantilla, formarse en él y tener un canal accesible.', true, 'Correcto. Un protocolo en un cajón no cumple: la implantación efectiva es el requisito.'),
   (v_q, 'No, salvo en empresas de menos de 50 personas.', false, 'La exigencia de implantación efectiva no depende del tamaño.');

  raise notice 'Curso igualdad y acoso sembrado (draft, revisión reforzada). id: %', v_course_id;
end
$seed$;

-- ── VERIFICACIÓN (POR SEPARADO) ────────────────────────────────────────────
-- select c.code, c.status,
--   (select count(*) from course_section  s where s.course_id=c.id) as secciones,
--   (select count(*) from course_question q where q.course_id=c.id) as preguntas,
--   (select count(*) from course_option o join course_question q2 on q2.id=o.question_id
--     where q2.course_id=c.id and o.is_correct) as correctas
-- from course c where c.code='igualdad_acoso' and c.account_id is null;
-- Esperado: draft · 6 secciones · 10 preguntas · 10 correctas.
