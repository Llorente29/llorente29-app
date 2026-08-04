-- ============================================================================
-- Folvy · CURSO "El inventario: contar bien o no contar"
-- Molde: docs/folvy_formacion_guia_contenido.md · Catálogo v2 Bloque B (cocina)
-- ----------------------------------------------------------------------------
-- Tercer curso del bloque cocina. Cierra el trío del control de coste junto al
-- escandallo (no poner de más) y las mermas (no tirar de más y registrarlo).
-- Este enseña la tercera pata: CONTAR BIEN, porque un conteo malo invalida
-- los otros dos.
--
-- TAXONOMÍA: category='cocina' · business_types={todos} · level='base'
--            requires_practical=true (hacer un conteo real y contrastarlo)
--
-- ⚠️ REVISIÓN DE JULIO PENDIENTE — status 'draft'. Describe el funcionamiento
--    real del módulo de Almacén de Folvy (conteo a ciegas, autoinventario por
--    IA, AvT): revisar que coincida con la operación antes de publicar.
--
-- Correctas del test: c a d b a c b d a b (verificado)
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
    null, 'inventario_conteo',
    'El inventario: contar bien o no contar',
    'Por qué se cuenta, cómo se cuenta bien, qué es el conteo a ciegas y por qué un inventario hecho de memoria es peor que no hacerlo.',
    'Buenas prácticas de gestión de stock',
    'folvy_imparte', 24, false, false, 20, 70, 1, 'draft'
  )
  on conflict (code) where account_id is null
  do update set title = excluded.title, summary = excluded.summary,
    reeval_months = excluded.reeval_months, estimated_minutes = excluded.estimated_minutes
  returning id into v_course_id;

  if v_course_id is null then
    select id into v_course_id from public.course
     where code = 'inventario_conteo' and account_id is null;
  end if;

  if exists (select 1 from information_schema.columns where table_name='course' and column_name='category') then
    execute format('update public.course set category=%L, level=%L, recommended_order=%s where id=%L',
                   'cocina', 'base', 220, v_course_id);
  end if;
  if exists (select 1 from information_schema.columns where table_name='course' and column_name='business_types') then
    execute format('update public.course set business_types=%L::text[] where id=%L', '{todos}', v_course_id);
  end if;
  if exists (select 1 from information_schema.columns where table_name='course' and column_name='requires_practical') then
    execute format('update public.course set requires_practical=true where id=%L', v_course_id);
  end if;

  delete from public.course_option
   where question_id in (select id from public.course_question where course_id = v_course_id);
  delete from public.course_question where course_id = v_course_id;
  delete from public.course_section  where course_id = v_course_id;

  -- ═══ TEORÍA ═══════════════════════════════════════════════════════════════

  insert into public.course_section (course_id, ord, title, body) values

  (v_course_id, 1, 'Contar es la única forma de saber la verdad',
$md$El sistema puede calcular muchas cosas: lo que has comprado, lo que has vendido, lo que las fichas dicen que deberías haber gastado. Pero hay una cosa que **ningún sistema puede saber solo**: cuánto producto hay ahora mismo en tu cámara.

Eso solo se sabe **contándolo**.

Y de ahí sale todo lo demás. El famoso **"teórico vs real"** compara lo que debería quedar con lo que de verdad queda. Si el conteo está mal, esa comparación no vale nada — y con ella se cae el control de coste entero.

Dicho de otra forma: **un inventario mal hecho no es un inventario a medias. Es un dato falso que estropea los cálculos de todo el mes.**

Por eso conviene decirlo claro desde el principio: **si no vas a contar bien, es mejor no contar.** Un hueco sin dato se ve y se puede corregir. Un número inventado se cuela en los cálculos y nadie lo detecta.

**En tu cocina esto pasa así:** el inventario tiene mala fama porque se hace tarde, cansado y con prisa, y encima parece que no sirve para nada. Sirve para exactamente una cosa muy concreta: **saber si estás perdiendo dinero y por dónde**. Sin él, solo queda la sorpresa a fin de mes.

> **Dato de gestión** — El consumo real solo puede calcularse con dos conteos: uno al inicio del periodo y otro al final. Sin conteo inicial, el sistema no puede medir nada de ese artículo, por muchas compras y ventas que registre.$md$),

  (v_course_id, 2, 'Cómo se cuenta bien',
$md$Contar parece trivial y es donde más errores se cometen. Las reglas que marcan la diferencia:

**1. Cuenta lo que ves, no lo que crees.** Aunque estés seguro de que quedaban seis, cuenta los seis. El "me suena que había" es el origen de la mitad de los descuadres.

**2. Cuenta en la unidad correcta.** Si el sistema pide kilos, no apuntes "3 bolsas". Si pide unidades, no apuntes "media caja". Y ojo con lo que viene en formatos: una caja de 24 no son "1", son 24 — o 1 caja, según cómo esté configurado. **Ante la duda, pregunta antes de apuntar.**

**3. Pesa lo que se pesa.** Producto a granel, salsas empezadas, carne en cubetas: eso se pesa. Un "medio cubo" puede ser 2 kg o 5 kg según quién lo mire.

**4. Sigue siempre el mismo recorrido.** Cámara por cámara, estantería por estantería, de arriba abajo. Si vas saltando, algo se queda sin contar o se cuenta dos veces.

**5. No cuentes mientras entra o sale género.** Si en mitad del conteo llega el reparto o cocina saca producto, el número deja de cuadrar. Se cuenta con la cocina parada: al cierre o antes de abrir.

**6. Si no lo encuentras, es cero.** No lo dejes en blanco "por si acaso". Cero es un dato; en blanco no es nada.

**En tu cocina esto pasa así:** el error más caro no es contar mal una vez, es **contar en unidades distintas cada mes**. Un mes en cajas, otro en unidades, otro en kilos. Entonces la comparación entre periodos no significa nada y no se puede ver ninguna tendencia.

> **Dato de gestión** — En Folvy cada artículo tiene definida su unidad de conteo y sus formatos (caja → unidad → uso). Contar en la unidad que pide el sistema es lo que permite convertir correctamente a coste y comparar entre periodos.$md$),

  (v_course_id, 3, 'El conteo a ciegas: por qué no ves el número esperado',
$md$Cuando cuentes, seguramente **no verás lo que el sistema cree que hay**. Y no es un descuido: **es a propósito**.

Se llama **conteo a ciegas**, y existe por una razón demostrada: si ves "el sistema dice 12" y cuentas 11, tu cabeza tiende a pensar *"habré contado mal"* y apuntas 12. Sin darte cuenta, y sin mala intención.

Ese sesgo hace que los inventarios "cuadren" siempre... y que las pérdidas reales no aparezcan nunca. Un inventario que siempre cuadra no es un inventario bueno: **es uno que no está midiendo nada.**

Por eso **tú cuentas lo que hay, sin referencia**. El sistema compara después.

**Y esto es importante:** que salga una diferencia **no significa que hayas contado mal**. Puede ser gramaje, merma no registrada, producto recibido de menos o un error de otro conteo. **Tu trabajo es aportar el número real; explicarlo viene después.**

**En tu cocina esto pasa así:** cuando alguien ve la diferencia y le entra el apuro, la tentación es "ajustar" el conteo para que cuadre. Es la peor decisión posible: se pierde la única información honesta del proceso, y el problema real —sea cual sea— sigue ahí, invisible, mes tras mes.

> **Dato de gestión** — El conteo a ciegas es el estándar en gestión de stock precisamente para evitar el sesgo de confirmación. Folvy lo aplica en el conteo desde móvil: se cuenta sin ver el stock teórico.$md$),

  (v_course_id, 4, 'No hace falta contarlo todo, todos los días',
$md$Contar el almacén entero cada semana es inviable y por eso nunca se hace. La alternativa que sí funciona es contar **poco y a menudo**, pero contando lo que importa.

**Qué se cuenta más a menudo:**
- **Lo caro.** Carne, pescado, marisco, quesos. Ahí está el dinero.
- **Lo que más se mueve.** Un producto de alta rotación acumula error muy rápido.
- **Lo que suele dar problemas.** Si un artículo descuadra siempre, cuéntalo más.

**Y lo demás, con menos frecuencia.** El papel de aluminio no necesita conteo semanal.

Esa es la idea del **conteo rotativo**: en vez de un maratón mensual agotador donde todo se cuenta mal por cansancio, unos pocos artículos cada día, bien contados, con la cocina tranquila.

**Y hay algo que a veces se olvida: hay que contar TODO lo que hay de ese artículo.** Si el aceite está en el almacén, en la cocina y en un mueble bajo la plancha, los tres sitios cuentan. Lo que se queda sin contar aparece como pérdida el mes siguiente.

**En tu cocina esto pasa así:** el inventario mensual completo, hecho a las once de la noche después de un servicio, es la receta perfecta para datos malos. **Diez minutos al día valen más que tres horas al mes**, y además no le arruinan el turno a nadie.

> **Dato de gestión** — Folvy propone qué contar cada día combinando valor, rotación y riesgo del artículo, y reparte la carga entre los días. Es un conteo rotativo asistido: la app dice qué toca hoy, tú cuentas.$md$),

  (v_course_id, 5, 'Qué pasa después de contar',
$md$Cuando el conteo se cierra, el sistema hace tres cosas:

**1. Ajusta el stock** a lo que has contado. A partir de ahí, ese es el punto de partida real.

**2. Calcula la diferencia** con lo que debería haber (teórico). Esa diferencia es la merma del periodo.

**3. Señala dónde mirar.** Por artículo, por familia, por almacén. No dice quién tiene la culpa: dice **dónde está el problema**.

**Y aquí es donde el trabajo de contar bien da su fruto.** Con un conteo fiable, una diferencia significa algo concreto y se puede investigar. Con un conteo hecho a ojo, la diferencia no dice nada — y entonces todo el mundo deja de mirar el informe, que es como muere un sistema de control.

**Las causas habituales de una diferencia**, por si te preguntan:
- Gramajes por encima de la ficha.
- Merma no registrada.
- Producto recibido de menos y no detectado en recepción.
- Fichas técnicas desactualizadas.
- Un conteo anterior mal hecho *(por eso el siguiente sale raro)*.

**En tu cocina esto pasa así:** una diferencia grande casi nunca es lo que parece. Antes de pensar en lo peor, se revisa: ¿se contó todo?, ¿en la unidad correcta?, ¿se registraron las mermas?, ¿el pedido llegó completo? **Nueve de cada diez veces está ahí.**

> **Dato de gestión** — Folvy indica además la "salud del dato": cuántos artículos son realmente medibles (con conteo de inicio y fin y escandallo fiable) y cuántos no. Un informe que dice "fiabilidad parcial" es más útil que uno que finge precisión.$md$),

  (v_course_id, 6, 'Qué se espera de ti',
$md$Cinco cosas, y todas caben en unos minutos al día:

**1. Cuenta lo que ves.** No lo que recuerdas, no lo que crees, no lo que el sistema espera.

**2. Cuenta en la unidad que te pide** y pesa lo que hay que pesar. Ante la duda, pregunta antes de apuntar.

**3. Cuenta todos los sitios** donde esté ese artículo, no solo el almacén principal.

**4. Si no hay, pon cero.** No lo dejes en blanco.

**5. No ajustes para que cuadre.** Una diferencia es información valiosa; un número maquillado es basura que ensucia el mes entero.

**Y si ves algo raro mientras cuentas** —producto caducado, algo mal colocado, un artículo que ya no se usa y sigue ocupando sitio— **dilo**. Contar es el único momento en que alguien mira el almacén entero con atención: es cuando se detectan cosas que el resto del mes pasan desapercibidas.

**La idea que resume el curso:**

> Un conteo honesto con diferencias vale infinitamente más que uno perfecto e inventado.

**Antes de terminar**: pregunta cuándo toca el próximo conteo en tu local y qué artículos te corresponden. Si nadie lo sabe, ahí tienes el primer problema que resolver.

> **Dato de gestión** — Conteo fiable + merma registrada + escandallo actualizado son las tres piezas del control de coste real. Si falla una, las otras dos dejan de significar nada.$md$);

  -- ═══ TEST SITUACIONAL ═════════════════════════════════════════════════════
  -- Correctas: c a d b a c b d a b

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 1, 'Cuentas 11 cajas de un producto. Alguien comenta que en el sistema constan 12. ¿Qué apuntas?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, '12, porque el sistema suele tener razón y habré contado mal.', false, 'Ese es exactamente el sesgo que el conteo a ciegas quiere evitar.'),
   (v_q, 'Un valor intermedio para no generar conflicto.', false, 'Inventar un número destruye la única información honesta del proceso.'),
   (v_q, '11: lo que he contado. La diferencia es información, no un error mío.', true, 'Correcto. Tu trabajo es aportar el número real; explicarlo viene después.'),
   (v_q, 'Vuelvo a contar hasta que me salga 12.', false, 'Contar hasta que cuadre es maquillar el dato.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 2, '¿Por qué el conteo desde el móvil no te muestra el stock que el sistema espera?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Para evitar que el número esperado condicione lo que apuntas (conteo a ciegas).', true, 'Correcto. Si ves 12 y cuentas 11, la tendencia natural es apuntar 12.'),
   (v_q, 'Porque el sistema no lo tiene calculado en ese momento.', false, 'Sí lo tiene: simplemente no te lo enseña, a propósito.'),
   (v_q, 'Por un fallo de la aplicación.', false, 'Es una decisión de diseño, no un fallo.'),
   (v_q, 'Para que el conteo sea más rápido.', false, 'La razón es la fiabilidad del dato, no la velocidad.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 3, 'Buscas un artículo de la lista y no queda nada. ¿Qué haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Lo dejo en blanco: no hay nada que contar.', false, 'En blanco no es un dato: el sistema no sabe si es cero o si no se contó.'),
   (v_q, 'Pongo lo que había el mes pasado.', false, 'Inventar el dato estropea el cálculo del periodo.'),
   (v_q, 'Lo salto y aviso al final.', false, 'Al final se olvida y queda sin dato.'),
   (v_q, 'Apunto cero: cero es un dato, en blanco no lo es.', true, 'Correcto. Y de paso indica que hay rotura de stock.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 4, 'El aceite está en el almacén, en la cocina y en un mueble bajo la plancha. ¿Qué cuentas?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Solo lo del almacén, que es donde se guarda el stock.', false, 'Lo que quede fuera del conteo aparecerá como pérdida el mes siguiente.'),
   (v_q, 'Todo lo que haya de ese artículo, esté donde esté.', true, 'Correcto. Si no, el descuadre lo genera el propio conteo.'),
   (v_q, 'Lo del almacén y lo de cocina; lo de la plancha es residual.', false, 'Lo "residual" repetido cada mes es un descuadre constante.'),
   (v_q, 'Lo que esté sin abrir.', false, 'Lo empezado también es stock: se pesa.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 5, 'Estás contando y llega el reparto del proveedor. ¿Qué haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Paro el conteo o lo termino antes de dar entrada al género: contar mientras entra o sale producto invalida el número.', true, 'Correcto. Por eso se cuenta con la cocina parada: al cierre o antes de abrir.'),
   (v_q, 'Sigo contando y sumo lo que acaba de llegar.', false, 'Mezclas dos momentos distintos y el número deja de ser una foto fija.'),
   (v_q, 'Sigo contando e ignoro lo nuevo.', false, 'Si el género ya entró al almacén, ignorarlo genera descuadre.'),
   (v_q, 'Dejo el conteo para otro día.', false, 'Aplazarlo indefinidamente es como no hacerlo; basta con ordenar los dos momentos.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 6, '¿Qué artículos conviene contar con más frecuencia?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Los que ocupan más espacio.', false, 'El volumen no tiene relación con el valor ni con el riesgo.'),
   (v_q, 'Todos por igual, para ser justos.', false, 'Inviable en la práctica, y por eso se acaba no contando nada.'),
   (v_q, 'Los caros, los de mucha rotación y los que suelen descuadrar.', true, 'Correcto. Es la idea del conteo rotativo: poco y a menudo, donde importa.'),
   (v_q, 'Los que caducan antes.', false, 'Eso se controla con la rotación FEFO, no con la frecuencia de conteo.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 7, 'El sistema pide el conteo en kilos y tú tienes 3 bolsas empezadas de tamaños distintos.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Apunto "3 bolsas" y que el sistema lo convierta.', false, 'El sistema no sabe cuánto queda en una bolsa empezada.'),
   (v_q, 'Las peso y apunto los kilos reales.', true, 'Correcto. Lo empezado y lo a granel se pesa: "media bolsa" no es una cantidad.'),
   (v_q, 'Calculo a ojo cuántos kilos serán.', false, 'A ojo, el error entre personas es enorme.'),
   (v_q, 'Apunto solo las bolsas sin abrir.', false, 'Lo empezado también es stock y también vale dinero.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 8, 'Tras el conteo sale una diferencia grande en un artículo. ¿Qué significa?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Que alguien se está llevando producto.', false, 'Es la conclusión más precipitada y casi nunca la causa.'),
   (v_q, 'Que el conteo está mal hecho.', false, 'Puede ser una causa, pero no la única ni la más probable.'),
   (v_q, 'Que el sistema calcula mal.', false, 'Es lo último que hay que asumir.'),
   (v_q, 'Que hay algo que revisar: gramaje, merma sin registrar, recepción incompleta, ficha desactualizada o un conteo anterior erróneo.', true, 'Correcto. Nueve de cada diez veces está en esa lista.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 9, '¿Cuándo es mejor hacer el conteo?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Con la cocina parada: al cierre o antes de abrir, y siguiendo siempre el mismo recorrido.', true, 'Correcto. Y mejor poco y a menudo que un maratón mensual a las once de la noche.'),
   (v_q, 'En mitad del servicio, aprovechando los ratos libres.', false, 'Entra y sale producto continuamente: el número no vale.'),
   (v_q, 'Cuando lo pida el jefe, sea la hora que sea.', false, 'El momento condiciona directamente la calidad del dato.'),
   (v_q, 'Después de un servicio largo, para aprovechar que ya está todo recogido.', false, 'Cansado y con prisa es cuando peor se cuenta.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 10, 'Un inventario que cuadra perfectamente todos los meses, ¿qué indica?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Que la gestión del almacén es excelente.', false, 'Ojalá, pero en la práctica es muy improbable.'),
   (v_q, 'Que probablemente se está ajustando el conteo al número esperado, y entonces no está midiendo nada.', true, 'Correcto. Un inventario que siempre cuadra suele ser uno que no mide.'),
   (v_q, 'Que no hace falta seguir contando ese almacén.', false, 'Justo al revés: convendría revisar cómo se está contando.'),
   (v_q, 'Que las fichas técnicas están perfectas.', false, 'No se puede deducir eso de un cuadre sospechosamente perfecto.');

  raise notice 'Curso de inventario sembrado (draft, cocina). id: %', v_course_id;
end
$seed$;

-- ── VERIFICACIÓN (POR SEPARADO) ────────────────────────────────────────────
-- select c.code, c.status, c.category,
--   (select count(*) from course_section  s where s.course_id=c.id) as secciones,
--   (select count(*) from course_question q where q.course_id=c.id) as preguntas,
--   (select count(*) from course_option o join course_question q2 on q2.id=o.question_id
--     where q2.course_id=c.id and o.is_correct) as correctas
-- from course c where c.code='inventario_conteo' and c.account_id is null;
-- Esperado: draft · cocina · 6 secciones · 10 preguntas · 10 correctas.
