-- ============================================================================
-- Folvy · CURSO "El escandallo: por qué la báscula importa"
-- Molde: docs/folvy_formacion_guia_contenido.md · Catálogo v2 Bloque B (cocina)
-- ----------------------------------------------------------------------------
-- PRIMER CURSO DEL BLOQUE COCINA. Es el más valioso de los seis: nadie forma en
-- esto y es la raíz de que los costes no cuadren. Enseña al cocinero POR QUÉ la
-- ficha técnica y la báscula deciden si el negocio gana o pierde dinero.
--
-- TAXONOMÍA: category='cocina' · business_types={todos} · level='base'
--            requires_practical=true (elaborar un plato pesando según ficha)
--   (Campos escritos solo si las columnas existen — las crea C4.)
--
-- ⚠️ REVISIÓN DE JULIO PENDIENTE — status 'draft'. Contenido operativo que
--    describe el funcionamiento real de Folvy (escandallo, merma, AvT):
--    revisar que coincida con la operación de cada cliente antes de publicar.
--
-- Correctas del test: c a d b c b a d b c (verificado)
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
    null, 'escandallo_fichas_tecnicas',
    'El escandallo: por qué la báscula importa',
    'Qué es una ficha técnica, por qué se pesa, qué es la merma y cómo unos gramos de más en cada plato deciden si el negocio gana o pierde dinero.',
    'Buenas prácticas de gestión de costes',
    'folvy_imparte', 24, false, false, 20, 70, 1, 'draft'
  )
  on conflict (code) where account_id is null
  do update set title = excluded.title, summary = excluded.summary,
    reeval_months = excluded.reeval_months, estimated_minutes = excluded.estimated_minutes
  returning id into v_course_id;

  if v_course_id is null then
    select id into v_course_id from public.course
     where code = 'escandallo_fichas_tecnicas' and account_id is null;
  end if;

  if exists (select 1 from information_schema.columns where table_name='course' and column_name='category') then
    execute format('update public.course set category=%L, level=%L, recommended_order=%s where id=%L',
                   'cocina', 'base', 200, v_course_id);
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

  (v_course_id, 1, 'Diez gramos no son nada. Hasta que son mil platos',
$md$Vamos con un número que sorprende a casi todo el mundo.

Imagina que en una hamburguesa pones **10 gramos de queso de más**. No se ve, no se nota al comerla, y a ti te parece que estás siendo generoso.

Si ese queso cuesta 12 €/kg, esos 10 gramos son **12 céntimos**. Nada.

Pero si vendes **50 hamburguesas al día**, son 6 € diarios. **Al mes, 180 €. Al año, más de 2.000 €** — de un solo ingrediente, en un solo plato, por un gesto que nadie percibe.

Ahora multiplícalo por los ingredientes que lleva la carta entera.

**Eso es lo que hace la ficha técnica**: no es burocracia ni desconfianza hacia ti. Es lo que convierte "un puñado" en una cantidad que se puede calcular, repetir y cobrar.

Y hay una segunda razón, igual de importante: **la ficha es lo que hace que el plato salga igual siempre**. El mismo plato, en Alcalá y en Plaza Castilla, hecho por dos personas distintas, un martes y un sábado. Sin ficha, cada plato depende de quién esté esa noche en la partida.

**En tu cocina esto pasa así:** el cocinero con más experiencia suele ser el que menos pesa — porque ya le sale bien "a ojo". Y es verdad que le sale bueno. Lo que no sale es **igual**, y ahí es donde se va el margen sin que nadie lo note.

> **Dato de gestión** — El coste de un plato se calcula sobre la cantidad **bruta** (lo que se compra, incluyendo la parte que se pierde), no sobre la neta. Un error de gramos por ración se multiplica por el número de raciones vendidas: es el error que más dinero mueve en una cocina.$md$),

  (v_course_id, 2, 'Qué es una ficha técnica de verdad',
$md$Una ficha técnica (o **escandallo**) es la receta del plato **con números**. Tiene tres partes:

**1. Los ingredientes con su cantidad exacta.** No "un poco de aceite": 15 ml. No "queso": 30 g de cheddar.

**2. Los pasos de elaboración**, en orden. Cómo se hace, a qué temperatura, cuánto tiempo.

**3. El coste**, que sale solo de lo anterior. Cada ingrediente tiene un precio por kilo o por litro; multiplicado por la cantidad, da el coste del plato.

Con eso el negocio sabe algo que parece obvio pero que **muchísimos locales no saben**: **cuánto gana con cada plato que vende.**

Y hay dos cantidades que no son lo mismo, y confundirlas es el error más caro:

- **Cantidad neta**: lo que acaba en el plato. 100 g de cebolla picada.
- **Cantidad bruta**: lo que has tenido que comprar para conseguirlo. Si al pelar la cebolla se pierde un 20%, has necesitado **125 g** para poner 100.

**El coste se calcula sobre la bruta**, porque es lo que has pagado. Esa diferencia es la **merma**, y tiene su propio curso.

**En tu cocina esto pasa así:** la ficha se queda desfasada sin que nadie lo diga. Se cambia el proveedor del pan, se sube el gramaje de la carne "porque quedaba escasa", se añade una salsa nueva. Si eso no llega a la ficha, **el coste que ve la oficina es mentira** y las decisiones se toman con números falsos.

> **Dato de gestión** — En Folvy, cambiar el precio de un ingrediente recalcula automáticamente todos los platos donde participa. Por eso la ficha tiene que reflejar la realidad: es la que traduce cada compra a margen.$md$),

  (v_course_id, 3, 'Pesar es más rápido de lo que crees',
$md$La objeción de siempre es "no hay tiempo para pesar en pleno servicio". Y es una objeción legítima, pero tiene respuesta.

**No se pesa todo, ni se pesa siempre.** Se pesa donde importa:

- **Los ingredientes caros.** Carne, pescado, queso, marisco, trufa. Ahí están los euros. Nadie te pide que peses el perejil.
- **En la preparación, no en el pase.** El grueso del pesado se hace en la mise en place: raciones ya porcionadas, salsas ya dosificadas. En servicio solo montas.
- **Con herramientas, no con báscula.** Un cazo de 60 ml siempre echa 60 ml. Un dosificador de salsa, una cuchara de helado para las guarniciones, una manga. **Eso es pesar sin báscula** y es lo que hacen las cadenas que salen iguales en 300 locales.

**Cómo se hace bien:**
1. **Porciona en frío**, antes del servicio. Carne pesada y separada, salsas en biberón con marca.
2. **Usa siempre el mismo utensilio** para el mismo ingrediente.
3. **Comprueba de vez en cuando**: pesa una ración al azar y compárala con la ficha. Si te desvías, corriges antes de que sea un mes entero.

**En tu cocina esto pasa así:** el momento en que se descontrola no es el servicio, es **la mise en place hecha con prisa**. Si porcionas "más o menos", todo lo que salga esa noche va mal. Diez minutos de porcionado cuidadoso valen más que cualquier control posterior.

> **Dato de gestión** — El porcionado previo es la única forma realista de mantener el gramaje en hora punta. En cadenas grandes, el 100% de los ingredientes de coste alto salen preporcionados de la mise en place.$md$),

  (v_course_id, 4, 'Cómo se te escapa el margen sin que lo notes',
$md$Estas son las cinco formas en que un plato empieza a costar más de lo que debería. Ninguna es mala intención:

**1. La mano generosa.** Un poco más de queso, la salsa "hasta que cubra", el chorretón de aceite. Sumado, es lo que más pesa.

**2. La ficha desfasada.** Alguien cambió la receta hace tres meses y nadie lo llevó al papel. La oficina cree que cuesta 2,40 € y cuesta 3,10 €.

**3. El producto que se tira.** Lo que caduca, lo que se quema, lo que se cae. No aparece en ninguna ficha, pero se ha pagado igual.

**4. El plato que se rehace.** Un error obliga a hacerlo dos veces: **has pagado dos veces y cobras una**. Por eso importa acertar a la primera.

**5. El invitado silencioso.** El extra que no se cobra: la salsa aparte, el pan de más, la ración "un poco más grande" para un habitual. Puede ser una decisión comercial legítima — pero **tiene que ser una decisión, no un descuido**.

**Y aquí está el dato clave para entender por qué importa tanto:** en hostelería el margen es estrecho. Si un plato tiene un coste del 30% y se te va al 35%, no has perdido un 5% — has perdido **una parte enorme del beneficio de ese plato**, porque el beneficio es lo que queda después de todos los demás gastos.

**En tu cocina esto pasa así:** ninguno de estos cinco puntos se nota en un servicio. Se notan **a fin de mes**, cuando el número no cuadra y nadie sabe explicar por qué. Por eso se controla el gramaje día a día, no cuando llega el susto.

> **Dato de gestión** — La diferencia entre el consumo teórico (lo que las fichas dicen que deberías haber gastado según lo vendido) y el consumo real (lo que falta del almacén) es el indicador que revela estas pérdidas. En Folvy es el "Teórico vs Real" del módulo de Almacén.$md$),

  (v_course_id, 5, 'Teórico vs real: el chivato',
$md$Este es el concepto que convierte todo lo anterior en algo comprobable.

**Consumo teórico** = lo que las fichas dicen que deberías haber gastado, según lo que se ha vendido. Si vendiste 100 hamburguesas y cada una lleva 120 g de carne, deberías haber gastado 12 kg.

**Consumo real** = lo que de verdad falta del almacén, contando el inventario.

**La diferencia entre los dos es la pérdida.** Si gastaste 14 kg en vez de 12, faltan 2 kg y hay que explicar por qué.

Y ojo con esto, porque es lo importante: **una diferencia no significa que alguien haya hecho algo mal.** Las causas habituales son:
- Gramajes por encima de la ficha (la mano generosa).
- Merma no registrada: producto que se tiró y nadie anotó.
- Fichas desactualizadas.
- Errores en el conteo del inventario.
- Producto recibido de menos y no detectado en la recepción.

**Tu papel en esto es concreto y sencillo:** pesar según ficha, **registrar las mermas** (lo que se tira, se anota) y **contar bien** en el inventario. Con eso, las diferencias que salgan son reales y se pueden corregir. Sin eso, el número no dice nada.

**En tu cocina esto pasa así:** lo que más ensucia este indicador **no es robar: es no anotar**. Se cae una bandeja, se quema una tanda, se tira producto pasado — y nadie lo registra. Luego el sistema dice que faltan 3 kg y no hay forma de saber si es gramaje, merma o un error de conteo. **Anotar una merma no te delata: te defiende.**

> **Dato de gestión** — Un teórico vs real limpio permite distinguir un problema de gramaje de uno de merma o de conteo, que se arreglan de formas completamente distintas. Sin registro de mermas, el indicador solo dice "algo falla" sin decir qué.$md$),

  (v_course_id, 6, 'Qué se espera de ti',
$md$Resumido, y son cinco cosas concretas:

**1. Sigue la ficha.** Las cantidades que pone son las que hay que poner. Si crees que están mal —que el plato queda escaso, o que sobra producto— **dilo**, no lo corrijas por tu cuenta. Una ficha equivocada se cambia en dos minutos; un gramaje corregido en silencio no lo sabe nadie.

**2. Porciona antes del servicio.** Lo caro, pesado y separado en la mise en place.

**3. Registra las mermas.** Lo que se tira se anota. Siempre. Es lo que hace que los números signifiquen algo.

**4. Avisa cuando la receta cambie.** Si se cambia un ingrediente, un proveedor o una cantidad, la ficha tiene que enterarse. Si no, todos los cálculos que dependen de ella pasan a ser falsos.

**5. Cuenta bien en el inventario.** De memoria no vale. Un conteo aproximado ensucia el mes entero.

**Y una cosa que conviene decir claramente:** todo esto no va de controlar al cocinero. Va de que el negocio sepa lo que gana, para poder pagar sueldos, invertir y aguantar cuando suben los precios. Una cocina que controla sus gramajes puede permitirse mejor producto; una que no, acaba recortando calidad sin saber por qué.

**En tu cocina esto pasa así:** el equipo que mejor cumple las fichas no es el que más miedo tiene, es **el que entiende para qué sirven**. Si has llegado hasta aquí, ya lo entiendes.

**Antes de terminar**: mira la ficha técnica del plato que más veces haces. Comprueba si lo que pone coincide con lo que haces de verdad. Si no coincide, ahí tienes algo que avisar.

> **Dato de gestión** — En Folvy, la ficha técnica es la misma pieza que alimenta el coste del plato, los alérgenos declarados, el consumo teórico y las necesidades de compra. Un dato mal puesto en la ficha se propaga a los cuatro sitios.$md$);

  -- ═══ TEST SITUACIONAL ═════════════════════════════════════════════════════
  -- Correctas: c a d b c b a d b c

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 1, 'La ficha dice 30 g de queso, pero a ti te parece que el plato queda escaso y sueles poner 40 g. ¿Qué haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Sigo poniendo 40 g: el cliente lo agradece y son solo 10 gramos.', false, 'A 50 platos al día son más de 2.000 € al año de un solo ingrediente.'),
   (v_q, 'Pongo 40 g solo cuando el cliente parece habitual.', false, 'Además del coste, el plato deja de salir igual siempre.'),
   (v_q, 'Sigo la ficha y aviso de que creo que se queda escasa, para que se revise.', true, 'Correcto. Una ficha equivocada se cambia en dos minutos; un gramaje corregido en silencio no lo sabe nadie.'),
   (v_q, 'Cambio yo la ficha a 40 g.', false, 'La ficha se cambia con criterio de coste y precio de venta, no unilateralmente en cocina.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 2, '¿Sobre qué cantidad se calcula el coste de un plato?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Sobre la cantidad bruta: lo que has tenido que comprar, incluyendo lo que se pierde al limpiar o pelar.', true, 'Correcto. Es lo que realmente has pagado.'),
   (v_q, 'Sobre la cantidad neta: lo que acaba en el plato.', false, 'La neta no incluye lo que se pierde, y eso también se ha pagado.'),
   (v_q, 'Sobre el precio de venta menos el IVA.', false, 'Eso es el ingreso, no el coste.'),
   (v_q, 'Sobre la media de lo que gasta cada cocinero.', false, 'Sería un promedio de descontrol, no un coste.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 3, 'Se te cae al suelo una bandeja de producto ya preparado. ¿Qué haces además de tirarlo?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Nada más: ya está tirado, no hay que darle vueltas.', false, 'Sin registrar, esa pérdida aparecerá luego como un descuadre inexplicable.'),
   (v_q, 'Lo comento de palabra al encargado y ya está.', false, 'De palabra se pierde: al final de mes nadie lo recuerda.'),
   (v_q, 'Lo apunto solo si es una cantidad grande.', false, 'Las pequeñas repetidas son las que más ensucian el indicador.'),
   (v_q, 'Lo registro como merma: lo que se tira se anota siempre.', true, 'Correcto. Anotar una merma no te delata: te defiende. Sin registro, el sistema no sabe si fue gramaje, merma o conteo.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 4, '¿Cuál es la mejor forma de mantener el gramaje en plena hora punta?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Pesar cada ingrediente en el momento de montar el plato.', false, 'Inviable en servicio, y por eso se acaba abandonando.'),
   (v_q, 'Porcionar en la mise en place y usar siempre el mismo utensilio (cazo, dosificador, cuchara).', true, 'Correcto. Es lo que hacen las cadenas que salen iguales en cientos de locales.'),
   (v_q, 'Calcular a ojo, que con experiencia se acierta.', false, 'Sale bueno, pero no sale igual. Y ahí se va el margen.'),
   (v_q, 'Pesar solo cuando viene el encargado.', false, 'El control no es para el encargado: es para que el plato salga igual.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 5, 'El sistema dice que deberíais haber gastado 12 kg de carne y faltan 14 kg. ¿Qué significa?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Que alguien ha robado producto.', false, 'Es la conclusión más precipitada y casi nunca la causa.'),
   (v_q, 'Que el sistema está mal calculado.', false, 'Puede ser, pero es lo último que hay que asumir.'),
   (v_q, 'Que hay 2 kg de diferencia que hay que explicar: puede ser gramaje, merma no registrada, ficha desactualizada o error de conteo.', true, 'Correcto. Una diferencia señala dónde mirar, no a quién culpar.'),
   (v_q, 'Que hay que subir el precio del plato.', false, 'Primero hay que saber por qué se ha ido el consumo.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 6, 'Se ha cambiado el proveedor del pan y el nuevo pesa más. ¿Hay que hacer algo?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'No, mientras el plato quede bien.', false, 'El coste habrá cambiado sin que nadie lo sepa.'),
   (v_q, 'Sí: avisar para que se actualice la ficha, porque el coste del plato cambia.', true, 'Correcto. Una ficha desfasada hace que la oficina tome decisiones con números falsos.'),
   (v_q, 'Solo si el pan es más caro.', false, 'También cambia si es más barato: el margen real deja de ser el que se cree.'),
   (v_q, 'Se actualiza al final de temporada, con todo junto.', false, 'Mientras tanto, todos los cálculos que dependen de esa ficha son erróneos.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 7, 'Un plato sale mal y hay que rehacerlo entero. ¿Qué ha pasado en términos de coste?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Se ha pagado el producto dos veces y se cobra una sola.', true, 'Correcto. Por eso acertar a la primera es también una cuestión de margen.'),
   (v_q, 'No pasa nada: el segundo plato sí se cobra.', false, 'Se cobra uno, pero se ha consumido producto para dos.'),
   (v_q, 'Solo importa si el producto era caro.', false, 'Importa siempre; con producto caro simplemente duele más.'),
   (v_q, 'Se compensa con el siguiente plato.', false, 'No se compensa: es producto consumido que nadie ha pagado.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 8, '¿Qué ingredientes conviene pesar con más cuidado?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Todos por igual, sin excepción.', false, 'Inviable en la práctica, y por eso se acaba no pesando nada.'),
   (v_q, 'Los que más volumen ocupan.', false, 'El volumen no tiene relación con el coste.'),
   (v_q, 'Los que se acaban antes.', false, 'La rotación no indica dónde está el dinero.'),
   (v_q, 'Los caros: carne, pescado, queso, marisco. Ahí están los euros.', true, 'Correcto. Nadie te pide que peses el perejil.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 9, 'Un cliente habitual pide "un poco más de guarnición" y se la pones sin cobrarla.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Está mal: nunca se da nada sin cobrar.', false, 'Puede ser una decisión comercial perfectamente válida.'),
   (v_q, 'Puede estar bien como decisión comercial, pero tiene que ser una decisión conocida, no un descuido repetido.', true, 'Correcto. El problema no es el detalle: es que nadie sepa que está ocurriendo.'),
   (v_q, 'Da igual: la guarnición es lo más barato del plato.', false, 'Repetido cada día y en cada turno, deja de ser barato.'),
   (v_q, 'Está bien siempre que el cliente sea habitual.', false, 'Ser habitual no cambia que el producto tiene un coste que alguien asume.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 10, '¿Para qué sirve realmente la ficha técnica, además de para calcular el coste?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Para justificar el precio de la carta ante el cliente.', false, 'El cliente no ve las fichas.'),
   (v_q, 'Para controlar el trabajo de cada cocinero.', false, 'No es una herramienta de control individual.'),
   (v_q, 'Para que el plato salga igual siempre, en cualquier local y con cualquier persona de la partida.', true, 'Correcto. Y además alimenta alérgenos, consumo teórico y necesidades de compra.'),
   (v_q, 'Para cumplir con Sanidad.', false, 'La ficha de alérgenos es otra cosa; el escandallo es de gestión.');

  raise notice 'Curso de escandallo sembrado (draft, cocina). id: %', v_course_id;
end
$seed$;

-- ── VERIFICACIÓN (POR SEPARADO) ────────────────────────────────────────────
-- select c.code, c.status, c.category,
--   (select count(*) from course_section  s where s.course_id=c.id) as secciones,
--   (select count(*) from course_question q where q.course_id=c.id) as preguntas,
--   (select count(*) from course_option o join course_question q2 on q2.id=o.question_id
--     where q2.course_id=c.id and o.is_correct) as correctas
-- from course c where c.code='escandallo_fichas_tecnicas' and c.account_id is null;
-- Esperado: draft · cocina · 6 secciones · 10 preguntas · 10 correctas.
