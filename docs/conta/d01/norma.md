# D01 · La norma, citada literal desde la fuente oficial

Escrito por `scripts/conta/d01/norma.mjs` desde los textos oficiales de
`docs/conta/fuentes/textos/`, que baja `fuentes-oficiales-conta.yml` desde
Actions (BOE, datos abiertos de legislación consolidada) con su sha256 en
`registro.json`. De cada artículo, **la versión vigente** y el apartado que
usa Folvy. Nada de memoria: si el texto no está, el guion falla.


## RD 1619/2012, art. 6.1

*Para qué:* Lo que tiene que traer una factura completa: número, fecha, NIF del emisor y del destinatario, base, tipo y cuota. La lectura dice cuál falta (`_shared/lecturaFactura.ts`).

*Fuente:* Real Decreto 1619/2012, Reglamento de facturación · versión vigente desde 2023-12-07 (BOE-A-2023-24840) · [https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696](https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696) · sha256 del texto `3c0252c34935fa42…`

> 1. Toda factura y sus copias contendrán los datos o requisitos que se citan a continuación, sin perjuicio de los que puedan resultar obligatorios a otros efectos y de la posibilidad de incluir cualesquiera otras menciones:
> a) Número y, en su caso, serie. La numeración de las facturas dentro de cada serie será correlativa.
> Se podrán expedir facturas mediante series separadas cuando existan razones que lo justifiquen y, entre otros supuestos, cuando el obligado a su expedición cuente con varios establecimientos desde los que efectúe sus operaciones y cuando el obligado a su expedición realice operaciones de distinta naturaleza.
> No obstante, será obligatoria, en todo caso, la expedición en series específicas de las facturas siguientes:
> 1.º Las expedidas por los destinatarios de las operaciones o por terceros a que se refiere el artículo 5, para cada uno de los cuales deberá existir una serie distinta.
> 2.º Las rectificativas.
> 3.º Las que se expidan conforme a la disposición adicional quinta del Reglamento del Impuesto sobre el Valor Añadido, aprobado por el artículo 1 del Real Decreto 1624/1992, de 29 de diciembre.
> 4.º Las que se expidan conforme a lo previsto en el artículo 84, apartado uno, número 2.º, letra g), de la Ley 37/1992, de 28 de diciembre, del Impuesto sobre el Valor Añadido.
> 5.º Las que se expidan conforme a lo previsto en el artículo 61 quinquies, apartado 2 del Reglamento del Impuesto sobre el Valor Añadido, aprobado por el artículo 1 del Real Decreto 1624/1992, de 29 de diciembre.
> b) La fecha de su expedición.
> c) Nombre y apellidos, razón o denominación social completa, tanto del obligado a expedir factura como del destinatario de las operaciones.
> d) Número de Identificación Fiscal atribuido por la Administración tributaria española o, en su caso, por la de otro Estado miembro de la Unión Europea, con el que ha realizado la operación el obligado a expedir la factura.
> Asimismo, será obligatoria la consignación del Número de Identificación Fiscal del destinatario en los siguientes casos:
> 1.º Que se trate de una entrega de bienes destinados a otro Estado miembro que se encuentre exenta conforme al artículo 25 de la Ley del Impuesto.
> 2.º Que se trate de una operación cuyo destinatario sea el sujeto pasivo del Impuesto correspondiente a aquélla.
> 3.º Que se trate de operaciones que se entiendan realizadas en el territorio de aplicación del Impuesto y el empresario o profesional obligado a la expedición de la factura haya de considerarse establecido en dicho territorio.
> e) Domicilio, tanto del obligado a expedir factura como del destinatario de las operaciones.
> Cuando el obligado a expedir factura o el destinatario de las operaciones dispongan de varios lugares fijos de negocio, deberá indicarse la ubicación de la sede de actividad o establecimiento al que se refieran aquéllas en los casos en que dicha referencia sea relevante para la determinación del régimen de tributación correspondiente a las citadas operaciones.
> f) Descripción de las operaciones, consignándose todos los datos necesarios para la determinación de la base imponible del Impuesto, tal y como ésta se define por los artículos 78 y 79 de la Ley del Impuesto, correspondiente a aquéllas y su importe, incluyendo el precio unitario sin Impuesto de dichas operaciones, así como cualquier descuento o rebaja que no esté incluido en dicho precio unitario.
> g) El tipo impositivo o tipos impositivos, en su caso, aplicados a las operaciones.
> h) La cuota tributaria que, en su caso, se repercuta, que deberá consignarse por separado.
> i) La fecha en que se hayan efectuado las operaciones que se documentan o en la que, en su caso, se haya recibido el pago anticipado, siempre que se trate de una fecha distinta a la de expedición de la factura.
> j) En el supuesto de que la operación que se documenta en una factura esté exenta del Impuesto, una referencia a las disposiciones correspondientes de la Directiva 2006/112/CE, de 28 de noviembre, relativa al sistema común del Impuesto sobre el Valor Añadido, o a los preceptos correspondientes de la Ley del Impuesto o indicación de que la operación está exenta.
> Lo dispuesto en esta letra se aplicará asimismo cuando se documenten varias operaciones en una única factura y las circunstancias que se han señalado se refieran únicamente a parte de ellas.
> k) En las entregas de medios de transporte nuevos a que se refiere el artículo 25 de la Ley del Impuesto, sus características, la fecha de su primera puesta en servicio y las distancias recorridas u horas de navegación o vuelo realizadas hasta su entrega.
> l) En caso de que sea el adquirente o destinatario de la entrega o prestación quien expida la factura en lugar del proveedor o prestador, de conformidad con lo establecido en el artículo 5 de este Reglamento, la mención «facturación por el destinatario».
> m) En el caso de que el sujeto pasivo del Impuesto sea el adquirente o el destinatario de la operación, la mención «inversión del sujeto pasivo».
> n) En caso de aplicación del régimen especial de las agencias de viajes, la mención «régimen especial de las agencias de viajes».
> o) En caso de aplicación del régimen especial de los bienes usados, objetos de arte, antigüedades y objetos de colección, la mención «régimen especial de los bienes usados», «régimen especial de los objetos de arte» o «régimen especial de las antigüedades y objetos de colección».
> p) En el caso de aplicación del régimen especial del criterio de caja la mención «régimen especial del criterio de caja.

