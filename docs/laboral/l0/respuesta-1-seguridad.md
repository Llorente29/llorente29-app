# L00 · Respuesta 1 · Cerrar los datos de los trabajadores

> 27/10/2026. Lo pide la Respuesta 1 a la L00, después de la auditoría
> (`docs/laboral/l0/auditoria.md`, §6). Rama `claude/wizardly-bardeen-91lb33-datos`,
> tanda `supabase/produccion/tandas/folvy/claude-wizardly-bardeen-91lb33-datos/`.

## Qué cierra

1. **El almacén de los contratos y las nóminas** (`employee-documents`) pasa a
   privado y pierde `anon_all_employee_documents`.
   - Leen el administrador o el encargado de la cuenta, y el trabajador solo lo suyo.
   - Suben, cambian y borran solo el administrador y las funciones de nóminas
     (con la clave de servicio).
   - El front abre cada PDF con un enlace firmado de 5 minutos. En el repositorio
     no quedaba otro `getPublicUrl` de este almacén: el único era `documentsService`.
2. **Las lecturas de personal, por persona:** `employees`, `clock_entries`,
   `vacations`, `payroll_cost`, `documents`, `clock_entry_audit`,
   `clock_correction_request`, `employee_notifications` y
   `monthly_balance_closures`. La bandeja de nóminas (`payroll_inbox`, que lleva
   el DNI leído), solo para el administrador o el encargado.
3. **De los compañeros, solo nombre, foto y puesto**, con `companeros_de_trabajo()`
   (de servidor). Es lo que usan los cambios de turno del portal.
4. **Fichar:**
   - El trabajador ficha solo para sí mismo y con la hora del servidor.
   - Una marca para otra persona solo la ponen el encargado o el administrador.
   - Toda marca nueva deja rastro en `clock_entry_audit` (acción `create`): quién,
     cuándo, por qué y por qué vía (`via`, `para_otra_persona`).
   - Las correcciones manuales siguen dejando su `create_manual`, sin duplicar.
5. **El PIN del kiosko** sale de `employees` y pasa a `employee_kiosk_pin`, que
   el cliente no puede leer. La tablet lo comprueba en el servidor
   (`kiosko_comprobar_pin`), y la ficha solo dice si la persona tiene PIN.
6. **`employee_clock_status`** pide ser tú, o el administrador o el encargado.
7. **Cuatro funciones de servidor sin guarda** dejan de poder llamarse con sesión:
   - `migrate_locations_and_staff`: copiaba los locales y el personal de cualquier
     cuenta en otra;
   - `location_labor_cost` y `location_economics`: la suma de salarios de
     cualquier local;
   - `close_month_balance`: escribía cierres en cualquier cuenta.

   Nadie las llama desde el front ni desde otra función.

## Lo que ve cada uno

Probado en la prueba de staging, entrando como cada uno con su sesión.

| | Trabajador | Encargado | Administrador |
|---|---|---|---|
| Su ficha, sus fichajes, sus vacaciones, su nómina, sus documentos, sus peticiones, sus avisos, su bolsa de horas | **Sí** | Sí | Sí |
| La ficha de un compañero (salario, DNI, PIN, fecha de nacimiento) | **No** | Sí, como hoy | Sí, como hoy |
| Nombre, foto y puesto de los compañeros de su local | **Sí** (`companeros_de_trabajo`) | Sí | Sí |
| Fichajes, GPS y rastro de un compañero | **No** | Sí | Sí |
| Bajas, nóminas, documentos, peticiones, avisos y bolsa de un compañero | **No** | Sí | Sí |
| Estado de fichaje de un compañero | **No** | Sí | Sí |
| La bandeja de nóminas | **No** | Sí | Sí |
| Ningún PIN (ni el suyo) | No se lee | No se lee: solo se comprueba | No se lee: se pone uno nuevo |
| Leer los PDF | Los suyos | Los de la cuenta | Los de la cuenta |
| Subir, cambiar o borrar PDF | **No** | **No** | Sí |
| Fichar por sí mismo | Sí, con la hora del servidor | Sí | Sí |
| Fichar por otro, o una marca «manual» | **No** (42501) | Sí, con rastro | Sí, con rastro |
| Las cuatro funciones sin guarda | **No** | **No** | **No** (solo el servidor) |

**«Mis documentos» del portal pasa a ser solo de lectura.** La subida del
trabajador ya fallaba antes (la tabla `documents` solo deja escribir al
administrador), y ahora la pantalla dice «dáselo a tu encargado».

## Si alguien descargó los PDF sin sesión: los registros de Storage

Los registros llegan hasta el **29/07/2026 a las 06:49 UTC**: unos 90 días, el
máximo que guarda el proyecto. Los 35 ficheros se subieron entre el 22/05 y el
04/08, así que **del 22/05 al 29/07 no hay forma de saberlo**.

Se han mirado los 91 días, uno a uno, en `edge_logs`. La consulta está abajo;
salen solo cuentas, sin nombres de fichero.

- **Listados del almacén** (`/object/list/employee-documents`): **0**. Nadie ha
  pedido la lista de ficheros: para bajar uno había que tener su enlace.
