// scripts/conta/gd/sembrarPruebas.ts
//
// GD · «GD · sembrar pruebas»: deja el Bitrix24 de pruebas y el sandbox de
// GoCardless con los clientes de la demo (datos.ts), siempre igual: se puede
// repetir para volver al estado inicial (Julio, nº27). Lo lanza
// .github/workflows/gd-sembrar-pruebas.yml.
//
//   npx tsx scripts/conta/gd/sembrarPruebas.ts plan      solo lee: qué hay y qué haría
//   npx tsx scripts/conta/gd/sembrarPruebas.ts sembrar   borra lo de antes y siembra
//
// Escribir en el portal de pruebas y en el sandbox está permitido (Julio, nº27):
// son de pruebas. DOS GUARDAS: solo se escribe en el portal b24-s3mr2y (por su
// dirección) y solo en el sandbox de GoCardless (api-sandbox: un token real no
// vale ahí). Nada del Bitrix24 ni del GoCardless reales de QBO.
// Los secretos llegan por el entorno y no se escriben nunca.

import { CLIENTES, EMISORES, SOLO_EN_GOCARDLESS, correoDelCliente, ibanDePrueba, resumen, type Cliente } from './datos.ts'

const PORTAL_DE_PRUEBAS = 'b24-s3mr2y.bitrix24.es'
const GC = 'https://api-sandbox.gocardless.com'

const env = (k: string) => (process.env[k] ?? '').trim()
const fallo = (t: string): never => { console.log(`::error::${t}`); process.exit(1) }
const decir = (t: string) => console.log(t)
const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
type Fila = Record<string, unknown>

// ── Bitrix24 de pruebas (webhook entrante, permiso CRM) ─────────────────────

const B24 = env('G01D_B24_ENTRANTE_URL').replace(/\/?$/, '/')
function guardaPortal() {
  const m = /^https:\/\/([A-Za-z0-9.-]+)\/rest\/[0-9]+\/[A-Za-z0-9]+\/$/.exec(B24)
  if (!m) fallo('G01D_B24_ENTRANTE_URL no es la dirección de un webhook entrante.')
  if (m![1] !== PORTAL_DE_PRUEBAS) fallo(`El webhook es del portal ${m![1]}, no del de pruebas (${PORTAL_DE_PRUEBAS}): no se toca.`)
}

async function b24(metodo: string, params: Fila = {}): Promise<Fila> {
  await esperar(550) // Bitrix24: 2 peticiones por segundo
  const r = await fetch(`${B24}${metodo}.json`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) })
  const d = (await r.json().catch(() => ({}))) as Fila
  if (d.error) fallo(`Bitrix24 · ${metodo}: ${String(d.error)} ${String(d.error_description ?? '')}`)
  if (!r.ok) fallo(`Bitrix24 · ${metodo}: ${r.status}`)
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

const etiqueta = (t: string) => ({ la: t, es: t, en: t })

/** Los campos propios que la demo necesita en las empresas: los que hay se dejan, los que faltan se crean. */
interface CampoPropio { nombre: string; codigo: string; tipo: 'string' | 'enumeration'; opciones?: string[]; multiple?: boolean }
const CAMPOS_EMPRESA: CampoPropio[] = [
  { nombre: 'NIF', codigo: 'UF_CRM_NIF', tipo: 'string' },
  { nombre: 'Situación', codigo: 'UF_CRM_SITUACION', tipo: 'enumeration', opciones: ['Activo', 'Baja', 'Moroso', 'Solo renta'] },
  { nombre: 'Servicios contratados', codigo: 'UF_CRM_SERVICIOS', tipo: 'enumeration', opciones: ['Contabilidad', 'Laboral'], multiple: true },
  { nombre: 'Forma de pago', codigo: 'UF_CRM_FORMA_PAGO', tipo: 'enumeration', opciones: [EMISORES.sociedad.formaDePago, EMISORES.autonomo.formaDePago] },
  { nombre: 'Cuota mensual', codigo: 'UF_CRM_CUOTA_MENSUAL', tipo: 'string' },
]

