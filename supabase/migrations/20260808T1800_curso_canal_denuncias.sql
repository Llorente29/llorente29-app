-- ============================================================================
-- Folvy · CURSO "Canal interno de información (canal de denuncias)"
-- Molde didáctico de docs/folvy_formacion_guia_contenido.md · OLEADA 2
-- ----------------------------------------------------------------------------
-- MARCO LEGAL (verificado):
--   · Ley 2/2023, de 20 de febrero, reguladora de la protección de las personas
--     que informen sobre infracciones normativas y de lucha contra la corrupción
--     (transpone la Directiva (UE) 2019/1937, "whistleblowing").
--   · Obligación: empresas de 50 O MÁS personas trabajadoras (plazos ya vencidos:
--     13/06/2023 para 250+, 01/12/2023 para 50-249).
--   · Sanciones: hasta 1.000.000 € para personas jurídicas.
--   · Se admiten comunicaciones ANÓNIMAS si el sistema lo permite técnicamente.
--   · La ley usa "canal interno de información", no "canal de denuncias".
--
-- ⚠️ MATIZ RELEVANTE PARA GRUPOS (caso Llorente29): si varias sociedades del
--    mismo grupo suman 50+ personas pero individualmente tienen menos, la
--    interpretación mayoritaria es que SÍ están obligadas cuando hay dirección
--    única. Zona gris: conviene validarlo con asesoría.
--    Cómputo: todos los contratos laborales (indefinidos, temporales, parciales);
--    no cuentan autónomos ni becarios no laborales.
--
-- ⚠️⚠️ REVISIÓN REFORZADA — status 'draft'. is_mandatory=false (depende del
--    tamaño del cliente). El curso remite al canal propio de cada empresa y NO
--    lo sustituye: cada empresa debe indicar su canal y su responsable del
--    sistema.
--
-- Correctas del test: c a b d c b a c d b (verificado)
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
    null, 'canal_denuncias',
    'Canal interno de información (canal de denuncias)',
    'Qué es el canal, qué se puede comunicar por él, qué protección tienes si lo usas y qué no es (no es para quejarse del cuadrante). Obligatorio en empresas de 50 o más personas.',
    'Ley 2/2023 · Directiva (UE) 2019/1937',
    'folvy_imparte', 24, false, false, 20, 70, 1, 'draft'
  )
  on conflict (code) where account_id is null
  do update set title = excluded.title, summary = excluded.summary,
    legal_basis = excluded.legal_basis, reeval_months = excluded.reeval_months,
    estimated_minutes = excluded.estimated_minutes
  returning id into v_course_id;

  if v_course_id is null then
    select id into v_course_id from public.course
     where code = 'canal_denuncias' and account_id is null;
  end if;

  delete from public.course_option
   where question_id in (select id from public.course_question where course_id = v_course_id);
  delete from public.course_question where course_id = v_course_id;
  delete from public.course_section  where course_id = v_course_id;

  -- ═══ TEORÍA ═══════════════════════════════════════════════════════════════

  insert into public.course_section (course_id, ord, title, body) values

  (v_course_id, 1, 'Un buzón seguro para lo que no te atreves a decir',
$md$Imagina que ves algo que está claramente mal: alguien manipulando las horas fichadas del equipo, facturas que no cuadran, o que se está sirviendo producto caducado a sabiendas. Y quien lo hace es tu encargado.

¿A quién se lo cuentas? Decírselo a él no tiene sentido. Ir por encima da miedo. Y callarte te deja siendo cómplice de algo que no has hecho.

**Para eso existe el canal interno de información.** Es una vía segura para comunicar irregularidades graves, con dos garantías: **tu identidad se protege** y **te protegen frente a represalias**.

La ley que lo regula es la **Ley 2/2023**, que viene de una directiva europea. Obliga a las **empresas de 50 o más personas trabajadoras** a tener este canal. Ojo con un detalle que afecta a los grupos de restauración: si varias sociedades del mismo grupo suman 50 o más y hay dirección única, la interpretación mayoritaria es que **sí están obligadas**, aunque cada una por separado tenga menos.

**En tu equipo esto pasa así:** lo que la gente hace normalmente es comentarlo en el vestuario, aguantar unos meses y acabar marchándose. La empresa pierde a un buen trabajador y el problema sigue ahí. El canal existe justo para romper ese ciclo.

> **Marco legal** — Ley 2/2023, de 20 de febrero, reguladora de la protección de las personas que informen sobre infracciones normativas y de lucha contra la corrupción (transposición de la Directiva UE 2019/1937). Obligatorio para empresas de 50 o más personas trabajadoras; plazos vencidos en 2023.$md$),

  (v_course_id, 2, 'Qué se comunica por ahí (y qué no)',
$md$Esta es la parte que más confusión genera, así que conviene tenerla clara.

**El canal sirve para infracciones penales o administrativas graves o muy graves**, y para infracciones del Derecho de la Unión Europea. En hostelería, por ejemplo:

- **Fraude en las horas**: manipular fichajes, horas extra que no se pagan, gente trabajando sin contrato.
- **Seguridad alimentaria grave**: servir producto caducado a sabiendas, falsear registros del APPCC ante una inspección.
- **Fraude contable o fiscal**: caja B, facturas falsas.
- **Acoso, discriminación, riesgos laborales graves.**
- **Corrupción**: comisiones a cambio de contratos con proveedores.

**El canal NO es para:**
- Quejarte del cuadrante o de que te toca cerrar dos viernes seguidos.
- Conflictos personales o mal ambiente con un compañero.
- Que la comida del personal no te gusta.

Eso tiene sus vías: tu responsable, RRHH o la representación de los trabajadores. **Usar el canal para eso lo desgasta**: si se llena de quejas de convivencia, deja de servir para lo grave.

Y una distinción útil: **no hace falta que estés seguro.** No eres tú quien investiga. Basta con una **sospecha razonable**, con hechos concretos. Lo que no vale es inventarse cosas a sabiendas, y eso sí tiene consecuencias.

**En tu equipo esto pasa así:** el error más frecuente es usar el canal como buzón de quejas. El segundo, no usarlo nunca porque nadie sabe para qué es. Ambos dejan el sistema inservible.

> **Datos técnicos** — Ley 2/2023, art. 2: ámbito material — infracciones del Derecho de la Unión y acciones u omisiones que puedan ser constitutivas de infracción penal o administrativa grave o muy grave. La comunicación de mala fe o con información falsa puede acarrear responsabilidad.$md$),

  (v_course_id, 3, 'Tu protección: lo que la ley te garantiza',
$md$Esta es la razón por la que el canal funciona. Sin protección, nadie lo usaría.

**Confidencialidad de tu identidad.** Solo la conoce la persona responsable del sistema. No se comunica a la persona denunciada ni a tu encargado.

**Puedes hacerlo de forma anónima.** La ley española lo permite expresamente, si el sistema lo admite técnicamente. Puedes comunicar sin dar tu nombre.

**Prohibición de represalias — y aquí está lo fuerte.** No pueden despedirte, sancionarte, cambiarte de puesto o de turno, quitarte horas, negarte formación ni aislarte por haber comunicado. Y esa protección **se extiende a las personas de tu entorno**: compañeros que te ayudaron, o familiares que trabajen en la misma empresa.

**Y la clave que casi nadie conoce: la carga de la prueba se invierte.** Si tras comunicar algo te pasa algo malo en el trabajo, **es la empresa quien tiene que demostrar** que esa medida no tiene nada que ver con tu denuncia. No tienes que demostrarlo tú.

**Plazos que te dicen que no cae en saco roto:**
- Acuse de recibo en **7 días**.
- Respuesta en un máximo de **3 meses**.

**En tu equipo esto pasa así:** el miedo real no es a que te despidan al día siguiente —eso sería demasiado evidente—. Es a lo sutil: que dejen de contar contigo para los turnos buenos, que se enfríe el trato. Por eso la ley protege también frente a esas medidas indirectas.

> **Datos técnicos** — Ley 2/2023: prohibición expresa de represalias, incluidas las adoptadas de forma indirecta o encubierta; inversión de la carga de la prueba; protección extensiva a personas del entorno del informante. Acuse de recibo en 7 días naturales y plazo máximo de respuesta de 3 meses.$md$),

  (v_course_id, 4, 'Cómo se usa, en la práctica',
$md$El canal de tu empresa puede ser una plataforma web, un teléfono, un buzón físico o una reunión presencial si la pides. Lo importante es que sea **accesible y seguro**.

**Al comunicar, cuanto más concreto, mejor:**
- **Qué** ha pasado, con hechos, no impresiones.
- **Cuándo** y **dónde**.
- **Quién** está implicado, si lo sabes.
- **Pruebas** si las tienes: fotos, mensajes, documentos.

Un "creo que en cocina pasan cosas raras" no se puede investigar. Un "el día 12 vi cómo se cambiaban las etiquetas de caducidad de la bandeja X" sí.

**Lo que pasa después:**
1. Recibes **acuse de recibo en 7 días**.
2. El responsable del sistema **investiga con imparcialidad**, y también escucha a la persona afectada.
3. Se toma una decisión y **te informan** del resultado, máximo 3 meses.
4. La información se conserva el tiempo necesario y luego se elimina.

**Existe también un canal externo**: la Autoridad Independiente de Protección del Informante (o el organismo autonómico equivalente). Puedes acudir directamente a él si no te fías del canal interno, si crees que hay riesgo de represalia, o si el interno no responde. **No estás obligado a agotar el interno primero**, aunque suele ser lo más rápido.

**En tu equipo esto pasa así:** mucha gente comunica algo y, al no ver un cambio visible en dos semanas, concluye que "no ha servido de nada". Las investigaciones llevan tiempo y son confidenciales: **no vas a ver el proceso, pero tienes derecho a que te informen del resultado**.

> **Datos técnicos** — Ley 2/2023: el sistema interno debe permitir comunicaciones escritas, verbales o ambas, y una reunión presencial si el informante lo solicita. Canal externo ante la Autoridad Independiente de Protección del Informante (A.A.I.) o las autoridades autonómicas competentes. El uso del canal externo es una opción autónoma, no subsidiaria.$md$),

  (v_course_id, 5, 'La confidencialidad va en los dos sentidos',
$md$Hay una parte que suele olvidarse: **también hay que proteger a la persona sobre la que se informa**.

Una comunicación **no es una condena**. Se investiga y puede resultar que no había nada, o que fue un malentendido. Por eso:

- **La persona afectada tiene presunción de inocencia** y derecho a ser oída.
- **No se difunde su nombre** por el local mientras se investiga.
- Sus datos también están protegidos por el RGPD.

Y una regla que te afecta directamente: **si comunicas algo por el canal, no lo vayas contando por ahí.** Contarlo en el vestuario destruye la confidencialidad que la ley te da a ti y perjudica a la investigación. La discreción no es solo obligación de la empresa: también es tuya.

**Lo que sí tiene consecuencias:** comunicar algo **a sabiendas de que es falso** para perjudicar a alguien. Eso no está protegido y puede acarrear responsabilidad. Ojo: no es lo mismo que equivocarse de buena fe — eso está perfectamente amparado.

**En tu equipo esto pasa así:** el mayor riesgo de un canal mal entendido es que se convierta en un arma en conflictos personales. Un local donde el canal se usa para ajustar cuentas acaba con un canal que nadie se toma en serio, justo cuando de verdad hace falta.

> **Datos técnicos** — Ley 2/2023: garantía de confidencialidad tanto del informante como de las personas afectadas; presunción de inocencia, derecho de defensa y derecho a ser oído. Tratamiento de datos conforme al RGPD, con plazos de conservación limitados.$md$),

  (v_course_id, 6, 'Para qué sirve todo esto de verdad',
$md$Puede parecer un trámite legal más. Pero el canal existe por una razón práctica: **los problemas graves casi siempre los conoce alguien de dentro mucho antes de que estallen.**

En hostelería, quien primero sabe que se están falseando los registros del APPCC, que hay gente sin dar de alta o que se sirve producto caducado no es el inspector ni el auditor: es alguien del turno. Si esa persona tiene una vía segura, el problema se corta a tiempo. Si no la tiene, el problema crece hasta que llega la sanción, la intoxicación o el titular en prensa.

**Para la empresa** también es protección: detectar y arreglar algo internamente es infinitamente más barato que una inspección con expediente. Las sanciones por no tener canal cuando se está obligado **pueden llegar al millón de euros**.

**Lo que hay que recordar de este curso:**
1. El canal es para **infracciones graves**, no para quejas del día a día.
2. Puedes comunicar **de forma anónima**.
3. **Las represalias están prohibidas**, y es la empresa quien tiene que probar que no las hubo.
4. Basta una **sospecha razonable** con hechos concretos: no tienes que investigar tú.
5. Lo que comuniques, **no lo cuentes por ahí**.

**Antes de terminar**, pregunta a tu responsable **cuál es el canal de tu empresa y quién es la persona responsable del sistema**. Un canal que nadie sabe usar no cumple la ley y no protege a nadie.

> **Datos técnicos** — El incumplimiento de la obligación de disponer de un sistema interno de información puede constituir infracción muy grave, con sanciones que alcanzan 1.000.000 € para personas jurídicas. La ley exige que el sistema sea conocido y accesible para toda la plantilla.$md$);

  -- ═══ TEST SITUACIONAL ═════════════════════════════════════════════════════
  -- Correctas: c a b d c b a c d b

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 1, 'Estás harto de que te pongan siempre el cierre de los viernes y crees que es injusto. ¿Es asunto del canal de denuncias?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Sí, es un conflicto laboral y para eso está.', false, 'El canal es para infracciones graves, no para desacuerdos de organización.'),
   (v_q, 'Sí, si lo comunico de forma anónima.', false, 'El anonimato no cambia que el asunto esté fuera del ámbito del canal.'),
   (v_q, 'No: eso se habla con tu responsable, RRHH o la representación de los trabajadores. El canal es para infracciones graves.', true, 'Correcto. Llenarlo de quejas de convivencia lo desgasta y deja de servir para lo importante.'),
   (v_q, 'No, y además quejarse del cuadrante puede sancionarse.', false, 'Reclamar por el cuadrante es legítimo; simplemente tiene otra vía.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 2, 'Sospechas que se están cambiando etiquetas de caducidad, pero no estás seguro del todo. ¿Puedes comunicarlo?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Sí: basta una sospecha razonable con hechos concretos. Investigar no es tarea tuya.', true, 'Correcto. Equivocarse de buena fe está amparado; lo que no vale es inventar a sabiendas.'),
   (v_q, 'No, hasta que no tenga pruebas irrefutables no debo decir nada.', false, 'Exigirte certeza total haría el canal inútil.'),
   (v_q, 'No, primero debo investigarlo yo por mi cuenta.', false, 'Investigar por tu cuenta puede alertar al implicado y estropear la instrucción.'),
   (v_q, 'Sí, pero solo si otro compañero lo confirma.', false, 'No se exige corroboración previa para comunicar.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 3, 'Comunicas algo por el canal y dos semanas después te quitan los turnos buenos y dejan de contar contigo. ¿Qué ocurre?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Nada: mientras no me despidan, no es represalia.', false, 'Las represalias indirectas o encubiertas también están prohibidas.'),
   (v_q, 'Son represalias prohibidas, y además es la empresa quien debe demostrar que la medida no tiene relación con mi comunicación.', true, 'Correcto. La carga de la prueba se invierte: no tienes que demostrarlo tú.'),
   (v_q, 'Es represalia solo si consigo demostrar la relación.', false, 'Precisamente la ley te libera de esa carga.'),
   (v_q, 'Es normal que cambie el trato después de denunciar.', false, 'Normal quizá en la práctica, pero es exactamente lo que la ley prohíbe.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 4, '¿Puedes comunicar sin dar tu nombre?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'No: siempre hay que identificarse para que se investigue.', false, 'La ley española admite expresamente el anonimato.'),
   (v_q, 'Solo si el asunto es muy grave.', false, 'No depende de la gravedad.'),
   (v_q, 'Solo ante el canal externo, no ante el interno.', false, 'También el interno puede admitir comunicaciones anónimas.'),
   (v_q, 'Sí: la ley permite expresamente las comunicaciones anónimas si el sistema lo admite técnicamente.', true, 'Correcto. Y aunque des tu nombre, tu identidad es confidencial.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 5, 'Has comunicado algo por el canal. Un compañero te pregunta qué pasó. ¿Qué haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Se lo cuento: tiene derecho a saber lo que pasa en su local.', false, 'Difundirlo rompe la confidencialidad que te protege a ti.'),
   (v_q, 'Se lo cuento solo si él también lo vio.', false, 'Que lo viera no le convierte en parte de la instrucción.'),
   (v_q, 'No lo comento: la discreción protege la investigación y también me protege a mí.', true, 'Correcto. Contarlo en el vestuario destruye la confidencialidad y perjudica el proceso.'),
   (v_q, 'Lo cuento en el grupo del equipo para que haya más testigos.', false, 'Es la forma más rápida de arruinar la investigación y exponer a todos.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 6, '¿A qué empresas obliga la Ley 2/2023 a tener canal interno de información?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'A todas, sin importar el tamaño.', false, 'Se confunde con el protocolo de acoso sexual, que sí obliga a todas.'),
   (v_q, 'A las de 50 o más personas trabajadoras (y en grupos con dirección única puede aplicar aunque cada sociedad tenga menos).', true, 'Correcto. Es un matiz importante para grupos de restauración con varias sociedades.'),
   (v_q, 'Solo a las empresas cotizadas.', false, 'No se limita a grandes corporaciones.'),
   (v_q, 'Solo a las administraciones públicas.', false, 'Obliga también al sector privado desde ese umbral.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 7, 'Un compañero usa el canal para acusar a otro de algo que sabe que es falso, por una rencilla personal.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'No está protegido: comunicar a sabiendas información falsa puede acarrear responsabilidad.', true, 'Correcto. Distinto de equivocarse de buena fe, que sí está amparado.'),
   (v_q, 'Está protegido igual: el canal ampara cualquier comunicación.', false, 'La protección es para quien informa de buena fe.'),
   (v_q, 'No pasa nada mientras lo haga de forma anónima.', false, 'El anonimato no ampara una denuncia falsa deliberada.'),
   (v_q, 'Depende de si la persona acusada se entera.', false, 'La responsabilidad no depende de eso.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 8, 'Comunicas algo y pasan tres semanas sin que veas ningún cambio en el local. ¿Significa que no ha servido?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Sí: si no hay cambios visibles, lo han archivado.', false, 'La ausencia de cambios visibles no dice nada del estado de la instrucción.'),
   (v_q, 'Sí, y conviene volver a comunicarlo para insistir.', false, 'Duplicar comunicaciones no acelera nada.'),
   (v_q, 'No: las investigaciones son confidenciales y llevan tiempo. Hay acuse en 7 días y respuesta en un máximo de 3 meses.', true, 'Correcto. No verás el proceso, pero tienes derecho a que te informen del resultado.'),
   (v_q, 'No, pero no tengo derecho a saber en qué acabó.', false, 'Sí tienes derecho a ser informado del resultado.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 9, 'No te fías del canal interno porque crees que el responsable es cercano al implicado. ¿Qué puedes hacer?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Nada: hay que usar el interno obligatoriamente antes.', false, 'El canal externo no es subsidiario del interno.'),
   (v_q, 'Denunciarlo en redes sociales.', false, 'Eso te deja fuera de la protección legal y puede volverse en tu contra.'),
   (v_q, 'Esperar a que cambie el responsable del sistema.', false, 'No hay que esperar: existe una vía alternativa inmediata.'),
   (v_q, 'Acudir directamente al canal externo: la Autoridad Independiente de Protección del Informante o el organismo autonómico.', true, 'Correcto. Puedes usar el externo sin agotar el interno, aunque este suele ser más rápido.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 10, 'Vas a comunicar que viste cambiar etiquetas de caducidad. ¿Cómo lo redactas?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, '"En cocina pasan cosas raras desde hace tiempo."', false, 'Sin hechos concretos no hay nada que investigar.'),
   (v_q, '"El día 12, sobre las 18:00, vi cambiar las etiquetas de caducidad de la bandeja X; estaba presente Y."', true, 'Correcto. Qué, cuándo, dónde, quién y pruebas si las hay.'),
   (v_q, '"El encargado es un desastre y no me fío de él."', false, 'Es una opinión sobre una persona, no una comunicación de hechos.'),
   (v_q, '"Alguien me ha dicho que se manipulan caducidades."', false, 'Un rumor sin concretar apenas permite actuar; mejor aportar lo que tú viste.');

  raise notice 'Curso canal de denuncias sembrado (draft, revisión reforzada). id: %', v_course_id;
end
$seed$;

-- ── VERIFICACIÓN (POR SEPARADO) ────────────────────────────────────────────
-- select c.code, c.status,
--   (select count(*) from course_section  s where s.course_id=c.id) as secciones,
--   (select count(*) from course_question q where q.course_id=c.id) as preguntas,
--   (select count(*) from course_option o join course_question q2 on q2.id=o.question_id
--     where q2.course_id=c.id and o.is_correct) as correctas
-- from course c where c.code='canal_denuncias' and c.account_id is null;
-- Esperado: draft · 6 secciones · 10 preguntas · 10 correctas.
