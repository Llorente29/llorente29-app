# S01 · El esqueleto de Sumied — paso 1, comprobaciones previas

> Solo lectura (17/10). Sin push, sin e2e y sin tocar staging. Las cifras de
> producción son de `select` en solo lectura y llevan su cuenta (regla 9). Las de
> staging, también de `select`. Las maquetas son las cinco del zip «Sumied ·
> maquetas de organización».
>
> Este informe no está commiteado: entra en el primer commit de la rama del S01
> si Julio da el visto bueno.

## 0. Lo que hay que saber antes de leer la tabla

1. **La barra y las pestañas de hoy salen de una sola tabla de datos**:
   `src/modules/conta/marco/nuevo/modulos.ts` (`MODULOS`). Cada módulo dice qué
   direcciones son suyas (`prefijos`), y el marco deduce módulo y pestaña. Las
   pantallas no cambian de dirección. **El esqueleto nuevo se monta reescribiendo
   esa tabla, no moviendo pantallas de sitio en el código**, y las direcciones
   viejas siguen funcionando (redirección donde haga falta).
2. **La cuenta B de pruebas NO es una empresa sin hostelería** (medido en
   staging): `business_type = 'restaurante'`, 1 local, canales «Glovo, Uber
   Eats, Just Eat», marcas «Kebab de Prueba, Cedida Sur» y 1 venta (semilla del
   reparto R02). Si «tiene hostelería» se deduce de los datos, **B la tiene**.
   Hace falta una decisión (pregunta 1).
3. **No hay facturas emitidas en Sumied**: no existe la tabla. Lo que hoy sale en
   «Expedidas» es el libro registro que se rellena desde el asiento
   (`vat_book_entry`), con los resúmenes de tiques de ventas (F4).
4. **El nivel del usuario, la analítica activable y el logo del cliente no
   existen**. No hay i18n en el proyecto: los textos están escritos en cada
   componente.

## 1. Inventario: cada pantalla de hoy y su sitio en el esqueleto nuevo

Esqueleto (decisión de Julio): **Inicio · Contabilidad · Facturación · Compras y
gastos · Bancos · Laboral · Impuestos · Contactos · (abajo) Ajustes**. Pestañas
de Contabilidad: **Asientos · Libros y listados · Definiciones · Cierre y
Registro · Importar**. La cinta va por grupos (en Asientos: NUEVO · REVISAR ·
UTILIDADES).

Las pestañas de los demás productos y los grupos de su cinta son **mi propuesta**
(la maqueta solo fija Contabilidad › Asientos y Facturación). Van marcadas con
`(prop.)`.