## RD 1619/2012, art. 7.2

*Para qué:* El ticket (simplificada) solo deduce si trae el NIF y el domicilio del destinatario y la cuota aparte: por eso sale «probable», con su aviso.

*Fuente:* Real Decreto 1619/2012, Reglamento de facturación · versión vigente desde 2023-12-07 (BOE-A-2023-24840) · [https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696](https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696) · sha256 del texto `3c0252c34935fa42…`

> 2. A efectos de lo dispuesto en el artículo 97.Uno de la Ley del Impuesto, cuando el destinatario de la operación sea un empresario o profesional y así lo exija, el expedidor de la factura simplificada deberá hacer constar, además, los siguientes datos:
> a) Número de Identificación Fiscal atribuido por la Administración tributaria española o, en su caso, por la de otro Estado miembro de la Unión Europea, así como el domicilio del destinatario de las operaciones.
> b) La cuota tributaria que, en su caso, se repercuta, que deberá consignarse por separado.

## RD 1619/2012, art. 15

*Para qué:* La rectificativa: «dice qué factura rectifica» (la lectura lo pide; sin él, duda).

*Fuente:* Real Decreto 1619/2012, Reglamento de facturación · versión vigente desde 2018-01-01 (BOE-A-2017-15843) · [https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696](https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696) · sha256 del texto `3c0252c34935fa42…`