/** Los campos, y de cada lista, el id de cada opción por su texto. */
async function camposDeEmpresa(crear: boolean): Promise<Record<string, Record<string, string>>> {
  const hay = (await b24('crm.company.userfield.list', {})).result as Fila[]
  const ids: Record<string, Record<string, string>> = {}
  for (const c of CAMPOS_EMPRESA) {
    let f = hay.find((x) => x.FIELD_NAME === c.codigo)
    if (!f) {
      if (!crear) { decir(`  · Falta el campo «${c.nombre}» (${c.codigo}): se crea al sembrar.`); continue }
      await b24('crm.company.userfield.add', { fields: {
        FIELD_NAME: c.codigo.replace(/^UF_CRM_/, ''), USER_TYPE_ID: c.tipo, MULTIPLE: c.multiple ? 'Y' : 'N',
        EDIT_FORM_LABEL: etiqueta(c.nombre), LIST_COLUMN_LABEL: etiqueta(c.nombre), LIST_FILTER_LABEL: etiqueta(c.nombre),
        ...(c.opciones ? { LIST: c.opciones.map((v, i) => ({ VALUE: v, SORT: (i + 1) * 10 })) } : {}),
      } })
      decir(`  ✓ Creado el campo «${c.nombre}» (${c.codigo}).`)
      f = ((await b24('crm.company.userfield.list', {})).result as Fila[]).find((x) => x.FIELD_NAME === c.codigo)
    }
    if (c.opciones && f) {
      const lista = (f.LIST as { ID: string; VALUE: string }[] | undefined) ?? []
      const faltan = c.opciones.filter((v) => !lista.some((x) => x.VALUE === v))
      if (faltan.length) fallo(`El campo «${c.nombre}» no tiene estas opciones: ${faltan.join(', ')}. Añádelas en el portal de pruebas.`)
      ids[c.codigo] = Object.fromEntries(lista.map((x) => [x.VALUE, String(x.ID)]))
    }
  }
  return ids
}

async function sembrarBitrix() {
  const ids = await camposDeEmpresa(true)
  const empresas = await b24Todos('crm.company.list', { select: ['ID'] })
  const contactos = await b24Todos('crm.contact.list', { select: ['ID'] })
  for (const c of contactos) await b24('crm.contact.delete', { id: c.ID })
  for (const e of empresas) await b24('crm.company.delete', { id: e.ID })
  decir(`  ✓ Borrado lo de antes: ${empresas.length} empresas y ${contactos.length} contactos.`)

  let nEmpresas = 0, nContactos = 0
  for (const c of CLIENTES) {
    const correo = correoDelCliente(c)
    const r = await b24('crm.company.add', { fields: {
      TITLE: c.nombre, COMPANY_TYPE: 'CUSTOMER',
      UF_CRM_NIF: c.nif,
      UF_CRM_SITUACION: ids.UF_CRM_SITUACION[c.situacion],
      UF_CRM_SERVICIOS: c.servicios.map((s) => ids.UF_CRM_SERVICIOS[s]),
      UF_CRM_FORMA_PAGO: ids.UF_CRM_FORMA_PAGO[EMISORES[c.emisor].formaDePago],
      UF_CRM_CUOTA_MENSUAL: c.cuota ? `${c.cuota},00` : '',
      EMAIL: [{ VALUE: correo, VALUE_TYPE: 'WORK' }],
      PHONE: [{ VALUE: `+34 600 000 ${String(100 + nEmpresas).slice(-3)}`, VALUE_TYPE: 'WORK' }],
      ADDRESS: 'Calle Mayor, 1', ADDRESS_CITY: c.ciudad, ADDRESS_POSTAL_CODE: '28001', ADDRESS_PROVINCE: 'Madrid',
    } })
    nEmpresas++
    // La persona de contacto de cada sociedad (los autónomos son ellos mismos).
    if (c.tipo === 'sociedad') {
      await b24('crm.contact.add', { fields: {
        NAME: c.contacto.nombre, LAST_NAME: c.contacto.apellidos, COMPANY_ID: r.result, POST: 'Administración',
        EMAIL: [{ VALUE: `${c.contacto.nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '.')}.${correo}`, VALUE_TYPE: 'WORK' }],
      } })
      nContactos++
    }
  }
  decir(`  ✓ Sembrado: ${nEmpresas} empresas (30 sociedades y 10 autónomos) y ${nContactos} personas de contacto.`)
}

// ── Sandbox de GoCardless ────────────────────────────────────────────────────