| Hoy: dirección (`/conta/…`) · pantalla | Hoy cuelga de | Sitio nuevo: producto › pestaña › grupo de la cinta |
|---|---|---|
| `inicio` · InicioPage + franja «Te toca hoy» | Inicio | **Inicio** (la bandeja: 4 cifras arriba, todo lo pendiente debajo con «Validar y siguiente», gráficas a un clic) |
| `ventas` · VentasPage (marcador «aún no») | V Ventas | **Sobra.** Facturación la sustituye; oculta tras su interruptor hasta su encargo |
| `libros/diario` · LibroDiarioPage (vistas, «Para revisar», «Esperan») | Libros › Diario › Libro diario | **Contabilidad › Asientos** · REVISAR «Para revisar» / «Libro diario» (la vista por defecto es «Para revisar») |
| `libros/diario/nuevo` · NuevoAsientoPage | Libros › Diario | **Contabilidad › Asientos** · NUEVO «General» |
| `libros/diario/:id` · AsientoPage | Libros › Diario | **Contabilidad › Asientos** (detalle; desde la cinta, UTILIDADES «Anular») |
| — (nuevo, otro encargo) · Expedida / Recibida / Tesorería / Predefinidos | — | **Contabilidad › Asientos** · NUEVO «Expedida», «Recibida», «Tesorería», «Predefinidos». En el S01 los botones existen y llevan a lo que ya hay: Recibida → revisar recibida; el resto, al asiento a mano con su plantilla. «Vigilancia», «Búsqueda», «Digitalizar»: ver la nota tras la tabla |
| `libros/diario/resumido` · DiarioResumido | Libros › Diario | **Contabilidad › Libros y listados** · DIARIO «Diario resumido» |
| `libros/mayor/libro-mayor` · LibroMayor | Libros › Mayor y saldos | **Contabilidad › Libros y listados** · MAYOR «Libro mayor» |
| `plan/:codigo` · MayorPage (mayor de una cuenta) | Libros › Mayor y saldos (con el índice de Ajustes) | **Contabilidad › Libros y listados** · MAYOR (sin el índice de Ajustes) |
| `libros/mayor/sumas-saldos` · SumasSaldos | Libros › Mayor y saldos | **Contabilidad › Libros y listados** · MAYOR «Sumas y saldos» |
| `libros/mayor/acumulados` · Acumulados | Libros › Mayor y saldos | **Contabilidad › Libros y listados** · MAYOR «Acumulados» |
| `libros/registro/expedidas` · RegistroIva | Libros › Libros registro de IVA | **Contabilidad › Libros y listados** · IVA «Expedidas» (la vista contable de la factura emitida, ver §6) |
| `libros/registro/recibidas` · RegistroIva | Libros › Libros registro de IVA | **Contabilidad › Libros y listados** · IVA «Recibidas» |
| `libros/registro/intracomunitarias` · `bienes-inversion` · `suplidos` · `retenciones` · `formato-aeat` | Libros › Libros registro de IVA | **Contabilidad › Libros y listados** · IVA (los cinco, con el mismo nombre) |
| `libros/balances/balance` · `pyg` · `ecpn` (+ PDF y Excel) | Libros › Balances | **Contabilidad › Libros y listados** · ESTADOS «Balance», «Pérdidas y ganancias», «Patrimonio neto» (PDF y Excel, en la acción, no como entradas) |
| `libros/anuales/cuentas-anuales` · `mapeo` | Libros › Cuentas anuales y Registro | **Contabilidad › Cierre y Registro** · CUENTAS ANUALES |
| `libros/anuales/memoria` · `legalizacion` · `deposito` (marcadores «Próximamente») | Libros › Cuentas anuales y Registro | **Contabilidad › Cierre y Registro** · REGISTRO MERCANTIL. **Sin contenido: ocultas** (regla del encargo: nada vacío delante del cliente) |
| `libros/cierre/ejercicios` · `cerrar-mes` · `cierre-ejercicio` | Libros › Cierre | **Contabilidad › Cierre y Registro** · CIERRE «Ejercicios», «Cerrar el mes», «Regularización, cierre y apertura» |
| `libros/diario/pendientes-diez` · PendientesDiez | Libros › Diario (grupo «Con Diez») | **Contabilidad › Importar** · DIEZ «Pendientes de adjuntar en Diez». Solo si la empresa trabaja con Diez |
| `ajustes/plan` (traer el plan de otro programa) · TraerPlan | Ajustes › Plan contable | **Contabilidad › Importar** · TRAER «Plan de otro programa» |
| `ajustes/plan` (el plan) · PlanContablePage · `ajustes/plan/que-va-a-cada-sitio` | Ajustes › Plan contable | **Contabilidad › Definiciones** · PLAN «Plan contable», «Qué va a cada sitio» |
| `ajustes/tablas/*` (9 tablas: impuestos, retenciones, formas y plazos de pago, numeración, bancos y cajas, tipos de gasto e ingreso, textos de apuntes, países) | Ajustes › Tablas generales | **Contabilidad › Definiciones** · TABLAS (las nueve). Excepción: «Numeración de facturas» → **Facturación › Series y plantillas** cuando exista |
| — (nuevo) · Analítica | — | **Contabilidad › Definiciones** · ANALÍTICA (encender o apagar y el nombre de cada eje). Lo único nuevo de pantalla en el S01 |
| `compras` · ComprasPage (qué mirar, liquidaciones del mes, esperando factura) | Compras › Compras | **Compras y gastos › Pendiente** (prop.) · NUEVO «Subir factura» |
| `documentos` · DocumentosPage (N22) | Compras › Documentos | **Compras y gastos › Recibidas** (prop.) · NUEVO «Subir», «Por correo» · REVISAR «Para mirar», «Por aclarar» |
| `documentos/recibidas/:id` · RevisarFacturaPage (N23) | Compras › Documentos | **Compras y gastos › Recibidas**, y la misma factura en **Contabilidad › Asientos** («Recibida», maqueta 3, con «Validar y siguiente») |
| `compras/liquidacion/*` · LiquidacionPage | Compras › Compras | **Compras y gastos › Liquidaciones** (prop.). **Solo con hostelería** |
| `documentos/catcher/:loteId` · LoteCatcherPage | Compras › Documentos | **Compras y gastos › Liquidaciones** · CATCHER. **Solo con hostelería** (hoy la tarjeta «Sube la quincena de Catcher» sale siempre) |
| `bancos` · Movimientos (B02) | Bancos (pestañas pintadas por la propia pantalla) | **Bancos › Movimientos** · la barra de B02 pasa a ser la cinta: TUS BANCOS · TRAER «Subir extracto» · AUTOMÁTICO «Reglas», «Casados solos» |
| `bancos/reglas` · `cuentas` · `cierre` | Bancos | **Bancos › Reglas · Cuentas y extractos · Cierre del mes** (las pestañas pasan al marco; hoy las pinta la pantalla) |
| `bancos/subir` · `bancos/hecho` | Bancos | **Bancos › Movimientos** · TRAER «Subir extracto» · REVISAR «Lo que he hecho» |
| `clientes-y-proveedores` · TercerosPage | P Clientes y proveedores | **Contactos › Todos** (prop.); los filtros Plataformas y Socios de marca, **solo con hostelería** |
| `clientes-y-proveedores/:id` · FichaTerceroPage · `…/proveedor/:id` · FichaProveedorPage · `…/como-te-factura` | Clientes y proveedores | **Contactos** (ficha). «Es también plataforma / socio de marca», solo con hostelería |
| `ajustes/empresa` · `impuestos` · `socios` · `ejercicio` | Ajustes | **Ajustes › Empresa** (prop.) + logo y nombre del cliente (nuevo) |
| `ajustes/folvy` («Lo que ha hecho Sumied») | Ajustes | **Ajustes › Registro de la IA** (y enlace desde Inicio) |
| `ajustes/numeracion` · `certificados` · `personas` · `avisos` («Aún no») | Ajustes | **Ajustes**, ocultas hasta tener contenido (hoy ya se ocultan en el producto vendido solo; con el esqueleto, siempre) |
| — (nuevo) · Usuario y nivel | — | **Cabecera › usuario** (nivel y preferencias: densidad, cinta oculta) |
| `ajustes/muestra-piezas` · MuestraPiezasPage | Ajustes (solo fuera de producción) | **Se queda fuera de producción** como muestrario del sistema de diseño (§8) |
| `alta` · AltaPage (sin marco) | Ajustes | **Ajustes** (sin marco, igual que hoy) |
| — | — | **Facturación** (Facturas · Presupuestos · Recurrentes · Rectificativas · Cobros · Productos y servicios · Series y plantillas, maqueta 4): en la barra desde ya; **oculta tras su interruptor por cuenta** hasta su encargo |
| — | — | **Laboral** e **Impuestos**: sin pantallas → ocultas tras su interruptor. Lo que existe de nóminas (asientos `payroll`) y del perfil fiscal se queda donde está |