- **Descargas por enlace público desde la app** (con Folvy como procedencia):
  **62**, en 21 días distintos. Es el uso normal: la ficha y el portal abrían el
  PDF así.
- **Descargas por enlace público desde fuera de la app** (sin procedencia o con
  otra): **37**, en 18 días.
  - **03/08: 16.** Hay una vista previa de **WhatsApp** y robots que analizan
    enlaces (Microsoft en Países Bajos, Netskope, Leaseweb USA y Amazon). Es la
    huella de **un enlace compartido** por WhatsApp o por correo y abierto fuera
    de la app.
  - **04/08: 2**, desde un ordenador Ubuntu en España.
  - **04/09: 3**, desde un Android en España.
  - **12/09: 2**, desde un iPhone y un Mac en España.
  - **Del 15/09 al 11/10: 14**, una al día como mucho, desde un Mac (y una vez un
    iPhone) en España, con varias operadoras domésticas. Por el patrón parece la
    misma persona abriendo un enlace guardado o compartido. No se puede saber
    quién: el registro no guarda la sesión, y un enlace público no lleva ninguna.
- **Desde el 12/10, ninguna descarga** del almacén, ni desde la app.
- **Las funciones** (`payroll-inbound` y `payroll-extract`, de `Deno` en Amazon)
  entraban con la clave de servicio, no por el enlace público. No cuentan.

**Lo que hay que decidir** (Julio o la empresa, no el código): el 03/08 un
enlace a un PDF de personal salió de la app y lo abrieron servicios de terceros.
Si era una nómina o un contrato, es una brecha que se notifica a la AEPD en 72 h
desde que se conoce (RGPD art. 33). Saber qué fichero era exige mirar el
registro con los nombres, y eso no va en este parte.

La consulta, un día cada vez (la ventana de los registros es de 24 h):

```sql
select toDate(timestamp) d,
  countIf(position(log_attributes['request.path'],'/object/public/')>0 and position(log_attributes['request.headers.referer'],'folvy')>0) pub_app,
  countIf(position(log_attributes['request.path'],'/object/public/')>0 and position(log_attributes['request.headers.referer'],'folvy')=0) pub_fuera_app,
  countIf(position(log_attributes['request.path'],'/object/list/')>0) listar,
  groupUniqArrayIf(log_attributes['request.cf.country']||'/'||left(log_attributes['request.cf.asOrganization'],20)||'/'||left(log_attributes['request.headers.user_agent'],22),
    position(log_attributes['request.path'],'/object/public/')>0 and position(log_attributes['request.headers.referer'],'folvy')=0) quien_fuera
from logs where source='edge_logs' and position(log_attributes['request.path'],'employee-documents')>0
  and log_attributes['request.method'] in ('GET','POST') and log_attributes['response.status_code'] in ('200','206','304')
group by d
```

## Cómo entra, y qué pasa mientras tanto

**La tanda va antes que el front**, como manda la regla. Con la base nueva y el
front de antes (unos minutos, hasta que Vercel diga READY):

- Fichar, desde el móvil y desde el kiosko: **igual**.
- Los PDF, en la ficha y en el portal: **no abren** (el enlace público ya no vale).
- El kiosko: dice **«no tiene PIN»** (el PIN ya no está en la ficha).
- Los cambios de turno del trabajador: **sin los nombres** de los compañeros.

**El front nuevo vale para las dos bases.** Si la función nueva no existe (la
base de antes, o staging desde una rama), hace lo de antes. Por eso la e2e de
staging, que corre sin la tanda puesta, sale igual.

**La vuelta atrás** devuelve todo a como estaba, también lo malo: el almacén
público y el PIN en la ficha. Si saltara sola, hay que volver a cerrar el
almacén a mano. El CHECK de la auditoría vuelve al de antes solo si aún no hay
ninguna acción `create`; si ya la hay, se queda admitiéndola, porque quitarla
obligaría a borrar rastro.

## Lo que he visto y no entra (para el siguiente encargo)

- **El PIN va sin cifrar** en su tabla aparte, a propósito, para que la vuelta
  atrás lo pueda devolver. Cifrarlo (bcrypt) es una tanda corta cuando esta lleve
  días en verde.
- **`request_clock_correction`** deja que un trabajador pida una corrección para
  otra persona: no mira que sea él. No escribe la marca (la aprueba el
  encargado), pero conviene cerrarlo.
- **Quedan funciones de servidor que no he revisado una a una.** De las que leen
  personal, he quitado las cuatro sin guarda que nadie usa. Hay más que solo
  miran la cuenta (por ejemplo `_resolve_day_counters` y
  `enqueue_training_notice`): merecen una pasada propia, con la lista de
  `pg_proc`.
- **La tanda del #350 (el origen del fichaje) no tiene ensayo de staging
  automático.** `aplicar-staging-conta.yml` solo salta con push a `main`,
  `conta/**` y `reparto-**`, y las ramas `claude/**` no entran. Hay que lanzarlo a
  mano («aplicar»), como el de esta.
