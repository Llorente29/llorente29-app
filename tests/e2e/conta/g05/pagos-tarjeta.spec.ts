// tests/e2e/conta/g05/pagos-tarjeta.spec.ts
//
// G05 · nº 61 · «Pagos con tarjeta» (maqueta Stripe.dc.html, v23), en el
// ordenador y en el móvil:
//   1. Ajustes › Cobros: la cuenta de las tarjetas con sus cuatro mensajes (sin
//      poner, es de un banco, ya existe con otro nombre, bien) y los pagos que
//      esperan, con «Apuntar los 2 pagos» (lo dice).
//   2. La ficha del cliente: «Pagó con tarjeta y falta apuntarlo», con «Apuntar
//      el pago» apagado mientras la cuenta no vale y el enlace a Ajustes; con la
//      cuenta, «Apuntar el pago» y el bloque verde con la factura que sale y sus
//      dos asientos.
//
// La sesión, el marco, el menú y la cuenta de prueba son staging y el código de
// verdad. Lo que leen y guardan las pantallas se simula con la siembra inventada
// del G04 (por qué, en tests/e2e/conta/g04/siembra.ts) y aquí, el estado de la
// cuenta de Stripe y de los pagos (T11: todo inventado). Las funciones de la base
// las prueba su prueba de staging (20261109_g05_apuntar_pendiente_prueba.sql),
// en ROLLBACK. Nada se cobra ni se escribe en GoCardless ni en Stripe.

import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'
import { FRASES, pantallas, siembra } from '../g04/siembra'

const DIR = 'docs/conta/capturas/g05'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const NOMBRES = ['Gestoría de Prueba Norte, S.L.', 'Gestoría de Prueba Sur, S.L.']
type Fila = Record<string, unknown>

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
  return errores
}

async function empresas(s: Sesion): Promise<[string, string]> {
  const r = await rest<{ id: string }[]>(s, 'GET', `company?select=id&account_id=eq.${CUENTA_A.id}&order=created_at.asc`)
  const ids = (r.datos ?? []).map((x) => x.id)
  if (ids.length < 2) throw new Error(`La cuenta de prueba A tiene ${ids.length} empresas y esta prueba necesita dos (HTTP ${r.status}).`)
  return [ids[0], ids[1]]
}

const haceDias = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

/** El estado inventado de la cuenta de Stripe y de los dos pagos que esperan. */
function stripe(Q: string) {
  const s = { cuenta: null as string | null, apuntados: [] as string[] }
  const pago = (id: string, cliente: string, party: string, mes: string, importe: number, ref: string, dias: number): Fila => ({
    id, recibo: `r-${id}`, cliente, party_id: party, mes, importe, referencia: ref, pagado_el: haceDias(dias), numero: null,
  })
  const pagos = [
    pago('dstripe1', 'Panadería Muestra, S.L.', 'c1', '2026-10', 181.5, 'ch_0000000000004F2A', 1),
    pago('dstripe2', 'Estudio de Prueba, S.L.', 'c3', '2026-10', 90, 'ch_00000000000091C7', 2),
  ]
  const estado = (c: string | null): Fila =>
    c === null ? { cuenta: null, nombre: null, motivo: 'sin_cuenta', banco: null }
      : c === '57200000' ? { cuenta: c, nombre: 'Banco de Prueba 9999', motivo: 'de_banco', banco: 'Banco de Prueba' }
        : c === '57200001' ? { cuenta: c, nombre: 'Tarjeta de crédito', motivo: 'otro_nombre', banco: null }
          : { cuenta: c, nombre: 'Plataforma Stripe', motivo: null, banco: null }
  const apuntado = (p: Fila, n: number): Fila => ({
    apuntado: true, recibo: p.recibo, mes: p.mes, importe: p.importe, factura: `f-${p.id}`, numero: `2026/1/${147 + n}`, factura_nueva: true,
    quien: 'Persona Prueba', cuando: new Date().toISOString(), cuenta: '57200003', frase: 'Apuntado: el recibo pagado desde el portal con tarjeta o Bizum. Ya no sale en «Te deben».',
    asientos: [
      { tipo: 'factura', id: `ef-${p.id}`, apuntes: [
        { codigo: '43000001', nombre: p.cliente, debe: p.importe, haber: 0 },
        { codigo: '70500000', nombre: 'Prestaciones de servicios', debe: 0, haber: Math.round(Number(p.importe) / 1.21 * 100) / 100 },
        { codigo: '47700021', nombre: 'IVA', debe: 0, haber: Math.round((Number(p.importe) - Number(p.importe) / 1.21) * 100) / 100 }] },
      { tipo: 'cobro', id: `ec-${p.id}`, apuntes: [
        { codigo: '57200003', nombre: 'Plataforma Stripe', debe: p.importe, haber: 0 },
        { codigo: '43000001', nombre: p.cliente, debe: 0, haber: p.importe }] }],
  })
  const pendientes = () => pagos.filter((p) => !s.apuntados.includes(String(p.id)))
  return {
    s, pagos,
    leer: (): Fila => ({ ...estado(s.cuenta), pendientes: pendientes(),
      apuntados_hoy: pagos.filter((p) => s.apuntados.includes(String(p.id))).map((p, i) => ({ ...p, numero: `2026/1/${147 + i}`, cuando: new Date().toISOString() })) }),
    poner: (c: Fila): Fila => {
      const code = String(c.p_code ?? '')
      const e = estado(code)
      if (e.motivo) return { ...e, guardada: false, frase: e.motivo === 'de_banco' ? `No se ha guardado: la ${code} es tu banco (Banco de Prueba). Elige otra 572, por ejemplo la 57200003.` : `No se ha guardado: la ${code} ya existe y se llama «Tarjeta de crédito». Elige otra 572, por ejemplo la 57200003.` }
      s.cuenta = code
      return { ...e, guardada: true, frase: `Guardada: la cuenta de Stripe es la ${code} «Plataforma Stripe». Hay ${pendientes().length} pagos con tarjeta esperando: apúntalos desde aquí o desde la ficha de cada cliente.` }
    },
    uno: (c: Fila): Fila => {
      const p = pagos.find((x) => x.id === c.p_diferencia)!
      if (s.cuenta !== '57200003') return { apuntado: false, pendiente: true, motivo: 'sin_cuenta', frase: 'No se ha apuntado: falta la cuenta de Stripe en Ajustes.' }
      s.apuntados.push(String(p.id))
      return apuntado(p, 0)
    },
    todos: (): Fila => {
      const ps = pendientes()
      ps.forEach((p) => s.apuntados.push(String(p.id)))
      return { apuntados: ps.map((p, i) => apuntado(p, i)), no: [], frase: `Apuntados ${ps.length} pagos con tarjeta, con su factura y su asiento.` }
    },
    empresa: Q,
  }
}

