// supabase/functions/_shared/gd/siembra.ts
//
// GD · El núcleo de «sembrar pruebas»: deja el Bitrix24 de pruebas y el sandbox
// de GoCardless con los clientes de la demo (datos.ts), siempre igual. Lo usan
// el guion del workflow (scripts/conta/gd/sembrarPruebas.ts) y «Volver a
// empezar» (conta-gd-volver-a-empezar). Sin Node ni Deno: recibe el fetch, los
// dos secretos y por dónde hablar; un fallo lanza un Error con su porqué.
//
// DOS GUARDAS, antes de escribir nada: solo el portal b24-s3mr2y (por la
// dirección del webhook) y solo el sandbox de GoCardless (api-sandbox: un token
// real no vale ahí). Nada del Bitrix24 ni del GoCardless reales de QBO.
// Los secretos no se escriben nunca en lo que se dice.

import { CLIENTES, EMISORES, SOLO_EN_GOCARDLESS, correoDelCliente, ibanDePrueba, resumen, type Cliente } from './datos.ts'

export const PORTAL_DE_PRUEBAS = 'b24-s3mr2y.bitrix24.es'
export const GC_SANDBOX = 'https://api-sandbox.gocardless.com'

type Fila = Record<string, unknown>
export interface Siembra {
  plan(): Promise<void>
  /** Por tandas: hace lo que cabe en `presupuestoMs` (sin él, todo) y dice cuántos quedan. */
  borrarBitrix(presupuestoMs?: number): Promise<{ quedan: number }>
  sembrarBitrix(presupuestoMs?: number): Promise<{ quedan: number }>
  borrarGoCardless(): Promise<void>
  sembrarGoCardless(): Promise<void>
  tocar(): Promise<void>
}

/** La guarda del portal: un webhook entrante, y del portal de pruebas. Devuelve la dirección normalizada. */
export function guardaPortal(url: string): string {
  const b24 = url.trim().replace(/\/?$/, '/')
  const m = /^https:\/\/([A-Za-z0-9.-]+)\/rest\/[0-9]+\/[A-Za-z0-9]+\/$/.exec(b24)
  if (!m) throw new Error('El secreto del Bitrix24 de pruebas no es la dirección de un webhook entrante.')
  if (m[1] !== PORTAL_DE_PRUEBAS) throw new Error(`El webhook es del portal ${m[1]}, no del de pruebas (${PORTAL_DE_PRUEBAS}): no se toca.`)
  return b24
}

const etiqueta = (t: string) => ({ la: t, es: t, en: t })
/** Los campos propios que la demo necesita en las empresas: los que hay se dejan, los que faltan se crean. */
interface CampoPropio { nombre: string; codigo: string; tipo: 'string' | 'enumeration'; opciones?: string[]; multiple?: boolean }
const CAMPOS_EMPRESA: CampoPropio[] = [
  { nombre: 'NIF', codigo: 'UF_CRM_NIF', tipo: 'string' },
  { nombre: 'Situación', codigo: 'UF_CRM_SITUACION', tipo: 'enumeration', opciones: ['Activo', 'Baja', 'Moroso', 'Solo renta'] },
  { nombre: 'Servicios contratados', codigo: 'UF_CRM_SERVICIOS', tipo: 'enumeration', opciones: ['Contabilidad', 'Laboral'], multiple: true },
  { nombre: 'Forma de pago', codigo: 'UF_CRM_FORMA_PAGO', tipo: 'enumeration', opciones: [EMISORES.sociedad.formaDePago, EMISORES.autonomo.formaDePago] },
  { nombre: 'Cuota mensual', codigo: 'UF_CRM_CUOTA_MENSUAL', tipo: 'string' },
  // GB (nº 13) · Los que rellena Sumied desde la pestaña de Bitrix24 (se dejan vacíos al sembrar).
  { nombre: 'Trabajadores', codigo: 'UF_CRM_TRABAJADORES', tipo: 'string' },
  { nombre: 'Estado del cobro', codigo: 'UF_CRM_ESTADO_COBRO', tipo: 'string' },
]