> 1. Deberá expedirse una factura rectificativa en los casos en que la factura original no cumpla alguno de los requisitos que se establecen en los artículos 6 ó 7, sin perjuicio de lo establecido en el apartado 6 de este artículo.
> 2. Igualmente, será obligatoria la expedición de una factura rectificativa en los casos en que las cuotas impositivas repercutidas se hubiesen determinado incorrectamente o se hubieran producido las circunstancias que, según lo dispuesto en el artículo 80 de la Ley del Impuesto, dan lugar a la modificación de la base imponible.
> No obstante, cuando la modificación de la base imponible sea consecuencia de la devolución de mercancías o de envases y embalajes que se realicen con ocasión de un posterior suministro que tenga el mismo destinatario y por la operación en la que se entregaron se hubiese expedido factura, no será necesaria la expedición de una factura rectificativa, sino que se podrá practicar la rectificación en la factura que se expida por dicho suministro, restando el importe de las mercancías o de los envases y embalajes devueltos del importe de dicha operación posterior. La rectificación se podrá realizar de este modo siempre que el tipo impositivo aplicable a todas las operaciones sea el mismo, con independencia de que su resultado sea positivo o negativo.

## Ley 37/1992, art. 97.Uno

*Para qué:* Sin la factura (completa) no se deduce el IVA: lo que no la trae no se apunta como seguro.