const GC_TOKEN = env('GD_GC_SANDBOX_RW_TOKEN')
async function gc(metodo: 'GET' | 'POST' | 'DELETE', ruta: string, cuerpo?: Fila, clave?: string): Promise<Fila> {
  const r = await fetch(`${GC}${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${GC_TOKEN}`, 'GoCardless-Version': '2015-07-06', 'Content-Type': 'application/json', Accept: 'application/json',
      ...(clave ? { 'Idempotency-Key': clave } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  })
  const d = (await r.json().catch(() => ({}))) as Fila
  if (!r.ok) {
    const e = d.error as { message?: string; errors?: { field?: string; message?: string }[] } | undefined
    fallo(`GoCardless (sandbox) · ${metodo} ${ruta.split('?')[0]}: ${r.status} ${e?.message ?? ''} ${(e?.errors ?? []).map((x) => `${x.field ?? ''} ${x.message ?? ''}`).join('; ')}`)
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

const MAYUS = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/,?\s*S\.L\.$/, '')
const euros = (n: number) => Math.round(n * 100)

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

async function sembrarGoCardless() {
  // Lo de antes fuera: quitar un cliente cancela sus mandatos y suscripciones.
  const antes = await gcTodos('customers')
  for (const c of antes) await gc('DELETE', `/customers/${String(c.id)}`, undefined, `gd-quitar-${String(c.id)}`)
  decir(`  ✓ Quitados los ${antes.length} clientes de antes del sandbox.`)

  let n = 0, subs = 0, sueltos = 0
  const enGc = CLIENTES.filter((c): c is Cliente & { gc: NonNullable<Cliente['gc']> } => !!c.gc)
  for (const c of enGc) {
    n++
    const { mandato, sello } = await clienteEnGc(n, { nombre: c.nombre, correo: correoDelCliente(c), nif: c.nif, ciudad: c.ciudad,
      given: c.gc.escenario === 'normal' ? c.contacto.nombre : c.gc.escenario, family: c.contacto.apellidos })
    if (c.gc.mensual) { await suscripcion(mandato, sello, `GESTORIA MENSUAL ${MAYUS(c.nombre)}`, c.gc.mensual); subs++ }
    for (const t of c.gc.trabajadores) { await suscripcion(mandato, sello, `GESTION LABORAL ${MAYUS(t)}`, 25); subs++ }
    if (c.gc.anual) { await suscripcion(mandato, sello, `IMPUESTO DE SOCIEDADES ${MAYUS(c.nombre)}`, 300, true); subs++ }
    if (c.gc.suelto) {
      await gc('POST', '/payments', { payments: { amount: euros(c.gc.suelto), currency: 'EUR', description: 'Asesoría puntual', links: { mandate: mandato } } }, `${sello}-pm`)
      sueltos++
    }
  }
  // El cobro de GoCardless sin cliente en el CRM.
  n++
  const s = SOLO_EN_GOCARDLESS
  const { mandato, sello } = await clienteEnGc(n, { nombre: s.nombre, correo: s.correo, nif: s.nif, given: 'Alba', family: 'Centro de Estudios', ciudad: 'Madrid' })
  await suscripcion(mandato, sello, `GESTORIA MENSUAL ${MAYUS(s.nombre)}`, s.mensual); subs++
  decir(`  ✓ Sembrado en el sandbox: ${n} clientes con su mandato, ${subs} suscripciones y ${sueltos} cobros sueltos (Successful, Penniless y Fickle).`)
}

// ── Plan (solo lee) ──────────────────────────────────────────────────────────

async function plan() {
  const empresas = await b24Todos('crm.company.list', { select: ['ID', 'TITLE'] })
  const contactos = await b24Todos('crm.contact.list', { select: ['ID'] })
  decir(`Bitrix24 de pruebas (${PORTAL_DE_PRUEBAS}): hoy ${empresas.length} empresas y ${contactos.length} contactos.`)
  await camposDeEmpresa(false)
  if (GC_TOKEN) {
    const clientes = await gcTodos('customers')
    const mandatos = await gcTodos('mandates')
    const subs = (await gcTodos('subscriptions')).filter((x) => x.status === 'active')
    decir(`Sandbox de GoCardless: hoy ${clientes.length} clientes, ${mandatos.length} mandatos y ${subs.length} suscripciones activas.`)
  } else decir('Sandbox de GoCardless: falta GD_GC_SANDBOX_RW_TOKEN (no se lee).')
  const r = resumen()
  decir(`Lo que dejaría: ${r.clientes} clientes en Bitrix24 (${r.porTipo.sociedad} sociedades, ${r.porTipo.autonomo} autónomos; ` +
    `${Object.entries(r.porSituacion).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ')}) y ${r.enGoCardless} en GoCardless ` +
    `(${r.trabajadores} trabajadores, ${r.alMes} € al mes; ${r.escenarios.join('; ')}).`)
}

const modo = process.argv[2]
if (!['plan', 'sembrar'].includes(modo)) fallo('uso: sembrarPruebas.ts plan | sembrar')
if (!env('G01D_B24_ENTRANTE_URL')) fallo('Falta el secreto G01D_B24_ENTRANTE_URL.')
guardaPortal()
if (modo === 'plan') await plan()
else {
  if (!GC_TOKEN) fallo('Falta el secreto GD_GC_SANDBOX_RW_TOKEN (lectura y escritura del sandbox).')
  decir('Bitrix24 de pruebas:'); await sembrarBitrix()
  decir('Sandbox de GoCardless:'); await sembrarGoCardless()
  decir('Hecho: el portal de pruebas y el sandbox están como el primer día de la demo.')
}