**Nota sobre la cinta de Asientos (maqueta 1).** «Vigilancia» (los agentes que
revisan con la norma) no tiene pantalla todavía: hoy son agentes nocturnos con
su informe en GitHub. En el S01 propongo dejar el panel lateral de la maqueta
con lo que ya dicen los motivos («Esperan», la regla del céntimo, la numeración)
y no inventar una pantalla. «Búsqueda» es el Ctrl K. «Digitalizar» es «Subir
factura». «Anular» es la acción que ya existe en el asiento.

**Fuera de Sumied, y se queda donde está:** la lista y la ficha de proveedores
de Cocina (`/:slug/kitchen/proveedores`), que reutilizan las piezas de conta, y el
alta de cuentas de contabilidad del panel de administración.

## 2. Lo del #211 (piezas comunes y diario en el marco) con este esqueleto

| Pieza del #211 | Qué pasa |
|---|---|
| `TablaDensa`, `FormularioBloques`, `PanelDocumento`, `CampoFecha` | **Se quedan tal cual.** Son justo lo que piden las maquetas 2 y 3 (formulario por bloques con el documento al lado, tabla densa). Pasan a vivir en el sistema de diseño (§8) |
| Libro diario en el marco (vistas, «Para revisar», «Esperan», filtros, exportar) | **Se queda** y pasa a ser **Contabilidad › Asientos**, con la vista «Para revisar» por defecto. «Validar los N seguros» (maqueta 1) ya existe como «Validar y enviar» en bloque |
| `AccionesPantalla` / `BotonAccion` (acciones arriba, «⋯» en el móvil) | **Cambia → la cinta**: grupos con etiqueta (NUEVO · REVISAR · UTILIDADES), «Ocultar» por usuario y fijar a Favoritos. El mecanismo (portal al hueco del marco, teclas, la principal en el móvil) se reutiliza |
| `Buscador` (Ctrl K: asientos, facturas, terceros, subcuentas, opciones) | **Cambia → paleta de órdenes**: añade ACCIONES («nueva recibida»), CUENTAS («mayor 43000012» abre el mayor) y PANTALLAS (todas las del inventario). Hoy ya busca «Opciones» de libros: se generaliza |
| `TeTocaHoy` (franja de chips en Inicio) | **Cambia → la bandeja de Inicio**: las 4 cifras arriba (hoy son las tarjetas del Inicio, ya con la regla de 0 = no sale) y debajo la lista de lo pendiente de todos los productos con «Validar y siguiente» |
| `BarraModulos` (círculos con letra, 76/232 px) | **Cambia**: productos con nombre, unos 88 px, azul noche `#0B1F3B`, símbolo de Sumied arriba; plegable (lo es) |
| `BarraSuperior` (empresa, periodo, pestañas, «Más», Buscar, Cómoda/Compacta, usuario) | **Cambia**: una fila de 48 px con logotipo de Sumied · logo y nombre del cliente con el selector de empresa · ejercicio y mes · pestañas · Buscar · Favoritos · usuario y nivel. «Cómoda/Compacta» pasa al menú del usuario |
| `SubpestanasEnBarra` (segunda fila con las acciones de cada área de Libros) | **Sobra**: lo sustituye la cinta |
| `BarraInferior` (móvil: Inicio, Compras, Bancos, Libros, Más) | **Cambia** a los productos nuevos: Inicio, Contabilidad, Compras y gastos, Bancos, Más |
| `modulos.ts` | **Se reescribe** (es el esqueleto) y conserva el mecanismo de `prefijos` |
| `preferencias.ts` (densidad, barra desplegada, documento oculto, en el navegador) y favoritos de Libros (navegador) | **Cambia**: se guardan en la base por usuario (§4) para que Favoritos persista entre dispositivos; al primer uso se migran los del navegador |
| «Impuestos» apagado con «Próximamente» al pasar el ratón (decisión del 15/10) | **Cambia** por la regla nueva: un producto sin contenido **no sale** (interruptor por cuenta) |
| «Volver a Folvy», módulo Ventas, muestra de piezas en producción | Ventas **sobra**; «Volver a Folvy» solo en Folvy (ya es así en el producto vendido solo); la muestra, solo fuera de producción (ya es así) |
| Tokens `--cxm-*` del marco | **Se funden** con los `--cx-*` en un solo juego de tokens de Sumied (§8) |

