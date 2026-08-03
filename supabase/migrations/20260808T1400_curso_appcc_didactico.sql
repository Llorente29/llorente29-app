-- ============================================================================
-- Folvy · CURSO "APPCC y planes de prerrequisitos"
-- Molde didáctico de docs/folvy_formacion_guia_contenido.md
-- ----------------------------------------------------------------------------
-- Tercer curso de la OLEADA 1 (sanitaria), con alérgenos y manipulador.
--
-- MARCO LEGAL: Reg. (CE) 852/2004 art. 5 (obligación de implantar procedimientos
-- basados en los principios del APPCC) · Codex Alimentarius (los 7 principios) ·
-- Reg. (CE) 178/2002 art. 18-19 (trazabilidad y retirada).
--
-- ENFOQUE: no es un curso para auditores. Es para que el personal entienda POR QUÉ
-- rellena los registros y qué hace cuando un control se sale de límite. La mayoría
-- de fallos de APPCC en inspección no son de diseño: son registros sin rellenar o
-- rellenados a posteriori.
--
-- ⚠️ REVISIÓN DE JULIO PENDIENTE — status 'draft'.
--    Contenido redactado por Claude desde la normativa. El certificado lo firma
--    el responsable de formación de la empresa cliente.
--
-- Correctas del test: c a d b c a b d c b (verificado, posición variada)
-- DEPENDE DE: 20260806T1500_formacion_c1.sql · IDEMPOTENTE
-- Aplicada:
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
    null, 'appcc_prerrequisitos',
    'APPCC y planes de prerrequisitos',
    'Qué es el sistema de autocontrol de tu local, por qué existen los registros que rellenas y qué tienes que hacer cuando un control se sale de lo normal.',
    'Reglamento (CE) 852/2004, art. 5 · Codex Alimentarius',
    'folvy_imparte', 12, true, true, 25, 70, 1, 'draft'
  )
  on conflict (code) where account_id is null
  do update set title = excluded.title, summary = excluded.summary,
    legal_basis = excluded.legal_basis, reeval_months = excluded.reeval_months,
    estimated_minutes = excluded.estimated_minutes
  returning id into v_course_id;

  if v_course_id is null then
    select id into v_course_id from public.course
     where code = 'appcc_prerrequisitos' and account_id is null;
  end if;

  delete from public.course_option
   where question_id in (select id from public.course_question where course_id = v_course_id);
  delete from public.course_question where course_id = v_course_id;
  delete from public.course_section  where course_id = v_course_id;

  -- ═══ TEORÍA ═══════════════════════════════════════════════════════════════

  insert into public.course_section (course_id, ord, title, body) values

  (v_course_id, 1, 'Qué es eso del APPCC (y por qué te afecta)',
$md$**APPCC** significa Análisis de Peligros y Puntos de Control Crítico. Suena a examen, pero la idea es de sentido común: en vez de comprobar al final si la comida está bien, **vigilas durante el proceso los pocos momentos donde algo puede torcerse de verdad**.

Piensa en cómo conduces. No compruebas si has llegado bien al final del viaje: miras los retrovisores, respetas los semáforos y frenas a tiempo. El APPCC es eso: los semáforos de tu cocina.

Nació en los años 60 para la comida de los astronautas de la NASA —no podían permitirse una intoxicación en órbita— y hoy es **obligatorio por ley en toda la hostelería europea**. Tu local tiene su sistema por escrito, y tú eres parte de él.

**Lo importante para ti**: el APPCC no lo hace el jefe ni el asesor externo. Lo hace quien está en cocina. Un sistema perfecto sobre el papel con nadie tomando temperaturas **no vale nada**, y así lo verá cualquier inspector.

**En tu cocina esto pasa así:** rellenar la hoja de temperaturas de la cámara parece papeleo inútil, hasta el día en que la cámara falla de noche. La hoja es lo que te dice que ayer estaba a 3 °C y hoy a 11 °C — y por tanto que hay producto que no se puede servir. Sin ese dato, servirías comida en mal estado sin saberlo.

> **Marco legal** — Reglamento (CE) 852/2004, art. 5: los operadores de empresa alimentaria deben crear, aplicar y mantener procedimientos permanentes basados en los principios del APPCC. Los 7 principios provienen del Codex Alimentarius.$md$),

  (v_course_id, 2, 'Primero los cimientos: los prerrequisitos',
$md$Antes del APPCC hay algo más básico: los **planes de prerrequisitos**, también llamados planes generales de higiene. Son la base sobre la que se apoya todo lo demás.

Si los cimientos fallan, el APPCC no sirve de nada: es como poner una alarma en una casa sin puertas.

Son estos, y todos te suenan porque los haces a diario:

- **Limpieza y desinfección** — qué se limpia, cada cuánto, con qué producto y quién lo hace.
- **Control de plagas** — barreras, revisiones y actuación cuando hay indicios.
- **Agua apta** — control del agua que usas para cocinar y limpiar.
- **Mantenimiento** — que los equipos funcionen y los termómetros midan bien.
- **Formación del personal** — este curso forma parte del sistema. Por eso lo estás haciendo.
- **Proveedores y trazabilidad** — a quién compras y cómo sabes de dónde viene cada cosa.
- **Alérgenos** — cómo se informa y cómo se evita la contaminación cruzada.
- **Residuos** — cómo se gestiona la basura.

**En tu cocina esto pasa así:** en una inspección, muchas veces el problema no es el APPCC sino un prerrequisito: el termómetro descalibrado, el plan de limpieza sin firmar durante tres semanas, o nadie capaz de demostrar que el personal está formado. Son cosas pequeñas que se arreglan con constancia, no con dinero.

> **Datos técnicos** — Reg. (CE) 852/2004, Anexo II: requisitos generales de higiene (locales, equipos, residuos, suministro de agua, higiene personal, formación). Los planes de prerrequisitos deben estar documentados y con registros que acrediten su cumplimiento.$md$),

  (v_course_id, 3, 'Los puntos donde de verdad te la juegas',
$md$En una cocina hay decenas de pasos, pero solo unos pocos son **puntos de control crítico (PCC)**: aquellos en los que, si algo falla y nadie lo corrige, el peligro **llega al cliente**.

La diferencia importa. Si se te olvida etiquetar una caja, es un fallo — molesto, corregible después. Si sirves pollo crudo por dentro, **ya no hay marcha atrás**: se lo come el cliente.

En hostelería los PCC típicos son pocos y siempre los mismos:

- **Cocinado** — alcanzar la temperatura suficiente en el centro del producto.
- **Refrigeración y conservación** — mantener el frío por debajo del límite.
- **Enfriamiento** — cruzar rápido la zona de peligro después de cocinar.
- **Recepción** — rechazar lo que llega fuera de temperatura o en mal estado.
- **Mantenimiento en caliente** — que lo que espera en el pase no baje de 65 °C.

Cada PCC tiene un **límite** (una cifra concreta: 65 °C, 4 °C), una **vigilancia** (quién mide, cada cuánto y cómo lo anota) y una **acción correctiva** (qué se hace si se pasa el límite).

**En tu cocina esto pasa así:** llega el reparto y el producto refrigerado viene a 12 °C. Eso es un límite superado en un PCC. La acción correctiva no es "meterlo rápido a la cámara y cruzar los dedos": es **rechazar el producto, anotarlo y avisar al responsable**. Lo que ya ha pasado horas en zona de peligro no se arregla enfriándolo.

> **Datos técnicos** — Los 7 principios: (1) análisis de peligros, (2) determinación de PCC, (3) establecimiento de límites críticos, (4) sistema de vigilancia, (5) medidas correctivas, (6) verificación, (7) documentación y registros.$md$),

  (v_course_id, 4, 'Los registros: tu prueba, no tu castigo',
$md$Los registros son la parte que peor fama tiene y la más importante. Sin ellos, todo lo que haces bien **es como si no lo hubieras hecho**: no puedes demostrarlo.

Ante un inspector, la frase "nosotros eso lo hacemos siempre" no vale nada. Lo que vale es el registro firmado del día.

**Cómo se rellenan bien:**
- **En el momento**, no al final del turno de memoria.
- **Con el dato real**, aunque sea malo. Un 8 °C anotado y corregido demuestra que el sistema funciona.
- **Con quién lo hizo**, para poder preguntar si hay dudas después.

**🔴 Y ahora lo que de verdad importa:** un registro rellenado a posteriori, "redondeando" para que quede bonito, **es peor que no tener registro**. Por dos motivos. Primero, porque es falsificación documental y un inspector experimentado lo detecta enseguida (todo perfecto, misma letra, mismo boli, cifras demasiado redondas). Y segundo, porque si un día pasa algo de verdad, tus registros no te defienden: te acusan.

Un sistema honesto tiene desviaciones anotadas. Uno inventado es perfecto — y por eso canta.

**En tu cocina esto pasa así:** son las once de la noche, cierras y ves que no has anotado las temperaturas de las 18:00. La tentación es poner "4 °C" y listo. Lo correcto es anotar la temperatura de ahora con su hora real y dejar constancia de que la toma de las 18:00 no se hizo. Queda peor en el papel y te protege mucho más.

> **Datos técnicos** — Reg. (CE) 852/2004, art. 5.2.g y 5.4.b: obligación de crear documentos y registros apropiados al tamaño de la empresa, y de mantenerlos a disposición de la autoridad competente durante un período adecuado.$md$),

  (v_course_id, 5, 'Cuando algo se sale de límite',
$md$Que un control se salga es **normal y esperable**. Las cámaras fallan, los repartos llegan tarde, los equipos se estropean. El sistema no está diseñado para que nunca pase nada, sino para que cuando pase, se detecte y se corrija.

Lo que se hace, en este orden:

1. **Parar lo afectado.** Sepáralo, identifícalo, que nadie lo use mientras se decide.
2. **Avisar al responsable.** La decisión de tirar o aprovechar no es tuya, y no debe serlo: te están protegiendo a ti también.
3. **Corregir la causa**, no solo el síntoma. Si la cámara sube de temperatura, no basta con bajar el termostato: hay que saber si es la puerta mal cerrada, el motor o que está sobrecargada.
4. **Anotarlo todo**: qué pasó, qué producto, qué se hizo y quién decidió.

**Lo que NUNCA se hace**: recuperar producto que ha estado horas en zona de peligro recalentándolo o congelándolo. El calor mata bacterias, pero **no elimina las toxinas** que algunas ya han producido. Un alimento con toxina de *Staphylococcus* sigue intoxicando aunque lo hiervas.

**En tu cocina esto pasa así:** el lunes por la mañana la cámara marca 11 °C y no sabes desde cuándo. La pregunta clave no es "¿huele mal?", es **"¿cuánto tiempo lleva así?"**. Si no puedes responder con datos, la decisión segura es tirar. Duele, cuesta dinero, y es la decisión correcta.

> **Datos técnicos** — Reg. (CE) 178/2002, art. 19: si un operador considera que un alimento puede ser nocivo para la salud, debe retirarlo del mercado e informar a las autoridades competentes. Las toxinas termoestables (p. ej. enterotoxina estafilocócica) no se destruyen con el cocinado.$md$),

  (v_course_id, 6, 'La auditoría no es el enemigo',
$md$Cada cierto tiempo alguien revisa que el sistema funcione: puede ser una auditoría interna, el asesor externo o una inspección oficial.

Y conviene cambiar el chip: **una auditoría que no encuentra nada no es una buena auditoría**. Es una que no ha mirado bien. Encontrar un fallo antes de que provoque un daño es exactamente para lo que sirve.

Lo que suele revisar:
- Que los **registros estén al día** y sean creíbles.
- Que las **temperaturas** se midan y los termómetros estén calibrados.
- Que el **personal esté formado** y se pueda demostrar (tu firma de este curso).
- Que las **desviaciones** tengan su acción correctiva anotada y cerrada.
- Que la **trazabilidad** permita seguir un lote de principio a fin.

Cuando aparece un incumplimiento, se abre una **acción correctiva**: qué se ha hecho para arreglarlo y qué se va a hacer para que no se repita. A veces ese "para que no se repita" es precisamente **volver a formar** a las personas implicadas. Si eso ocurre, no es un castigo ni una mancha en tu expediente: es cómo se cierra el círculo.

**En tu cocina esto pasa así:** durante una auditoría se detecta que llevas dos semanas sin registrar la temperatura del arcón. Lo peor que puedes hacer es rellenarlas todas de golpe delante del auditor. Lo correcto es reconocerlo, anotar desde hoy y explicar qué vas a hacer para no volver a olvidarlo. Nadie espera perfección; se espera honestidad y corrección.

> **Datos técnicos** — Reg. (CE) 852/2004, art. 5.2.f: principio de verificación, comprobar periódicamente que el sistema funciona eficazmente. La formación es un prerrequisito del sistema: un incumplimiento detectado en auditoría puede exigir reevaluación del personal implicado.$md$);

  -- ═══ TEST SITUACIONAL ═════════════════════════════════════════════════════
  -- Correctas: c a d b c a b d c b

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 1, 'Son las 23:00, cierras y te das cuenta de que no anotaste las temperaturas de las 18:00. ¿Qué haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Pongo 4 °C, que es lo que suele marcar siempre.', false, 'Eso es inventar un registro. Es falsificación y un inspector lo detecta.'),
   (v_q, 'Dejo el hueco en blanco y no digo nada.', false, 'El hueco sin explicación se lee como dejadez y no aporta información.'),
   (v_q, 'Anoto la temperatura de ahora con su hora real y dejo constancia de que la toma de las 18:00 no se hizo.', true, 'Correcto. Queda peor en el papel y te protege mucho más: el registro es veraz.'),
   (v_q, 'Relleno también las de mañana por adelantado para no olvidarme.', false, 'Aún peor: es un registro falso de algo que ni siquiera ha pasado.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 2, 'Llega el reparto y el producto refrigerado viene a 12 °C. ¿Qué es lo correcto?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Rechazar el producto, anotar la incidencia y avisar al responsable.', true, 'Correcto. La recepción es un punto de control: lo que llega mal, no entra.'),
   (v_q, 'Meterlo rápido a la cámara: en una hora estará a 4 °C.', false, 'Enfriar después no deshace las horas que ya ha pasado en zona de peligro.'),
   (v_q, 'Aceptarlo y usarlo hoy mismo para que no dé tiempo a que se estropee.', false, 'El riesgo ya existe desde antes de que llegue a tu cocina.'),
   (v_q, 'Aceptarlo y congelarlo inmediatamente.', false, 'Congelar detiene la multiplicación, pero no elimina lo que ya hay ni las toxinas.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 3, '¿Qué diferencia a un punto de control crítico (PCC) de cualquier otro paso del proceso?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Que lo vigila el encargado en vez del cocinero.', false, 'No depende de quién lo haga, sino de las consecuencias del fallo.'),
   (v_q, 'Que se anota en una hoja distinta.', false, 'El soporte del registro no define la criticidad.'),
   (v_q, 'Que es el paso más caro del proceso.', false, 'El coste no tiene nada que ver.'),
   (v_q, 'Que si falla y nadie lo corrige, el peligro llega al cliente y ya no hay marcha atrás.', true, 'Correcto. Esa es la definición: sin control, el peligro no se detiene después.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 4, 'El lunes por la mañana la cámara marca 11 °C y no sabéis desde cuándo. ¿Qué haces con el producto?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Lo huelo y lo miro: si tiene buen aspecto, se usa.', false, 'Los sentidos no detectan la mayoría de patógenos. Es la trampa más común.'),
   (v_q, 'Aviso al responsable y, si no se puede saber cuánto tiempo lleva así, se desecha.', true, 'Correcto. Sin poder acotar el tiempo, la decisión segura es tirar. Y se registra.'),
   (v_q, 'Lo cocino a más temperatura de lo normal para compensar.', false, 'El calor no elimina las toxinas ya producidas por algunas bacterias.'),
   (v_q, 'Lo congelo para pararlo y decido la semana que viene.', false, 'Congelar no deshace el daño; solo aplaza la decisión con el riesgo dentro.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 5, '¿Por qué la formación del personal forma parte del sistema APPCC?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Porque lo pide el convenio colectivo.', false, 'La exigencia viene de la normativa de higiene alimentaria.'),
   (v_q, 'No forma parte: es un tema de recursos humanos aparte.', false, 'Es un prerrequisito del sistema, no un asunto ajeno.'),
   (v_q, 'Porque es un prerrequisito: sin gente formada, los controles no se hacen bien aunque el sistema esté bien diseñado.', true, 'Correcto. El sistema lo ejecutan las personas; sin formación, es papel mojado.'),
   (v_q, 'Porque sube la nota de la auditoría.', false, 'La razón es que sin formación el sistema no funciona, no la puntuación.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 6, 'En una auditoría detectan que llevas dos semanas sin registrar la temperatura del arcón. ¿Qué haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Lo reconozco, anoto desde hoy y explico qué vamos a hacer para no volver a olvidarlo.', true, 'Correcto. Nadie espera perfección: se espera honestidad y corrección.'),
   (v_q, 'Relleno las dos semanas de golpe antes de que lo apunten.', false, 'Falsificar delante de un auditor es mucho más grave que el olvido.'),
   (v_q, 'Digo que el arcón se estropeó y por eso no había datos.', false, 'Mentir en una auditoría destruye la credibilidad de todo el sistema.'),
   (v_q, 'Digo que las anoté en otra hoja que se ha perdido.', false, 'Misma trampa: una excusa inventada agrava el problema.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 7, 'Un guiso lleva desde ayer en el pase caliente, pero por debajo de 65 °C parte del tiempo. ¿Se puede servir recalentándolo?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Sí, si lo hiervo cinco minutos queda estéril.', false, 'Hervir mata bacterias pero no destruye las toxinas termoestables que ya hayan producido.'),
   (v_q, 'No: se desecha, porque algunas bacterias ya pueden haber producido toxinas que el calor no destruye.', true, 'Correcto. Es la razón exacta por la que no se recupera producto de zona de peligro.'),
   (v_q, 'Sí, si al probarlo sabe bien.', false, 'El sabor no indica nada sobre la presencia de toxinas.'),
   (v_q, 'Sí, si se sirve solo al personal.', false, 'La seguridad alimentaria es igual para el equipo que para el cliente.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 8, 'Un inspector pide ver los registros de temperatura del último mes. ¿Qué le resulta más creíble?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Una hoja donde todos los días marcan exactamente 4 °C.', false, 'Demasiado perfecto: una cámara real fluctúa. Eso levanta sospechas.'),
   (v_q, 'Una hoja rellenada entera con el mismo boli y la misma letra el mismo día.', false, 'Es la señal clásica de registro hecho a posteriori.'),
   (v_q, 'Una hoja sin datos pero con la explicación de que se hace siempre.', false, 'Lo que no está registrado, a efectos de inspección, no se ha hecho.'),
   (v_q, 'Una hoja con cifras variadas, alguna desviación anotada y su acción correctiva cerrada.', true, 'Correcto. Un sistema honesto tiene desviaciones; uno inventado es perfecto y por eso canta.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 9, 'La cámara ha subido de temperatura. La has bajado y ya está a 4 °C. ¿Está resuelto?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Sí, el dato ya es correcto y no hace falta anotar nada.', false, 'Sin registrar la desviación, el sistema no aprende ni demuestra nada.'),
   (v_q, 'Sí, mientras no se repita esta semana.', false, 'La causa sigue ahí y volverá a ocurrir.'),
   (v_q, 'No: hay que averiguar la causa (puerta, motor, sobrecarga), decidir qué pasa con el producto y anotarlo todo.', true, 'Correcto. Corregir el síntoma sin la causa garantiza que se repita.'),
   (v_q, 'No, hay que cambiar la cámara inmediatamente.', false, 'Puede ser algo mucho más simple; primero se investiga la causa.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 10, 'Tras una auditoría con incumplimientos, la empresa manda repetir la formación al equipo implicado. ¿Qué significa?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Que hay un aviso disciplinario en camino.', false, 'La reevaluación es una medida correctiva del sistema, no una sanción.'),
   (v_q, 'Que el sistema está funcionando: se detecta un fallo, se refuerza la formación y queda evidencia de que se ha corregido.', true, 'Correcto. Fallo → formación → evidencia. Así se cierra el círculo.'),
   (v_q, 'Que la auditoría anterior estaba mal hecha.', false, 'Al contrario: una auditoría que encuentra cosas es una que ha mirado bien.'),
   (v_q, 'Que hay que cambiar el sistema APPCC entero.', false, 'Un incumplimiento puntual se corrige con acciones concretas.');

  raise notice 'Curso APPCC sembrado (didáctico, draft). id: %', v_course_id;
end
$seed$;

-- ── VERIFICACIÓN (POR SEPARADO) ────────────────────────────────────────────
-- select c.code, c.status,
--   (select count(*) from course_section  s where s.course_id=c.id) as secciones,
--   (select count(*) from course_question q where q.course_id=c.id) as preguntas,
--   (select count(*) from course_option o join course_question q2 on q2.id=o.question_id
--     where q2.course_id=c.id and o.is_correct) as correctas
-- from course c where c.code='appcc_prerrequisitos' and c.account_id is null;
-- Esperado: draft · 6 secciones · 10 preguntas · 10 correctas.