/** Lo que leen y guardan las pantallas, simulado; las llamadas a funciones quedan apuntadas. */
async function simular(page: Page, Q: string, A: string) {
  const datos = siembra(Q, A)
  const st = stripe(Q)
  // La ficha de Panadería Muestra con su pago con tarjeta que espera; la de GoCardless, conectada en pruebas.
  datos.conta_gestoria_diferencia = [{ id: 'dstripe1', account_id: CUENTA_A.id, company_id: Q, party_id: 'c1', tipo: 'falta_cuenta_stripe', porque_codigo: 'sin_cuenta',
    porque: 'Falta la cuenta de Stripe en Ajustes: el cliente pagó desde el portal…', vigente: true }]
  datos.conta_cobro_gocardless = [{ company_id: Q, entorno: 'pruebas', token_ref: 'ref-de-prueba', conectada_at: haceDias(10), conectada_por_name: 'Persona Prueba',
    ultima_lectura_at: haceDias(0), mandatos_vivos: 6, lineas_activas: 6, al_mes: 1000, por_defecto: true, reintentos_inteligentes: false, abono_coincide: true, abono_porque: null }]
  const llamadas: { f: string; cuerpo: Fila }[] = []
  const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '*/*' }, body: JSON.stringify(cuerpo) })
  await page.route(/\/rest\/v1\/company\?/, async (r) => {
    if (r.request().method() !== 'GET') return r.continue()
    const resp = await r.fetch().catch(() => null)
    if (!resp) return
    let cuerpo: unknown = await resp.json().catch(() => null)
    const cambiar = (x: Fila) => {
      const i = [Q, A].indexOf(String(x.id))
      if (i < 0) return x
      const y: Fila = { ...x, sector: 'gestoria', is_hospitality: false }
      for (const k of ['legal_name', 'trade_name', 'name', 'nombre', 'commercial_name']) if (k in y) y[k] = NOMBRES[i]
      return y
    }
    cuerpo = Array.isArray(cuerpo) ? cuerpo.map((x) => cambiar(x as Fila)) : cuerpo && typeof cuerpo === 'object' ? cambiar(cuerpo as Fila) : cuerpo
    return r.fulfill({ response: resp, body: JSON.stringify(cuerpo) })
  })
  await page.route(/\/rest\/v1\/([a-z_]+)\?/, (r) => {
    const nombre = /\/rest\/v1\/([a-z_]+)\?/.exec(r.request().url())![1]
    if (r.request().method() !== 'GET' || !(nombre in datos)) return r.fallback()
    return json(r, datos[nombre])
  })
  const LECTURAS = pantallas(datos)
  const STRIPE: Record<string, (c: Fila) => unknown> = {
    conta_cobro_cuenta_stripe_leer: () => st.leer(),
    conta_cobro_cuenta_stripe_poner: (c) => st.poner(c),
    conta_recibo_apuntar_pendiente: (c) => {
      const r = st.uno(c)
      // Apuntado: la ficha ya no tiene la incidencia (como en la base).
      if (r.apuntado) datos.conta_gestoria_diferencia = datos.conta_gestoria_diferencia.filter((x) => x.id !== c.p_diferencia)
      return r
    },
    conta_cobro_apuntar_pendientes: () => st.todos(),
  }
  // Ajustes › Cobros espera a sus recordatorios para pintarse entero (como en tests/e2e/conta/pc01/cobros.spec.ts).
  const OTRAS: Record<string, () => unknown> = {
    conta_recordatorios_resumen: () => ({ activos: true, dias: [-3, 0, 7, 15], cambiado: null, clientes_apagados: [], facturas: [], ultimos: [] }),
  }
  await page.route(/\/rest\/v1\/rpc\/([a-z_]+)/, (r) => {
    const f = /\/rest\/v1\/rpc\/([a-z_]+)/.exec(r.request().url())![1]
    const cuerpo = (r.request().postDataJSON() ?? {}) as Fila
    if (f in STRIPE) { if (f !== 'conta_cobro_cuenta_stripe_leer') llamadas.push({ f, cuerpo }); return json(r, STRIPE[f](cuerpo)) }
    if (f in OTRAS) return json(r, OTRAS[f]())
    if (f in LECTURAS) return json(r, LECTURAS[f](cuerpo))
    if (!(f in FRASES)) return r.fallback()
    llamadas.push({ f, cuerpo })
    return json(r, FRASES[f](cuerpo))
  })
  // conta-cobro, «rematar»: la factura con su PDF y su correo (al buzón de pruebas en la demo).
  await page.route(/\/functions\/v1\/conta-cobro/, (r) => {
    const cuerpo = (r.request().postDataJSON() ?? {}) as Fila
    llamadas.push({ f: `conta-cobro:${String(cuerpo.accion)}`, cuerpo })
    return json(r, { ok: true, facturas: { pdfs: 1, enviadas: 1, sinEnviar: [], fallos: [] } })
  })
  return { llamadas, st }
}