## 3. Dónde aparece hoy algo de hostelería (mirado con la cuenta B)

**Primero, el hallazgo:** B no sirve para probar «sin hostelería». Es
`restaurante` y tiene 1 local, 3 canales de reparto, 2 marcas y 1 venta (medido
en staging). Además, conta **no lee ningún interruptor de Cocina**: lo único que
esconde cosas es «producto vendido solo» (por la marca o por
`accounts.product_brand`, y B no lo tiene), `recibe_mercancia` y la existencia de
datos (asientos de cada origen, papeles de tercero, locales y marcas **por
cuenta**, no por empresa).

**Sale siempre, en B y en cualquier empresa:**

| Dónde | Qué |
|---|---|
| Barra (`modulos.ts:72`) y `ventas/VentasPage.tsx` | Módulo «Ventas» y su texto «plataforma a plataforma» |
| `documentos/DocumentosPage.tsx:169` | Tarjeta «Facturas de Catcher · Sube la quincena de Catcher» |
| `libros/navegacion.ts:35`, `PendientesDiez.tsx` | Grupo «Con Diez», «Pendientes de adjuntar en Diez» |
| `libro/LibroDiarioPage.tsx:321,327,360` | Columna «Diez»; cabecera «Concepto · local · marca»; «Hoy se cierra mañana a las 2:00. Sus ventas se proponen entonces.» |
| `libro/LibroDiarioPage.tsx:460,462`, `libros/RegistroIva.tsx:144`, `terceros/TercerosPage.tsx:174` | Textos de «vacío» que nombran plataformas, liquidaciones y socios |
| `libro/AsientoPage.tsx:173` | Cabecera «Cuenta · local · marca» |
| `libros/LibrosPage.tsx:101` | Estado de la PyG «oficial · por local» |
| `compras/ComprasPage.tsx:85,96` | «Lo que llega con el género ya entra solo desde el local»; tarjeta «Liquidaciones del mes… local por local» |
| `compras/ComprasPage.tsx:108` | «Verlas» lleva a Cocina (`/supply/facturas`) si no es el producto vendido solo |
| `proveedor/ComoTeFactura.tsx:89` | «una por cada local», «Liquidación mensual» |
| `terceros/FichaTerceroPage.tsx:236` | «Es también plataforma de reparto», «Es también socio de marca» |
| `ajustes` › Ejercicio (`ApartadoCierreDelDia.tsx`) | «Hora de cierre del día… un pedido que siga abierto…» |
| `alta/guion.ts:135`, `alta/actividades.ts:28` | Pregunta del alta con ejemplo de restaurante; **las actividades propuestas son solo de hostelería, alojamiento y panadería** |
| Ctrl K (`buscar.ts:288`, `libros/navegacion.ts:64`) | «Pendientes de adjuntar en Diez», «resultado por local» |
| Plan y tablas (`PlanContablePage.tsx:474`, `registro.ts:497`) | Ejemplos «Glovo», «Caja del local» |

**El campo Local sale siempre, sin condición:** columna Local de cada apunte en
el asiento a mano (sin local obliga a «Común»), selector Local al subir una
factura, Local de cada banco y tarjeta, y «¿De qué local es esta cuenta?» en el
alta de un banco. **Sale según los datos:** Local y Marca en el Mayor (B ve los
dos: tiene 1 local y 2 marcas), «Por local» en la PyG (con más de un local; B no),
vistas Ventas, Plataformas y Socios del diario, filtros de Contactos, pestaña
Liquidaciones de la ficha y lo de Catcher en la ficha del proveedor (por el
nombre).

**Y la base también lo pide:** la validación para un apunte sin local que no
esté marcado como común («falta el local (o marcarlo como común)», regla 5 de
`conta_motivos_para_validar`). **Apagar la analítica obliga a cambiar esa regla
en la base**, y desde «Esperan» vive en un solo sitio.