*Fuente:* Ley 37/1992, del Impuesto sobre el Valor Añadido · versión vigente desde 2011-01-01 (BOE-A-2010-19703) · [https://www.boe.es/buscar/act.php?id=BOE-A-1992-28740](https://www.boe.es/buscar/act.php?id=BOE-A-1992-28740) · sha256 del texto `338837e46f78af94…`

> Uno. Sólo podrán ejercitar el derecho a la deducción los empresarios o profesionales que estén en posesión del documento justificativo de su derecho.
> A estos efectos, únicamente se considerarán documentos justificativos del derecho a la deducción:
> 1.º La factura original expedida por quien realice la entrega o preste el servicio o, en su nombre y por su cuenta, por su cliente o por un tercero, siempre que, para cualquiera de estos casos, se cumplan los requisitos que se establezcan reglamentariamente.
> 2.º La factura original expedida por quien realice una entrega que dé lugar a una adquisición intracomunitaria de bienes sujeta al impuesto, siempre que dicha adquisición esté debidamente consignada en la declaración-liquidación a que se refiere el número 6.º del apartado uno del artículo 164 de esta ley.
> 3.º En el caso de las importaciones, el documento en el que conste la liquidación practicada por la Administración o, si se trata de operaciones asimiladas a las importaciones, la autoliquidación en la que se consigne el Impuesto devengado con ocasión de su realización.
> 4.º La factura original o el justificante contable de la operación expedido por quien realice una entrega de bienes o una prestación de servicios al destinatario, sujeto pasivo del Impuesto, en los supuestos a que se refieren los números 2.º, 3.º y 4.º del apartado uno del artículo 84 y el artículo 140 quinque de esta Ley, siempre que dicha entrega o prestación esté debidamente consignada en la declaración-liquidación a que se refiere el número 6.º del apartado uno del artículo 164 de esta Ley.
> Cuando quien realice la entrega de bienes o la prestación de servicios esté establecido en la Comunidad, la factura original a que se refiere el párrafo anterior deberá contener los requisitos recogidos en el artículo 226 de la Directiva 2006/112/CE, del Consejo, de 28 de noviembre de 2006, relativa al sistema común del impuesto sobre el valor añadido.
> 5.º El recibo original firmado por el titular de la explotación agrícola, forestal, ganadera o pesquera a que se refiere el artículo 134, apartado tres, de esta ley.

## Ley 37/1992, art. 99.Tres

*Para qué:* Cuatro años para deducir: una factura de hace más de cuatro años sale en duda.

*Fuente:* Ley 37/1992, del Impuesto sobre el Valor Añadido · versión vigente desde 2012-10-31 (BOE-A-2012-13416) · [https://www.boe.es/buscar/act.php?id=BOE-A-1992-28740](https://www.boe.es/buscar/act.php?id=BOE-A-1992-28740) · sha256 del texto `338837e46f78af94…`

> Tres. El derecho a la deducción solo podrá ejercitarse en la declaración-liquidación relativa al periodo de liquidación en que su titular haya soportado las cuotas deducibles o en las de los sucesivos, siempre que no hubiera transcurrido el plazo de cuatro años, contados a partir del nacimiento del mencionado derecho.
> Sin embargo, en caso de declaración de concurso, el derecho a la deducción de las cuotas soportadas con anterioridad a la misma, que estuvieran pendientes de deducir, deberá ejercitarse en la declaración-liquidación correspondiente al periodo de liquidación en el que se hubieran soportado.
> Cuando no se hubieran incluido las cuotas soportadas deducibles a que se refiere el párrafo anterior en dichas declaraciones-liquidaciones, y siempre que no hubiera transcurrido el plazo de cuatro años, contados a partir del nacimiento del derecho a la deducción de tales cuotas, el concursado o, en los casos previstos por el artículo 86.3 de la Ley Concursal, la administración concursal, podrá deducirlas mediante la rectificación de la declaración-liquidación relativa al periodo en que fueron soportadas.
> Cuando hubiese mediado requerimiento de la Administración o actuación inspectora, serán deducibles, en las liquidaciones que procedan, las cuotas soportadas que estuviesen debidamente contabilizadas en los libros registros establecidos reglamentariamente para este Impuesto, mientras que las cuotas no contabilizadas serán deducibles en la declaración-liquidación del periodo correspondiente a su contabilización o en las de los siguientes. En todo caso, unas y otras cuotas solo podrán deducirse cuando no haya transcurrido el plazo a que se refiere el primer párrafo.
> En el supuesto de las ventas ocasionales a que se refiere el artículo 5, apartado uno, letra e), de esta Ley, el derecho a la deducción solo podrá ejercitarse en la declaración relativa al periodo en que se realice la entrega de los correspondientes medios de transporte nuevos.

## Ley 37/1992, art. 161

*Para qué:* Los tipos del recargo de equivalencia: `RECARGO_POR_TIPO` (21 % → 5,2; 10 % → 1,4; 4 % → 0,5).

*Fuente:* Ley 37/1992, del Impuesto sobre el Valor Añadido · versión vigente desde 2012-07-15 (BOE-A-2012-9364) · [https://www.boe.es/buscar/act.php?id=BOE-A-1992-28740](https://www.boe.es/buscar/act.php?id=BOE-A-1992-28740) · sha256 del texto `338837e46f78af94…`

> Artículo 161. Tipos.
> Los tipos del recargo de equivalencia serán los siguientes:
> 1.º Con carácter general, el 5,2 por ciento.
> 2.º Para las entregas de bienes a las que resulte aplicable el tipo impositivo establecido en el artículo 91, apartado uno de esta Ley, el 1,4 por ciento.
> 3.º Para las entregas de bienes a las que sea aplicable el tipo impositivo previsto en el artículo 91, apartado dos de esta Ley, el 0,50 por ciento.
> 4.º Para las entregas de bienes objeto del Impuesto Especial sobre las Labores del Tabaco, el 1,75 por ciento.
> Téngase en cuenta que esta última actualización del artículo surte efectos desde el 1 de septiembre de 2012.
> Se modifica, con efectos desde el 1 de septiembre de 2012, por el art. 23.5 del Real Decreto-ley 20/2012, de 13 de julio. Ref. BOE-A-2012-9364.
> Se modifica por el art. 10.15 de la Ley 13/1996, de 30 de diciembre. Ref. BOE-A-1996-29117

## RD 1624/1992, art. 64.1 y 4

*Para qué:* El libro registro de facturas recibidas: numeradas y una por una, con lo que se anota de cada una.

*Fuente:* Real Decreto 1624/1992, Reglamento del IVA · versión vigente desde 2018-01-01 (BOE-A-2017-15843) · [https://www.boe.es/buscar/act.php?id=BOE-A-1992-28925](https://www.boe.es/buscar/act.php?id=BOE-A-1992-28925) · sha256 del texto `2857accc8d893350…`

> 1. Los empresarios o profesionales, a los efectos del Impuesto sobre el Valor Añadido, deberán numerar correlativamente todas las facturas, justificantes contables y documentos de Aduanas correspondientes a los bienes adquiridos o importados y a los servicios recibidos en el desarrollo de su actividad empresarial o profesional. Esta numeración podrá realizarse mediante series separadas siempre que existan razones objetivas que lo justifiquen.
> 4. En el libro registro de facturas recibidas se anotarán, una por una, las facturas recibidas y, en su caso, los documentos de aduanas y los demás indicados anteriormente. Se consignarán su número de recepción, la fecha de expedición, la fecha de realización de las operaciones, en caso de que sea distinta de la anterior y así conste en el citado documento, el nombre y apellidos, razón social o denominación completa y número de identificación fiscal del obligado a su expedición, la base imponible, determinada conforme a los artículos 78 y 79 de la Ley del Impuesto, y, en su caso, el tipo impositivo, la cuota tributaria y si la operación se encuentra afectada por el régimen especial del criterio de caja, en cuyo caso se deberán incluir las menciones a que se refiere el apartado 2 del artículo 61 decies de este Reglamento.
> En el caso de las facturas a que se refiere el párrafo segundo del apartado 2 de este artículo, las cuotas tributarias correspondientes a las adquisiciones intracomunitarias de bienes a que den lugar las entregas en ellas documentadas habrán de calcularse y consignarse en la anotación relativa a dichas facturas.
> Igualmente, en el caso de las facturas o, en su caso, de los justificantes contables a que se refiere el párrafo tercero del apartado 2 de este artículo, las cuotas tributarias correspondientes a las entregas de bienes o prestaciones de servicios en ellas documentadas, habrán de calcularse y consignarse en la anotación relativa a dichas facturas o justificantes contables.
> En el caso de las personas y entidades a que se refiere el artículo 62.6 de este Reglamento, se incluirá además la siguiente información:
> a) Número y, en su caso, serie que figure en la factura, que sustituirá al número de recepción utilizado por quienes no estén incluidos en el artículo 62.6 de este Reglamento.
> b) Identificación, en su caso, de si se trata de una rectificación registral a que se refiere el artículo 70 de este Reglamento.
> c) Descripción de las operaciones.
> d) Las menciones a que se refieren el apartado 2 del artículo 61 quinquies de este Reglamento y las letras l) a p) del apartado 1 del artículo 6 del Reglamento por el que se regulan las obligaciones de facturación, aprobado por el Real Decreto 1619/2012, de 30 de noviembre, y si se trata de una adquisición intracomunitaria de bienes.
> e) Cuota tributaria deducible correspondiente al periodo de liquidación en que se realiza la anotación. La regularización de la deducción, en su caso, se realizará de acuerdo con lo dispuesto en los artículos 105.Cuatro, 109, 110, 111 y 112 de la Ley del Impuesto, según corresponda, sin que ello implique la modificación de la cuota deducible registrada.
> f) Periodo de liquidación en el que se registran las operaciones a que se refieren las facturas recibidas.
> g) En el caso de las operaciones a las que sea de aplicación el Régimen especial de los bienes usados, objetos de arte, antigüedades y objetos de colección, deberá consignar el importe total de la operación.
> h) En el supuesto de las operaciones a las que sea de aplicación el Régimen especial de las agencias de viajes deberá consignar el importe total de la operación.
> En el supuesto de operaciones de importación, se consignará la fecha de contabilización de la operación y el número del correspondiente documento aduanero.
> El Ministro de Hacienda y Función Pública podrá mediante Orden ministerial determinar que junto a lo anterior se incluya aquella otra información con transcendencia tributaria a que se refieren los artículos 33 a 36 del Reglamento General de las actuaciones y los procedimientos de gestión e inspección tributaria y de desarrollo de las normas comunes de los procedimientos de aplicación de los tributos, aprobado por el Real Decreto 1065/2007, de 27 de julio.