async function preparar(page: Page) {
  const s = await entrarComo(page, CUENTA_A.email)
  const [Q, A] = await empresas(s)
  return { Q, A, ...(await simular(page, Q, A)) }
}

const foto = async (page: Page, nombre: string, entera = true) => {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: entera })
}

test('Ajustes › Cobros: la cuenta de las tarjetas con sus cuatro mensajes y «Apuntar los 2 pagos»', async ({ page }) => {
  test.setTimeout(120_000)
  const errores = vigilar(page)
  const { llamadas } = await preparar(page)
  await page.goto('/conta/ajustes/cobros')
  const tarjeta = page.getByRole('region', { name: /Pagos con tarjeta o Bizum/ })
  try { await expect(tarjeta).toBeVisible({ timeout: 30_000 }) } catch (e) {
    // Si no sale, lo que se ve (para saber por qué sin bajar el artefacto).
    console.log(`[lo que se ve en Ajustes › Cobros] ${(await page.locator('main').innerText().catch(() => '(sin main)')).slice(0, 1500)}`)
    throw e
  }

  // Sin poner: «Falta la cuenta», y los dos pagos esperan sin botón para apuntarlos.
  await expect(tarjeta).toContainText('Falta la cuenta')
  await expect(tarjeta).toContainText('Pagos con tarjeta que esperan · 2 · 271,50 €')
  await expect(tarjeta).toContainText('Panadería Muestra, S.L.')
  await expect(tarjeta).toContainText('ch_000…4F2A')
  await expect(tarjeta.getByRole('button', { name: 'Apuntar los 2 pagos' })).toHaveCount(0)
  await tarjeta.scrollIntoViewIfNeeded()
  await foto(page, 'stripe-ajustes-sin-poner')

  const campo = tarjeta.getByRole('textbox', { name: 'Cuenta de Stripe' })
  const guardar = tarjeta.getByRole('button', { name: 'Guardar' })
  // Es de un banco: no se guarda y lo dice.
  await campo.fill('57200000'); await guardar.click()
  await expect(tarjeta).toContainText('La 57200000 es tu banco (Banco de Prueba)')
  await expect(tarjeta).toContainText('El dinero de las tarjetas no entra directo en el banco: pasa antes por Stripe.')
  await foto(page, 'stripe-ajustes-banco')
  // Ya existe con otro nombre: no se guarda y lo dice.
  await campo.fill('57200001'); await guardar.click()
  await expect(tarjeta).toContainText('Esa cuenta ya existe y se llama «Tarjeta de crédito»')
  await foto(page, 'stripe-ajustes-otro-nombre')
  // Bien: guardada, y ahora sí «Apuntar los 2 pagos».
  await campo.fill('57200003'); await guardar.click()
  await expect(tarjeta).toContainText('Guardada · 57200003 «Plataforma Stripe»')
  await expect(tarjeta.getByRole('status').filter({ hasText: 'Guardada: la cuenta de Stripe es la 57200003' })).toBeVisible()
  await foto(page, 'stripe-ajustes-bien')
  await tarjeta.getByRole('button', { name: 'Apuntar los 2 pagos' }).click()
  await expect(tarjeta.getByRole('status').filter({ hasText: 'Apuntados 2 pagos con tarjeta, con su factura y su asiento.' })).toBeVisible()
  await expect(tarjeta).toContainText('Pagos con tarjeta · apuntados hoy')
  await expect(tarjeta.getByText('Apuntado', { exact: true }).first()).toBeVisible()
  await foto(page, 'stripe-ajustes-apuntados')

  expect(llamadas.map((l) => l.f)).toEqual([
    'conta_cobro_cuenta_stripe_poner', 'conta_cobro_cuenta_stripe_poner', 'conta_cobro_cuenta_stripe_poner', 'conta_cobro_apuntar_pendientes', 'conta-cobro:rematar'])
  expect(llamadas.slice(0, 3).map((l) => l.cuerpo.p_code)).toEqual(['57200000', '57200001', '57200003'])
  expect(errores).toEqual([])
})

