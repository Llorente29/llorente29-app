# D01 · Facturas recibidas · Tareas 2 a 5 (parada antes de la 6)

Rama `conta/d01-recibidas`, desde `main` 9f9f5791. Prefijo `20261021T`.
Respuesta D01_1: «Tareas 2 a 5 sin parar salvo bloqueo. Para antes de la 6 con:
la lectura funcionando sobre facturas inventadas de varios formatos; el correo
probado en staging; una factura recibida enviada a C0009 y leída de vuelta,
para medir la serie 2.»

Las tres condiciones, una a una, con lo medido y lo que **no** se ha podido
medir desde aquí.

## 1 · La lectura sobre facturas inventadas de varios formatos

- **Núcleo:** `supabase/functions/_shared/lecturaFactura.ts` (`leerFactura`,
  `buscarRepetida`, `claveNumero`, `normalizarNif`, `PROMPT_FACTURA`).
- **Pruebas:** `tests/conta/d01/lecturaFactura.test.ts`, sobre ocho formatos
  inventados:
  - mercancía a un tipo;
  - varios tipos con recargo de equivalencia;
  - profesional con retención del 15 %;
  - alquiler con retención del 19 % mal calculada;
  - rectificativa;
  - ticket simplificado;
  - sin desglose en el papel (las bases salen de las líneas);
  - intracomunitaria al 0 % con NIF de la UE.

  Más seis casos de lo que no puede pasar sin decirlo: mal sumada, cuota que no
  es base × tipo, sin NIF con IVA, sin número, fecha o total, fechas imposibles
  o lejanas, y manuscrita. Mutación comprobada: quitar la suma o la fecha de la
  regla «posible» hace fallar la prueba.
- **`ocr-albaran`, modo «factura»:**
  - Sin `modo`, lo que devuelve a Cocina es byte a byte lo de antes. Lo fija
    `tests/conta/d01/ocrAlbaran.test.ts`: md5 del prompt antes y después, y los
    mismos ejemplos.
  - Con `modo: 'factura'`, añade al prompt `PROMPT_FACTURA` y guarda lo leído
    en `validation.factura`.
- **Lo que NO está probado: la lectura por el modelo de verdad sobre un PDF.**
  - Esta sesión no tiene clave de Anthropic, y los workflows tampoco.
  - Está probado todo lo que va **después** de que el modelo conteste, con
    respuestas inventadas de esos nueve formatos.
  - No está probado qué contesta el modelo ante un PDF real.
  - Hay dos caminos, y decides tú:
    - (a) un secreto `ANTHROPIC_API_KEY` en un workflow de prueba que lea los
      PDF inventados del repositorio;
    - (b) la primera lectura en producción, después de fusionar, con una
      factura subida a mano.

## 2 · El correo probado en staging

- **En la base, en staging como lo llama la función** (como service_role):
  - El destino por dirección. La que no es de nadie queda apuntada y no se lee.
    La apagada, igual.
  - La llegada, con su huella. El mismo fichero dos veces da uno.
  - «Falta el PDF» cuando solo trae un enlace.
  - La factura que sale de lo leído: proveedor por NIF, bases por tipo, líneas
    y canal.
  - La repetida. El proveedor nuevo «Traída de factura · por completar».
  - B no ve nada de A.
  - Runs 38429935867 y 38432287604 (este último, ya con la 0230).
- **La parte de Resend, con dobles** (`tests/conta/d01/facturasEntrada.test.ts`,
  12 pruebas):
  - la firma svix (buena, otro cuerpo, sello viejo, sin cabeceras);
  - `to` y `cc`;
  - adjuntos PDF y fotos, dejando el logo de la firma y diciendo por qué;
  - enlaces solo https;
  - nunca dos veces el mismo correo.
- **Lo que NO está probado: un correo de verdad entrando por Resend.** Hacen
  falta el dominio `entrada.folvy.app` y desplegar la función, y las funciones
  solo se despliegan al fusionar. Los pasos exactos para ti están en
  `docs/conta/d01/pasos_resend.md`. Hasta entonces, en producción el correo
  está apagado: cada dirección nace con `active = false`.

## 3 · Una factura recibida a C0009, leída de vuelta (la serie 2)

### El molde (solo lectura)