## Código de Comercio, art. 30.1

*Para qué:* Conservar la documentación seis años: el PDF se guarda en conta-documentos y no se borra.

*Fuente:* Código de Comercio · versión vigente desde 1996-11-01 (BOE-A-1885-6627) · [https://www.boe.es/buscar/act.php?id=BOE-A-1885-6627](https://www.boe.es/buscar/act.php?id=BOE-A-1885-6627) · sha256 del texto `86c0aaafc35c2e29…`

> 1. Los empresarios conservarán los libros, correspondencia, documentación y justificantes concernientes a su negocio, debidamente ordenados, durante seis años, a partir del último asiento realizado en los libros, salvo lo que se establezca por disposiciones generales o especiales.

## Ley 58/2003 (LGT), art. 66

*Para qué:* Cuatro años de prescripción: el plazo fiscal, dentro de los seis del Código de Comercio.

*Fuente:* Ley 58/2003, General Tributaria · versión vigente desde 2004-07-01 (BOE-A-2003-23186) · [https://www.boe.es/buscar/act.php?id=BOE-A-2003-23186](https://www.boe.es/buscar/act.php?id=BOE-A-2003-23186) · sha256 del texto `1b737a8f7074e61e…`

> Artículo 66. Plazos de prescripción.
> Prescribirán a los cuatro años los siguientes derechos:
> a) El derecho de la Administración para determinar la deuda tributaria mediante la oportuna liquidación.
> b) El derecho de la Administración para exigir el pago de las deudas tributarias liquidadas y autoliquidadas.
> c) El derecho a solicitar las devoluciones derivadas de la normativa de cada tributo, las devoluciones de ingresos indebidos y el reembolso del coste de las garantías.
> d) El derecho a obtener las devoluciones derivadas de la normativa de cada tributo, las devoluciones de ingresos indebidos y el reembolso del coste de las garantías.