**Lo que comprueban hoy las e2e en B:** que no ve nada de A, que no salen las
vistas Plataformas y Ventas del diario, que la PyG no ofrece «Por local», que
«Folvy Conta» no sale en la barra de Folvy y lo fiscal de Canarias. **No
comprueban** la tarjeta de Catcher, el módulo Ventas, la Marca del Mayor, los
selectores de Local, la columna Diez, la hora de cierre del día ni el alta.

## 4. Diccionario de textos por nivel y las tres preferencias nuevas

### 4.1 El diccionario (en el código, no en la base)

- `src/modules/conta/textos/` con un fichero por producto. Cada clave lleva sus
  tres textos, y TypeScript obliga a que estén los tres:
  `{ 'recibida.titulo': { sinExperiencia: 'Una compra de {proveedor}', medio: 'Factura recibida · {numero}', experto: 'Recibidas · serie {serie} · {numero}' } }`.
- Una función pura `texto(clave, nivel, datos)` y un `useTexto()` que lee el
  nivel del usuario del contexto del marco. Si falta una clave **falla la
  compilación**, no la pantalla.
- **En el código y no en la base**: los textos van con el componente que los
  usa, se revisan en el PR y se prueban (una prueba recorre todas las claves y
  comprueba las tres variantes y sus `{huecos}`). Una tabla de textos en la base
  sería otra cosa que desplegar y que se puede desincronizar del front.
- **El nivel cambia palabras, ayuda y lo que se ofrece por defecto** (por
  ejemplo, «Ver el asiento» abierto o plegado), **nunca la posición**. La e2e lo
  mide: misma pantalla en los tres niveles, mismas cajas
  (`boundingBox` de cada botón y cada bloque) y textos distintos.
- Se empieza por lo que tocan las maquetas (Asientos, recibida, expedida, la
  cinta y la bandeja de Inicio); el resto pasa al diccionario pantalla a
  pantalla, cuando cada una se toque.

### 4.2 Las preferencias (tres migraciones nuevas, las tres «añadir»)

Ninguna toca nada existente: según el analizador, son de la clase **añadir**,
pasan sin «autorizo» y van en tanda con ensayo y real.

1. **`conta_user_pref`**: el nivel y lo de cada usuario.
   - `account_id uuid` (fk `accounts`), `user_id uuid` (fk `auth.users`);
     clave primaria `(account_id, user_id)`.
   - `nivel text not null default 'medio' check (nivel in ('sin_experiencia','medio','experto'))`.
   - `favoritos jsonb not null default '[]'`: lista de ids de acción del
     catálogo de órdenes (los mismos de Ctrl K), no direcciones.
   - `cinta_oculta boolean not null default false`,
     `densidad text default 'compacta'`, `barra_desplegada boolean`.
   - `updated_at timestamptz`.
   - RLS: cada uno solo lee y escribe su fila; lectura para el administrador de
     su cuenta.
   - **Por qué una tabla nueva y no una columna en `user_profiles`**:
     `user_profiles` es de toda Folvy (rol, empleado, bienvenida). Lo de Sumied
     va aparte y no estorba a nadie.
2. **`conta_eje_analitico`**: la analítica por empresa.
   - `id`, `account_id`, `company_id` (fk `company`).
   - `eje text check (eje in ('local','marca'))`: las dos columnas que ya existen
     en `journal_line` (`location_id`, `brand_id`).
   - `activo boolean not null`, `nombre text not null` («Local», «Proyecto»,
     «Centro de coste»…), `nombre_plural text`, `posicion int`.
   - `unique(company_id, eje)`. RLS por cuenta como el resto de conta.
   - **Sin fila = apagado.** La migración siembra las empresas de hoy así:
     Foodint con «Local» y «Marca» encendidos; las demás según tengan locales o
     marcas (se mide antes, con su cuenta).
   - **Lo que cambia además**: la regla 5 de `conta_motivos_para_validar` solo
     pide local si el eje «local» está activo en la empresa (función con la
     misma firma: **cambiar en caliente**, declarado y con su prueba).
   - **Ojo:** no se borra ningún dato ni ninguna columna. Apagada, la analítica
     ni se pide ni se enseña, pero lo guardado se queda.
3. **El logo del cliente**: `company.logo_path text null` (columna nueva que
   admite nulos) y un **bucket nuevo `company-logos`** (privado, imágenes de hasta
   1 MB, ruta `<account_id>/<company_id>/<huella>.<ext>`, políticas por cuenta).
   - **Por qué por empresa y no el `accounts.logo_url` que ya existe**: en la
     cabecera el logo va con el selector de empresa, y una cuenta puede tener
     varias empresas (Foodint tiene una; un asesor tendrá muchas). Si una empresa
     no tiene logo, se usa el de la cuenta, y si tampoco, la inicial.
   - Se sube en **Ajustes › Empresa**.

## 5. Capturas de ahora

**Todas las capturas del repositorio están hechas con la marca Folvy o con la
de pruebas «Contabilidad»; ninguna con la de Sumied.** La disposición es la
misma; en Sumied cambian la letra (Inter) y los colores. Sin lanzar e2e no puedo
sacar nuevas. Las de «antes», por producto del esqueleto nuevo (`docs/conta/capturas/…`):