Run 60 de `diez-prueba-c0009.yml`, con 1.432 recibidas de la serie 2 de la C0009
(tres meses):

- Serie 2, TipoAsiento 2, TipoFactura 1. El 6 y el 7 salen en los abonos, que
  son 31.
- Tipos de IVA por factura: 1.404 con un tipo, 19 con dos y 9 con tres. Nunca
  con recargo.
- Retención en 12 facturas: 19 %, cuenta 47510019.
- **Apuntes = las cuentas de gasto con su base; suman las bases en 1.432 de
  1.432.** La 472 y la 400/410 las pone Diez.
- **La 472 es una sola, 47200000, en todas**, aunque Folvy lleve una por tipo.
- CuentaCliente es la 400/410. CifCliente en 1.427, NombreCliente en todas.
- Descripción «número-nombre».
- Ninguna lleva analítica.
- La fecha del asiento es la de la factura en 833 casos y posterior en 599.
- Bases + cuotas − retención = total en 1.417. Las 15 que no cuadran tienen la
  forma `410H 472D 477H 629D`: inversión del sujeto pasivo.

### La cadena de Folvy

- `facturaProveedor` (la propuesta del libro, que ya existía) produce el
  asiento, y `facturaRecibida` (`_shared/diezRecibida.ts`, nuevo) lo convierte
  en la factura de Diez.
- Pruebas: `tests/conta/d01/diezRecibida.test.ts`.
- Lo no medido **no se manda y dice por qué**: retención (TipoRetencion sin
  descifrar), recargo, abonos, más de tres tipos, exenta, o una línea que una
  recibida no lleva.

### El envío y la lectura de vuelta

Run 63 (`[prueba-c0009:recibida]`): ver la sección «Resultado» al final.

## Lo que cambió por el camino, y por qué

1. **La regla de repetidas lleva el TOTAL** (0230). La primera versión, la
   0210, bloqueaba solo por número.
   - Medido contra los 179 albaranes reales de Foodint: el único número
     repetido entre los vivos es «01», de un proveedor que lo pone en dos
     albaranes de fecha e importe distintos. Con la 0210, el segundo no habría
     podido entrar.
   - El C01b ya lo había decidido así («número E importe»).
   - Ahora:
     - **repetida** (bloquea) = mismo proveedor + mismo número + mismo total;
     - **posible** (pregunta, no bloquea) = mismo número con otro total o sin
       total, o misma fecha y total con otro número.
   - La clave es una sola: `conta_clave_numero()` en la base y `claveNumero()`
     en el núcleo. Medida contra los 179 números: 0 números distintos de un
     mismo proveedor juntados, y los mismos 2 «no es número» que con la regla
     anterior.
2. **Compras y Supply llaman a la regla de la base.**
   - `lib/repetidas.ts` usa la clave común.
   - `findDuplicateInvoice` de Supply llama a `supplier_invoice_repetida`. Si
     es repetida, el aviso ya no ofrece «Crear de todos modos», porque la base
     no la dejaría entrar; dice que se marque «No es repetida» en la ficha. Si
     es posible, se puede crear.
3. **Lo aprendido de Diez** (0240, `conta_gasto_aprendido`).
   - En staging: «Las 2 facturas anteriores de este proveedor fueron a Compras
     de mercaderías · 60000000», segura.
   - Con una tercera a otra cuenta: «… fueron a 2 cuentas; la más reciente, a
     Otros servicios · 62900000 (1 de 3). Probable, no segura: confírmalo.»
   - Al confirmar, la pantalla (tarea 6) rellena «Sus facturas se apuntan en»
     con `company_account_link_set(…, 'gasto', …, 'aprendido_diez')`.
4. **El documento de la recibida** (0240, `conta_documento_factura_guardar`):
   kind `factura_recibida` en `conta-documentos`, con las mismas comprobaciones
   que el resumen de ventas. La prueba del R15 sigue pasando igual (run
   38435239940).

## Lo que queda de la tarea 5, dicho

- **El envío al validar no manda recibidas todavía.**
  - `conta-diez-enviar` y `diezEnviar.ts` siguen atados a las ventas.
  - Hay que darle a la recibida su lectura (como `conta_resumen_ventas`) y que
    use `facturaRecibida`.
  - El freno «sin documento no se envía» ya tiene la pieza:
    `conta_documento_factura_guardar`.
  - Lo hago al empezar la 6, porque el botón vive en N23.