## Ley 3/2004, art. 4.1 y 4.3

*Para qué:* Sin plazo pactado, 30 días; pactado, nunca más de 60: un vencimiento a más de 60 días sale con aviso (C01b y D01).

*Fuente:* Ley 3/2004, de medidas de lucha contra la morosidad en las operaciones comerciales · versión vigente desde 2013-07-28 (BOE-A-2013-8187) · [https://www.boe.es/buscar/act.php?id=BOE-A-2004-21830](https://www.boe.es/buscar/act.php?id=BOE-A-2004-21830) · sha256 del texto `0ab8de34f8d956eb…`

> 1. El plazo de pago que debe cumplir el deudor, si no hubiera fijado fecha o plazo de pago en el contrato, será de treinta días naturales después de la fecha de recepción de las mercancías o prestación de los servicios, incluso cuando hubiera recibido la factura o solicitud de pago equivalente con anterioridad.
> Los proveedores deberán hacer llegar la factura o solicitud de pago equivalente a sus clientes antes de que se cumplan quince días naturales a contar desde la fecha de recepción efectiva de las mercancías o de la prestación de los servicios.
> Cuando en el contrato se hubiera fijado un plazo de pago, la recepción de la factura por medios electrónicos producirá los efectos de inicio del cómputo de plazo de pago, siempre que se encuentre garantizada la identidad y autenticidad del firmante, la integridad de la factura, y la recepción por el interesado.
> 3. Los plazos de pago indicados en los apartados anteriores podrán ser ampliados mediante pacto de las partes sin que, en ningún caso, se pueda acordar un plazo superior a 60 días naturales.

## Orden EHA/962/2007, art. 7.1 y 7.2

*Para qué:* Prescindir del papel solo con digitalización certificada: software homologado por la AEAT, cada imagen firmada y la base de datos firmada al cierre de cada periodo. Folvy no lo es: la pantalla nunca dice que se pueda tirar el papel, y el PDF se guarda como copia.

*Fuente:* Orden EHA/962/2007, digitalización certificada de facturas (D01; ELI https://www.boe.es/eli/es/o/2007/04/10/eha962) · texto publicado (no está consolidada) · [https://www.boe.es/diario_boe/txt.php?id=BOE-A-2007-7866](https://www.boe.es/diario_boe/txt.php?id=BOE-A-2007-7866) · sha256 del texto `002a95e7af9a3a4f…`

*Ojo:* la Orden se dictó bajo el Real Decreto 1496/2003 (Reglamento de facturación), hoy sustituido por el Real Decreto 1619/2012. Sus remisiones a aquel se leen hechas a este, por la disposición adicional quinta del Real Decreto 1619/2012 (texto consolidado, en el mismo registro):

> Las referencias hechas al Reglamento por el que se regulan las obligaciones de facturación aprobado por el Real Decreto 1496/2003, de 28 de noviembre, se entenderán realizadas a este Reglamento.

*La Orden:*

> Artículo 7. Digitalización certificada de facturas recibidas y documentos sustitutivos recibidos y de otros documentos o justificantes.
> 1. Los obligados tributarios podrán proceder a la digitalización certificada de las facturas, documentos sustitutivos y de cualesquiera otros documentos que conserven en papel que tengan el carácter de originales.
> Las facturas, documentos sustitutivos y otros documentos así digitalizados permitirán que el obligado tributario pueda prescindir de los originales en papel que les sirvieron de base. 2. Se entiende por digitalización certificada el proceso tecnológico que permite, mediante la aplicación de técnicas fotoelectrónicas o de escáner, convertir la imagen contenida en un documento en papel en una imagen digital codificada conforme a alguno de los formatos estándares de uso común y con un nivel de resolución que sean admitidos por la Agencia Estatal de Administración Tributaria. Este proceso de digitalización deberá cumplir los siguientes requisitos:
> a) Que el proceso de digitalización sea realizado por el propio obligado tributario o bien por un tercero prestador de servicios de digitalización, en nombre y por cuenta de aquél, utilizando en ambos casos un software de digitalización certificado en los términos del apartado 3 de este mismo artículo.
> b) Que el proceso de digitalización utilizado garantice la obtención de una imagen fiel e íntegra de cada documento digitalizado y que esta imagen digital sea firmada con firma electrónica en los términos de los artículos anteriores de esta Orden en base a un certificado electrónico instalado en el sistema de digitalización e invocado por el software de digitalización certificada. Este certificado debe corresponder al obligado tributario cuando la digitalización certificada se realice por el mismo o al prestador de servicios de digitalización en otro caso. Uno u otro, según corresponda, deberá disponer de los procedimientos y controles necesarios para garantizar la fidelidad del proceso de digitalización certificada. c) Que el resultado de la digitalización certificada se organice en torno a una base de datos documental y que por cada documento digitalizado se conserve un registro de datos con todos los campos exigibles en la llevanza de los libros de registros incluidos en los artículos 62 y siguientes del Real Decreto 1624/1992, de 29 de diciembre, además de un campo en el que se contenga la imagen binaria del documento digitalizado o que enlace al fichero que la contenga, en ambos casos con la firma electrónica de la imagen del documento conforme a como se indica en la letra b). d) Que el obligado a la conservación disponga del software de digitalización certificado con las siguientes funcionalidades:
> 1.ª Firma de la base de datos que garantice la integridad de datos e imágenes al cierre de cada período de liquidación al que esté sometido el obligado tributario.
> 2.ª Acceso completo y sin demora injustificada a la base de datos. A estos efectos, se entiende por acceso completo aquél que posibilite una consulta en línea a los datos que permita la visualización de los documentos con todo el detalle de su contenido, la búsqueda selectiva por cualquiera de los datos que deban reflejarse en los libros registro regulados en el artículo 62 y siguientes del Real Decreto 1624/1992, de 29 de diciembre, la copia o descarga en línea en los formatos originales y la impresión a papel de aquellos documentos que sean necesarios a los efectos de la verificación o documentación de las actuaciones de control fiscal.

## Resolución de la AEAT de 24/10/2007 (homologación)

*Para qué:* Cómo se homologa ese software (y qué garantiza: imagen fiel e íntegra firmada y base de datos documental). Mientras Folvy no esté homologado, no hay digitalización certificada.

*Fuente:* Resolución de 24/10/2007 de la AEAT, homologación del software de digitalización certificada (D01) · texto publicado (no está consolidada) · [https://www.boe.es/diario_boe/txt.php?id=BOE-A-2007-18911](https://www.boe.es/diario_boe/txt.php?id=BOE-A-2007-18911) · sha256 del texto `4c37b22d5c267403…`

> Para ello es necesario, además de un software de digitalización certificado, que el proceso de digitalización garantice una imagen fiel e íntegra de cada documento firmada con firma electrónica, así como la organización de la digitalización en torno a una base de datos documental con determinadas garantías, tanto para ésta como para su conservación.