| Esqueleto nuevo | Antes (ordenador · móvil) |
|---|---|
| Barra y cabecera | `m01/marco-plegado-ordenador.png`, `m01/marco-desplegado-ordenador.png`, `m01/marco-plegado-movil.png`, `m01/marco-mas-movil.png` |
| Inicio | `c06/inicio-ordenador.png`, `c06/inicio-movil.png` |
| Contabilidad › Asientos | `m01/libro-diario-compacta-ordenador.png`, `m01/libro-diario-movil.png`, `c04/asiento-ordenador.png`, `c04/diario-b-ordenador.png` |
| Contabilidad › Libros y listados | `m01/libros-subpestanas-ordenador.png`, `c05/balance-ordenador.png`, `c05/expedidas-ordenador.png`, `c05/cuenta-b-pyg-ordenador.png` |
| Contabilidad › Definiciones | `c02/plan-movil.png`, `c00/tablas-ordenador.png` |
| Contabilidad › Cierre y Registro | `c05/cuentas-anuales-ordenador.png`, `c05/ejercicios-ordenador.png` |
| Compras y gastos | `compras/compras-ordenador.png`, `d01/n22-para-mirar-a-ordenador.png`, `d01/n23-revisar-a-ordenador.png` |
| Bancos | `b02/conciliar-ordenador.png`, `b02/panel-ordenador.png`, `b02/portada-movil.png` |
| Contactos | `c03/lista-ordenador.png`, `c03/plataforma-ordenador.png`, `c03/cliente-ordenador.png` |
| Ajustes | `c00/empresa-ordenador.png`, `c00/empresa-b-canarias.png` |

**Propuesta:** el primer run de la rama del S01, antes de cualquier cambio de
pantalla, saca el «antes» **con la marca Sumied** (`?marca=sumied`) en A y B, en
ordenador y en móvil, y lo fija en `docs/conta/capturas/s01/antes/`. Así el antes y
el después son de la misma marca y frente a las maquetas.

## 6. Una sola factura con dos vistas: cómo está hoy y qué cambiaría

**Recibidas, hoy.** Ya hay una sola factura: `supplier_invoice` (con
`supplier_invoice_line`, `supplier_invoice_tax`, la llegada en `document_inbox` y
el PDF). Compras › Documentos y la revisión (N23) leen esa misma fila. El asiento
apunta a la factura con `journal_entry.source_type = 'supplier_invoice'` y
`source_id`, con índice único para los asientos vivos.

- **Hallazgo:** existe `supplier_invoice.journal_entry_id` (desde el C04), pero
  **nadie la escribe**. En producción, Foodint: 7 facturas recibidas, 0 con
  `journal_entry_id`; 1 asiento de factura, y apunta a su factura. Hoy el enlace
  solo va del asiento a la factura.
- `propuestasLibroService` filtra con `journal_entry_id is null`, así que ese
  filtro no filtra nada y es el índice único el que evita el duplicado.
- **Qué cambiaría:** el enlace de verdad es uno solo, `source_type` +
  `source_id`, con su índice. Se deja de leer `journal_entry_id` en el front, y
  la columna se quita en una tanda posterior (borrar va en dos pasos). Las dos
  vistas («Compras y gastos › Recibidas» y «Contabilidad › Asientos ›
  Recibida») son **la misma ruta y el mismo componente** con distinto marco.

**Expedidas, hoy.** **No hay facturas emitidas.** «Expedidas» es
`vat_book_entry`, que la base rellena desde el asiento validado. Para las
ventas del día sale de `sales_day_summary` (resumen de tiques F4, con
`first_invoice` y `last_invoice` aún vacíos). Las series existen
(`invoice_series`, «solo la definición: el contador llega con las facturas
emitidas»). No hay nada de Verifactu.

**Qué cambiaría (encargo de Facturación, no el S01):**
- `issued_invoice` (cabecera: empresa, serie, número, fecha, cliente
  `party_id`, tipo F1/F2/R…, totales, estado, `rectifies_id`), con
  `issued_invoice_line` y `issued_invoice_tax`.
- Un contador por serie y año (con bloqueo, sin huecos).
- `verifactu_record` (huella encadenada, QR y envío).
- El asiento sale de la factura con `source_type = 'issued_invoice'`; el registro
  de IVA se rellena desde la factura, no desde el asiento. Ampliar el CHECK de
  `source_type` cuenta hoy como **destruir** («ampliar el tipo de una columna»)
  y va con «autorizo».
- Facturación y Contabilidad › Expedidas leen la **misma** fila.
- **En el S01** solo se reserva el sitio: Facturación en la barra (oculta) y
  «Expedida» en la cinta de Asientos llevando al asiento a mano, como hoy.

## 7. Inicio como bandeja y Ctrl K como paleta de órdenes