/** Los estados de un mandato que ya no hay que cancelar. */
const MANDATO_ACABADO = ['cancelled', 'failed', 'expired', 'consumed', 'blocked']
const MAYUS = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/,?\s*S\.L\.$/, '')
const euros = (n: number) => Math.round(n * 100)
const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export function crearSiembra(o: { b24Url: string; gcToken: string; decir: (t: string) => void; fetch?: typeof fetch; pausaMs?: number }): Siembra {
  const B24 = guardaPortal(o.b24Url)
  const GC_TOKEN = o.gcToken.trim()
  const f = o.fetch ?? fetch
  const decir = o.decir

  // ── Bitrix24 de pruebas (webhook entrante, permiso CRM) ───────────────────
  async function b24(metodo: string, params: Fila = {}): Promise<Fila> {
    await esperar(o.pausaMs ?? 550) // Bitrix24: 2 peticiones por segundo
    const r = await f(`${B24}${metodo}.json`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) })
    const d = (await r.json().catch(() => ({}))) as Fila
    if (d.error) throw new Error(`Bitrix24 · ${metodo}: ${String(d.error)} ${String(d.error_description ?? '')}`)
    if (!r.ok) throw new Error(`Bitrix24 · ${metodo}: ${r.status}`)
    return d
  }
  async function b24Todos(metodo: string, params: Fila = {}): Promise<Fila[]> {
    const out: Fila[] = []
    let start = 0
    for (let i = 0; i < 100; i++) {
      const d = await b24(metodo, { ...params, start })
      out.push(...((d.result as Fila[]) ?? []))
      if (typeof d.next !== 'number') return out
      start = d.next
    }
    return out
  }

  /** Los campos, y de cada lista, el id de cada opción por su texto. */
  async function camposDeEmpresa(crear: boolean): Promise<Record<string, Record<string, string>>> {
    const hay = (await b24('crm.company.userfield.list', {})).result as Fila[]
    const ids: Record<string, Record<string, string>> = {}
    for (const c of CAMPOS_EMPRESA) {
      let campo = hay.find((x) => x.FIELD_NAME === c.codigo)
      if (!campo) {
        if (!crear) { decir(`  · Falta el campo «${c.nombre}» (${c.codigo}): se crea al sembrar.`); continue }
        await b24('crm.company.userfield.add', { fields: {
          FIELD_NAME: c.codigo.replace(/^UF_CRM_/, ''), USER_TYPE_ID: c.tipo, MULTIPLE: c.multiple ? 'Y' : 'N',
          EDIT_FORM_LABEL: etiqueta(c.nombre), LIST_COLUMN_LABEL: etiqueta(c.nombre), LIST_FILTER_LABEL: etiqueta(c.nombre),
          ...(c.opciones ? { LIST: c.opciones.map((v, i) => ({ VALUE: v, SORT: (i + 1) * 10 })) } : {}),
        } })
        decir(`  ✓ Creado el campo «${c.nombre}» (${c.codigo}).`)
        campo = ((await b24('crm.company.userfield.list', {})).result as Fila[]).find((x) => x.FIELD_NAME === c.codigo)
      }
      if (c.opciones && campo) {
        const lista = (campo.LIST as { ID: string; VALUE: string }[] | undefined) ?? []
        const faltan = c.opciones.filter((v) => !lista.some((x) => x.VALUE === v))
        if (faltan.length) throw new Error(`El campo «${c.nombre}» no tiene estas opciones: ${faltan.join(', ')}. Añádelas en el portal de pruebas.`)
        ids[c.codigo] = Object.fromEntries(lista.map((x) => [x.VALUE, String(x.ID)]))
      }
    }
    return ids
  }

  // Por tandas (nº71): una función tiene un tiempo máximo, y Bitrix24 deja 2 peticiones por segundo; sembrar los 40
  // clientes de una vez tardaba casi 3 minutos y se cortaba. Cada llamada hace lo que cabe en su presupuesto y dice
  // cuántos quedan; la siguiente sigue donde se quedó (borrar lo que queda; sembrar solo las empresas que aún no están).
  async function borrarBitrix(presupuestoMs = Infinity): Promise<{ quedan: number }> {
    const t0 = Date.now()
    const queda = () => Date.now() - t0 < presupuestoMs
    const contactos = await b24Todos('crm.contact.list', { select: ['ID'] })
    let borradosC = 0, borradasE = 0
    for (const c of contactos) { if (!queda()) break; await b24('crm.contact.delete', { id: c.ID }); borradosC++ }
    const empresas = borradosC === contactos.length && queda() ? await b24Todos('crm.company.list', { select: ['ID'] }) : []
    for (const e of empresas) { if (!queda()) break; await b24('crm.company.delete', { id: e.ID }); borradasE++ }
    const quedan = (contactos.length - borradosC) + (borradosC === contactos.length ? empresas.length - borradasE : 1)
    decir(`  ✓ Borrado lo de antes: ${borradasE} empresas y ${borradosC} contactos${quedan > 0 ? '; sigue en otra tanda' : ''}.`)
    return { quedan: Math.max(0, quedan) }
  }

  async function sembrarBitrix(presupuestoMs = Infinity): Promise<{ quedan: number }> {
    const t0 = Date.now()
    const ids = await camposDeEmpresa(true)
    const hay = new Set((await b24Todos('crm.company.list', { select: ['TITLE'] })).map((e) => String(e.TITLE)))
    const faltan = CLIENTES.filter((c) => !hay.has(c.nombre))
    let nEmpresas = 0, nContactos = 0
    for (const c of faltan) {
      if (Date.now() - t0 >= presupuestoMs) break
      const correo = correoDelCliente(c)
      const r = await b24('crm.company.add', { fields: {
        TITLE: c.nombre, COMPANY_TYPE: 'CUSTOMER',
        UF_CRM_NIF: c.nif,
        UF_CRM_SITUACION: ids.UF_CRM_SITUACION[c.situacion],
        UF_CRM_SERVICIOS: c.servicios.map((s) => ids.UF_CRM_SERVICIOS[s]),
        UF_CRM_FORMA_PAGO: ids.UF_CRM_FORMA_PAGO[EMISORES[c.emisor].formaDePago],
        UF_CRM_CUOTA_MENSUAL: c.cuota ? `${c.cuota},00` : '',
        EMAIL: [{ VALUE: correo, VALUE_TYPE: 'WORK' }],
        PHONE: [{ VALUE: `+34 600 000 ${String(100 + CLIENTES.indexOf(c)).slice(-3)}`, VALUE_TYPE: 'WORK' }],
        ADDRESS: 'Calle Mayor, 1', ADDRESS_CITY: c.ciudad, ADDRESS_POSTAL_CODE: '28001', ADDRESS_PROVINCE: 'Madrid',
      } })
      nEmpresas++
      // La persona de contacto de cada sociedad (los autónomos son ellos mismos), justo detrás de su empresa.
      if (c.tipo === 'sociedad') {
        await b24('crm.contact.add', { fields: {
          NAME: c.contacto.nombre, LAST_NAME: c.contacto.apellidos, COMPANY_ID: r.result, POST: 'Administración',
          EMAIL: [{ VALUE: `${c.contacto.nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '.')}.${correo}`, VALUE_TYPE: 'WORK' }],
        } })
        nContactos++
      }
    }
    const quedan = faltan.length - nEmpresas
    decir(`  ✓ Sembrado: ${nEmpresas} empresas y ${nContactos} personas de contacto${quedan > 0 ? `; quedan ${quedan}, en otra tanda` : ` (los ${CLIENTES.length} clientes, 30 sociedades y 10 autónomos)`}.`)
    return { quedan }
  }

  // ── Sandbox de GoCardless ──────────────────────────────────────────────────
  function sinToken() { if (!GC_TOKEN) throw new Error('Falta el token de lectura y escritura del sandbox de GoCardless.') }
  async function gc(metodo: 'GET' | 'POST' | 'DELETE', ruta: string, cuerpo?: Fila, clave?: string): Promise<Fila> {
    const r = await f(`${GC_SANDBOX}${ruta}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${GC_TOKEN}`, 'GoCardless-Version': '2015-07-06', 'Content-Type': 'application/json', Accept: 'application/json',
        ...(clave ? { 'Idempotency-Key': clave } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    })
    const d = (await r.json().catch(() => ({}))) as Fila
    if (!r.ok) {
      const e = d.error as { message?: string; errors?: { field?: string; message?: string }[] } | undefined
      throw new Error(`GoCardless (sandbox) · ${metodo} ${ruta.split('?')[0]}: ${r.status} ${e?.message ?? ''} ${(e?.errors ?? []).map((x) => `${x.field ?? ''} ${x.message ?? ''}`).join('; ')}`)
    }
    return d
  }
  async function gcTodos(recurso: string): Promise<Fila[]> {
    const out: Fila[] = []
    let despues = ''
    for (let i = 0; i < 50; i++) {
      const d = await gc('GET', `/${recurso}?limit=500${despues ? `&after=${despues}` : ''}`)
      out.push(...((d[recurso] as Fila[]) ?? []))
      const sig = ((d.meta as Fila | undefined)?.cursors as Fila | undefined)?.after
      if (!sig) return out
      despues = String(sig)
    }
    return out
  }

  async function clienteEnGc(n: number, datos: { nombre: string; correo: string; nif: string; given: string; family: string; ciudad: string }) {
    const sello = `gd-${Date.now()}-${n}`
    const cu = ((await gc('POST', '/customers', { customers: {
      email: datos.correo, given_name: datos.given, family_name: datos.family, company_name: datos.nombre,
      address_line1: 'Calle Mayor, 1', city: datos.ciudad, postal_code: '28001', country_code: 'ES', language: 'es',
      metadata: { nif: datos.nif, demo: 'gd' },
    } }, `${sello}-cu`)).customers as Fila)
    const ba = ((await gc('POST', '/customer_bank_accounts', { customer_bank_accounts: {
      account_holder_name: datos.nombre.slice(0, 70), iban: ibanDePrueba(n), links: { customer: cu.id },
    } }, `${sello}-ba`)).customer_bank_accounts as Fila)
    const md = ((await gc('POST', '/mandates', { mandates: { scheme: 'sepa_core', links: { customer_bank_account: ba.id } } }, `${sello}-md`)).mandates as Fila)
    return { mandato: String(md.id), sello }
  }

  async function suscripcion(mandato: string, sello: string, nombre: string, importe: number, anual = false) {
    await gc('POST', '/subscriptions', { subscriptions: {
      amount: euros(importe), currency: 'EUR', name: nombre.slice(0, 255),
      interval_unit: anual ? 'yearly' : 'monthly', ...(anual ? { month: 'june', day_of_month: 25 } : { day_of_month: 5 }),
      links: { mandate: mandato },
    } }, `${sello}-${nombre}`)
  }

  async function borrarGoCardless() {
    sinToken()
    // El sandbox no deja quitar un cliente con mandatos vivos (422): primero se
    // cancelan sus mandatos (eso cancela también sus suscripciones y sus cobros
    // pendientes) y después se quita el cliente.
    const vivos = (await gcTodos('mandates')).filter((m) => !MANDATO_ACABADO.includes(String(m.status)))
    for (const m of vivos) await gc('POST', `/mandates/${String(m.id)}/actions/cancel`, { data: { metadata: { demo: 'gd' } } }, `gd-cancelar-${String(m.id)}`)
    const antes = await gcTodos('customers')
    for (const c of antes) await gc('DELETE', `/customers/${String(c.id)}`, undefined, `gd-quitar-${String(c.id)}`)
    decir(`  ✓ Quitado lo de antes del sandbox: ${vivos.length} mandatos cancelados y ${antes.length} clientes.`)
  }

  async function sembrarGoCardless() {
    sinToken()
    let n = 0, subs = 0, sueltos = 0
    const enGc = CLIENTES.filter((c): c is Cliente & { gc: NonNullable<Cliente['gc']> } => !!c.gc)
    for (const c of enGc) {
      n++
      const { mandato, sello } = await clienteEnGc(n, { nombre: c.nombre, correo: correoDelCliente(c), nif: c.nif, ciudad: c.ciudad,
        // El sandbox deja un mandato SEPA en «pending_submission» y no lo activa solo, y su simulador
        // «mandate_activated» no vale para SEPA. Un cliente «Successful» nace con el mandato activo y cobra al
        // momento: así se siembran los normales (Julio, nº32). En Sumied no se ve: el nombre sale de
        // company_name; la persona de contacto va en los apellidos. Los «por_firmar» (2, nº62) llevan su nombre: su
        // mandato se queda en «pending_submission» y Sumied los enseña por firmar.
        given: c.gc.escenario === 'normal' ? 'Successful' : c.gc.escenario === 'por_firmar' ? c.contacto.nombre : c.gc.escenario, family: `${c.contacto.nombre} ${c.contacto.apellidos}` })
      if (c.gc.mensual) { await suscripcion(mandato, sello, `GESTORIA MENSUAL ${MAYUS(c.nombre)}`, c.gc.mensual); subs++ }
      for (const t of c.gc.trabajadores) { await suscripcion(mandato, sello, `GESTION LABORAL ${MAYUS(t)}`, 25); subs++ }
      // Con el mismo nombre en todos, la importación lo convierte en UN servicio.
      if (c.gc.anual) { await suscripcion(mandato, sello, 'IMPUESTO DE SOCIEDADES', 300, true); subs++ }
      if (c.gc.suelto) {
        // nº94 · Solo uno que nunca se paga: uno pagado deja una liquidación sin factura en Sumied.
        if (c.gc.escenario !== 'Penniless') throw new Error(`GD: ${c.nombre} tiene un cobro suelto que se pagaría (${c.gc.escenario}): solo Penniless.`)
        await gc('POST', '/payments', { payments: { amount: euros(c.gc.suelto), currency: 'EUR', description: 'Asesoría puntual', links: { mandate: mandato } } }, `${sello}-pm`)
        sueltos++
      }
    }
    // El cobro de GoCardless sin cliente en el CRM.
    n++
    const s = SOLO_EN_GOCARDLESS
    const { mandato, sello } = await clienteEnGc(n, { nombre: s.nombre, correo: s.correo, nif: s.nif, given: 'Successful', family: 'Alba Centro de Estudios', ciudad: 'Madrid' })
    await suscripcion(mandato, sello, `GESTORIA MENSUAL ${MAYUS(s.nombre)}`, s.mensual); subs++
    decir(`  ✓ Sembrado en el sandbox: ${n} clientes con su mandato, ${subs} suscripciones y ${sueltos} ${sueltos === 1 ? 'cobro suelto que sale devuelto' : 'cobros sueltos que salen devueltos'} (Penniless).`)
  }

  async function plan() {
    const empresas = await b24Todos('crm.company.list', { select: ['ID', 'TITLE'] })
    const contactos = await b24Todos('crm.contact.list', { select: ['ID'] })
    decir(`Bitrix24 de pruebas (${PORTAL_DE_PRUEBAS}): hoy ${empresas.length} empresas y ${contactos.length} contactos.`)
    await camposDeEmpresa(false)
    if (GC_TOKEN) {
      const clientes = await gcTodos('customers')
      const mandatos = await gcTodos('mandates')
      const activas = (await gcTodos('subscriptions')).filter((x) => x.status === 'active')
      decir(`Sandbox de GoCardless: hoy ${clientes.length} clientes, ${mandatos.length} mandatos y ${activas.length} suscripciones activas.`)
    } else decir('Sandbox de GoCardless: falta el token de lectura y escritura (no se lee).')
    const r = resumen()
    decir(`Lo que dejaría: ${r.clientes} clientes en Bitrix24 (${r.porTipo.sociedad} sociedades, ${r.porTipo.autonomo} autónomos; ` +
      `${Object.entries(r.porSituacion).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ')}) y ${r.enGoCardless} en GoCardless ` +
      `(${r.trabajadores} trabajadores, ${r.alMes} € al mes; ${r.escenarios.join('; ')}).`)
  }

  /**
   * Un cambio pequeño en cada sistema, para probar «Al instante» de verdad (Julio, nº32):
   *   · Bitrix24: una nota en «Comentarios» de Librería El Faro.
   *   · Sandbox: un cobro suelto de 15 € a Clínica Dental Sonrisas (Successful: se cobra al momento).
   */
  async function tocar() {
    sinToken()
    const hora = new Date().toISOString()
    const [empresa] = (await b24('crm.company.list', { filter: { TITLE: 'Librería El Faro, S.L.' }, select: ['ID', 'TITLE'] })).result as Fila[]
    if (!empresa) throw new Error('No está «Librería El Faro, S.L.» en el portal de pruebas: ¿falta sembrar?')
    await b24('crm.company.update', { id: empresa.ID, fields: { COMMENTS: `Prueba de «Al instante» (GD), ${hora}.` } })
    decir(`✓ Bitrix24: cambiada la empresa ${String(empresa.ID)} («${String(empresa.TITLE)}») a las ${hora}.`)
    const clientes = await gcTodos('customers')
    const cliente = clientes.find((c) => c.company_name === 'Clínica Dental Sonrisas, S.L.')
    if (!cliente) throw new Error('No está «Clínica Dental Sonrisas, S.L.» en el sandbox: ¿falta sembrar?')
    const mandato = (await gcTodos('mandates')).find((m) => (m.links as Fila | undefined)?.customer === cliente.id && !MANDATO_ACABADO.includes(String(m.status)))
    if (!mandato) throw new Error('Clínica Dental Sonrisas no tiene un mandato vivo en el sandbox.')
    const pm = ((await gc('POST', '/payments', { payments: { amount: 1500, currency: 'EUR', description: 'Prueba de Al instante', links: { mandate: mandato.id } } },
      `gd-tocar-${hora}`)).payments as Fila)
    decir(`✓ Sandbox: cobro suelto ${String(pm.id)} de 15 € a Clínica Dental Sonrisas (Successful) a las ${hora}.`)
  }

  return { plan, borrarBitrix, sembrarBitrix, borrarGoCardless, sembrarGoCardless, tocar }
}