test('La ficha: «Pagó con tarjeta y falta apuntarlo», apagado sin cuenta; con ella, el bloque verde y sus dos asientos', async ({ page }) => {
  test.setTimeout(120_000)
  const errores = vigilar(page)
  const { Q, llamadas, st } = await preparar(page)
  await page.goto(`/conta/ventas/clientes-y-cuotas/cliente/c1?empresa=${Q}`)
  const aviso = page.locator('.cxst-aviso')
  await expect(aviso).toBeVisible({ timeout: 30_000 })
  await expect(aviso).toContainText('PENDIENTE DE REVISAR')
  await expect(aviso).toContainText('Pagó con tarjeta y falta apuntarlo · 181,50 €')
  await expect(aviso).toContainText('falta decir en qué cuenta de tu contabilidad entra el dinero de las tarjetas.')
  await expect(aviso).toContainText('Recibo de octubre · sin factura hasta que se apunte el pago · referencia ch_000…4F2A')
  await expect(aviso.getByRole('button', { name: 'Apuntar el pago' })).toBeDisabled()
  await expect(aviso.getByRole('link', { name: 'Poner la cuenta en Ajustes › Cobros →' })).toBeVisible()
  await foto(page, 'stripe-ficha-sin-cuenta')

  // Con la cuenta puesta: se puede apuntar.
  st.s.cuenta = '57200003'
  await page.reload()
  await expect(aviso).toContainText('ya está la cuenta de Stripe: puedes apuntarlo.', { timeout: 30_000 })
  await expect(aviso.getByRole('link', { name: 'Ver en Ajustes › Cobros' })).toBeVisible()
  await aviso.getByRole('button', { name: 'Apuntar el pago' }).click()
  const hecho = page.locator('.cxst-hecho')
  await expect(hecho).toContainText('Apuntado: el recibo de octubre está pagado · 181,50 €')
  await expect(hecho).toContainText('Ha salido la factura 2026/1/147 y se le ha enviado por correo.')
  await expect(hecho).toContainText('Ya no está en «Te deben» ni en «Pendiente de revisar».')
  await expect(hecho).toContainText('EN LA CONTABILIDAD')
  await expect(hecho).toContainText('Factura 2026/1/147')
  await expect(hecho).toContainText('Cobro con tarjeta')
  await expect(hecho).toContainText('57200003')
  await expect(hecho.getByRole('link', { name: 'Ver la factura 2026/1/147' })).toBeVisible()
  // La ficha se relee (ya sin la incidencia) y el bloque verde sigue.
  await expect(aviso).toHaveCount(0)
  await foto(page, 'stripe-ficha-apuntado')
  expect(llamadas.map((l) => l.f)).toEqual(['conta_recibo_apuntar_pendiente', 'conta-cobro:rematar'])
  expect(llamadas[0].cuerpo).toEqual({ p_diferencia: 'dstripe1' })
  expect(errores).toEqual([])
})