- **Las 4 cifras** existen hoy en el Inicio: banco, te deben, debes, IVA del
  trimestre (`inicioService`). Se pasan a una franja de cuatro arriba. Lo
  pendiente sale de lo que ya cuenta el menú (`useCuentasMenu`: compras por mirar,
  asientos para revisar menos los que esperan, movimientos del banco, terceros
  por revisar), ahora en una lista con su acción.
- **«Validar y siguiente»** existe en la revisión de recibidas (N23, «← Anterior
  / Siguiente») y en la muestra de piezas (Ctrl Intro). Se generaliza con un
  recorrido de la bandeja: una cola de pendientes y, por cada uno, su pantalla
  de revisión.
- **Las gráficas, a un clic**: lo que hoy son las barritas de las tarjetas pasa a
  una vista aparte.
- **Ctrl K**: un **catálogo de órdenes** en el código (id, texto por nivel,
  sinónimos, producto, qué hace). De él salen la cinta, Favoritos y la paleta: un
  solo sitio. Para «mayor 43000012», el buscador reconoce «mayor» seguido de un
  código y abre el mayor de esa subcuenta.

## 8. El sistema de diseño de Sumied: cómo y dónde

**Hoy:**
- Hay dos juegos de tokens que se pisan: `--cx-*` en `estilo/tokens.css`, en Geist
  y con azul `#2F5BFF`, y `--cxm-*` en `estilo/marco.css`. Sumied los sobrescribe
  desde `marca/tema.ts` (Inter, `#0B1F3B`, `#1E63C9`, acento `#00D1B2`).