- **`post_safe_invoices` («apunta solo lo seguro»):** el ajuste está en la base
  (0200); falta que la propuesta lo mire.
- **Foto → PDF al copiar a `conta-documentos`:** va en la subida de la
  pantalla.

## Ficheros compartidos que he tocado (cambio pequeño)

- `supabase/config.toml`: `[functions.conta-facturas-entrada] verify_jwt = false`.
- `supabase/functions/ocr-albaran/index.ts`: el núcleo pasa a
  `_shared/ocrAlbaranNucleo.ts` tal cual, y se añade el modo «factura». Sin
  modo, igual.
- `public.supplier_invoice`: su disparador de repetidas (0210 → 0230) y
  columnas nuevas que admiten nulos (0200).
- `src/modules/supply/services/supplierInvoiceService.ts` y
  `InvoiceScanPanel.tsx`: el aviso de repetida.
- `src/lib/rpcSinTipar.ts`: una línea en su inventario.
- `.github/workflows/diez-prueba-c0009.yml`: también corre en esta rama, con
  dos etiquetas nuevas (`recibida-molde`, `recibida`).

## Bloqueos y avisos

- **El BOE está bloqueado por la red del entorno** (403). `norma.md` sigue con
  las citas «pendiente». Remedio: añadir `www.boe.es` a los dominios permitidos
  del entorno, o pegarme los artículos.
- **Fuga en el run 60, ya tapada a medias.**
  - El primer molde sacó en el resumen el **texto de la descripción** de cinco
    facturas recibidas, con nombres de proveedores y de tres personas.
  - El repositorio es público y los registros de Actions también. Los he
    borrado (comprobado: la descarga da 404).
  - **El resumen de la página del run puede seguir mostrándolos.** Desde aquí
    no puedo borrar un run entero: **bórralo tú desde GitHub (Actions › run 60
    › «Delete workflow run»).**
  - El script ya no saca texto de la descripción ni letras de los números
    (commit a72bf231). El run 63 se escribió con esa regla desde el principio.
- **Producción:** nada aplicado. La tanda de la 0200 a la 0240 la preparo
  cuando digas, con el contexto de producción medido y el paso 8.

## Resultado del run 63 (la factura a C0009, leída de vuelta)

Pegado del resumen del run, que no lleva nombres:

- Propuesta de Folvy: `600D 1.00 · 629D 1.00 · 472D 0.10 · 472D 0.21 · 400H 2.31`, confianza seguro.
- A Diez: serie 2 · TipoAsiento 2 · TipoFactura 1 · tipos 21+10 · bases 2.00 · cuotas 0.31 · total 2.31 · Apuntes 2.
- `facturas/add` → **200**; Documento 3175 (el mayor de la serie 2 en septiembre y octubre, antes: 3174).
- Campos que vuelven igual que se mandaron: **18 de 18**.
- Apuntes: 2; cuentas iguales y en el mismo orden: sí; importes iguales: sí.
- El asiento que hace Diez: `600D · 629D · 472D · 472D · 400H`. Cuadra: sí. Haber = TotalFactura: sí.
- **Su 472: la genérica (47200000), una por tipo de línea.** Diez junta en ella las 47200010 y 47200021 que propone Folvy, como en las 1.432 medidas.
- Su proveedor: la cuenta del Haber es la mandada.
- **Numeración de la serie 2: sigue sin hueco** (3175 tras 3174).
- Sale en el listado de facturas de octubre (libro de IVA).

**Lo que falta, y es tuyo: mirarlo en la pantalla de Diez.** Que salga en el
libro de recibidas de la C0009 con sus dos tipos, y en el 303 del 4T. La
factura es `FOLVY-D01-0001`, con fecha 13/10/2026.

**Una decisión que sale de aquí:** en Folvy el IVA soportado va a una 472 por
tipo, y en Diez a una sola. Al comparar el libro con Diez, la 472 se tiene que
casar sumando los tipos, no cuenta a cuenta. `cuentaDeBoe` ya hace esa
correspondencia para lo traído de Diez.