- Hay piezas comunes en `ui/` (las del #211), otras en `ui/piezas.tsx` y otras
  sueltas (`TonoChip` en `libro/`, `Campo` y `Dialogo` en `proveedor/`).
- Los iconos son propios (`ui/Icono.tsx`); el resto de la app usa lucide-react.
- Tailwind no se usa en conta.

**Propuesta: `src/modules/conta/diseno/`**, la única fuente.
- `tokens.css`: un solo juego `--s-*`.
  - Color: tinta, apoyo, acción, fondo, superficie, borde, estados ok, duda y
    falta, IA y barra noche `#0B1F3B`.
  - Letra Inter, escala de tamaños, pesos, cifras tabulares.
  - Espaciados en base 4, radios, sombras y densidad.
  - Los valores salen de `marcas.ts` (tema de Sumied), que se queda como el único
    sitio de la identidad.
  - Los `--cx-*` y `--cxm-*` pasan a ser alias de los `--s-*` mientras quede
    alguna pantalla vieja; se retiran cuando ya no los lea nadie.
- Componentes en `diseno/`, cada uno con su prueba:
  - `Boton` (principal, secundario, enlace; con tecla).
  - `Campo` (texto, número, importe, fecha, selector, subcuenta).
  - `Tabla`: es `TablaDensa`.
  - `Bloque`: es `FormularioBloques`.
  - `Documento`: es `PanelDocumento`.
  - `Chip`: funde `Chip` y `TonoChip` (seguro, duda, falta, neutro).
  - `Icono`: lucide-react con trazo y tamaño fijos, sin iconos sueltos.
  - `Cifra` (importe en cifras tabulares).
  - `Tarjeta`, `Cinta` y `Dialogo`.
- **Reglas que se comprueban solas** (en `antes-de-subir.sh`):
  - ningún color, tamaño de letra ni radio escrito a mano en los `.css` de
    conta fuera de `diseno/tokens.css`;
  - ninguna pantalla del esqueleto importa piezas de fuera de `diseno/`.
- **Sin pantallas tipo pijama**: la `Tabla` no alterna fondos por fila;
  separadores finos y el hover.
- **El muestrario** (`ajustes/muestra-piezas`, solo fuera de producción) pasa a
  ser la página del sistema de diseño, con cada componente en los tres niveles.
- **Orden de la construcción**: primero el sistema de diseño (tokens y
  componentes, sin mover pantallas), luego la barra y la cabecera, luego la
  cinta y los favoritos, luego los productos uno a uno, cada uno en su commit con
  sus capturas.

## 9. Respuestas de Julio (17/10)

1. **Cuenta de prueba nueva sin hostelería**: sí. Sin locales, canales ni marcas;
   B se queda como está para el reparto.
2. **Marca explícita por empresa**: sí. «Los datos pueden generar dudas». Se
   pone en el alta por la actividad y se cambia en Ajustes; los datos solo
   sugieren.
3. **El esqueleto es para los dos.** Sumied, para quien no es hostelería o no
   quiere Folvy; Folvy lleva Sumied integrado del todo: el mismo esqueleto,
   dentro de Folvy y con su marca. Así que «Volver a Folvy» se queda en Folvy, y
   la letra y los colores salen del tema de cada marca.
4. **Interruptores por producto**: lo decido yo (ver abajo).
5. **Pestañas propuestas**: aclaradas abajo, pendientes de su sí.

## 10. Visto bueno de Julio (17/10), con cambios

1. **Compras y gastos**: Por revisar · Facturas recibidas · Recurrentes · Pagos,
   y Liquidaciones solo con hostelería (las pestañas de la N30 aprobadas el
   15/10). Recurrentes: las facturas que se repiten (alquileres y demás).
2. **Bancos, Contactos y Ajustes**: como los propuse.
3. **Interruptores**: en `feature_flags`, una clave por producto
   (`conta_facturacion`, `conta_laboral`, `conta_impuestos`), **sin caducidad**:
   lo de `expires_at` de la clave `conta` no se copia.
4. **Enlace factura-asiento**: uno solo y nada de columnas muertas. Lo elijo yo
   (§11).
5. **Orden**: primero se cierra la tanda «Esperan» (cuando R suelte staging) y
   después se construye el S01.

## 11. El enlace factura-asiento: se quita la columna

**Medido en producción (solo lectura, 17/10, tabla entera, todas las cuentas):**

| Tabla | Filas | Con `journal_entry_id` | Asientos vivos de ese origen |
|---|---|---|---|
| `supplier_invoice` | 7 | 0 | 1 |
| `channel_settlement` | 255 | 0 | 0 |
| `licensed_settlement` | 3 | 0 | 0 |

Las tres columnas `journal_entry_id` que añadió el C04 están **vacías en toda la
base, sin excepción**, y no hay ningún camino que las escriba.

**Elijo quitarlas, y quitar las tres.** El único enlace es el que ya existe y ya
se escribe: `journal_entry.source_type` + `source_id`, con su índice único para
los asientos vivos (`ux_journal_entry_origen`).

**Por qué no rellenarla:**
- **Una flecha de vuelta hay que mantenerla en cada camino** (regla 10):
  proponer, validar, descartar, anular, volver a proponer después de anular, y
  el asiento que se borra (`on delete set null` no cubre el anulado, que sigue
  existiendo). Son cinco escritores nuevos para un dato que ya está en el
  asiento.
- **Y la flecha que ya hay la garantiza la base**: el índice único impide dos
  asientos vivos de la misma factura. Una columna de vuelta podría decir otra
  cosa que el asiento, y entonces habría dos verdades.
- **Para ir de la factura a su asiento basta una consulta** por
  `(source_type, source_id)`, con el índice que ya hay.

**Quién la lee hoy, y qué se hace con cada uno:**

| Quién | Qué hace hoy | Qué se hace |
|---|---|---|
| `propuestasLibroService.ts:390, 469, 558` | `.is('journal_entry_id', null)`: no filtra nada (siempre es null) | Se cambia por «sin asiento vivo de ese origen», que es lo que quería decir. Hoy el duplicado lo para el índice único, después de intentarlo |
| `banco_facturas_recibidas_pendientes` | Devuelve la columna (siempre null). Ninguna pantalla la llama | Misma firma, el cuerpo la saca del asiento (`source_type`/`source_id`): **cambiar en caliente**, con su prueba. Respeta su contrato («solo se añaden columnas al final») y deja de devolver un null que miente |
| `20261115T0110_d01_liquidaciones_referencia_foodint.sql:77` | Guarda de una tanda ya aplicada | Fichero histórico, no se toca. **Ojo:** el manifiesto de staging de `main` lo vuelve a pasar; después del paso 2 hay que quitarlo de ese manifiesto, o fallará al nombrar la columna |

**En dos pasos** (regla de borrar): primero el front y la función dejan de leerla
(en la rama del S01, con su prueba). Después, en otra tanda, se quitan las tres
columnas y sus tres índices: es **destruir**, va con «autorizo», ensayo y real.
Antes de ese paso 2 se vuelven a medir las tres en producción: tienen que seguir
en 0.

`supplier_invoice.payment_entry_id` **se queda**: ese sí lo escribe Bancos al
casar el pago (`20261101T0110_b01_funciones.sql`).

## 12. Preguntas que hice

1. **La empresa sin hostelería para las pruebas.** B es un restaurante con
   canales, marcas y una venta (semilla del reparto, que la necesita). ¿Una
   cuenta de prueba nueva, sin locales, canales ni marcas (por ejemplo, una
   asesoría o un comercio), o quitar a B lo de hostelería y mover el reparto a
   otra cuenta? Recomiendo la cuenta nueva: no toca las pruebas del reparto.
2. **Cómo sabe Sumied que una empresa «tiene hostelería».** Hoy se deduce de los
   datos y por cuenta, no por empresa. Propongo una marca explícita por empresa
   (`company` › sector, puesta en el alta por la actividad y cambiable en
   Ajustes), con los datos solo como sugerencia. ¿De acuerdo?
3. **Folvy**: ¿el esqueleto nuevo es solo para Sumied, o también para la
   contabilidad dentro de Folvy (con su marca)? Afecta a «Volver a Folvy» y a la
   letra (Geist frente a Inter).
4. **Los interruptores por cuenta** de Facturación, Laboral e Impuestos: ¿en la
   tabla de interruptores de siempre (`feature_flags`), uno por producto?
5. **Pestañas de Compras y gastos, Bancos y Contactos** (`(prop.)` en la tabla):
   ¿valen las propuestas o hay maqueta?
