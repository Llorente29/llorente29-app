// GD · nº71 · El portal de pruebas, por tandas: sembrar los 40 clientes de una vez tardaba casi 3 minutos y la
// función se cortaba. Cada llamada hace lo que cabe en su presupuesto y dice cuántos quedan; la siguiente sigue sin
// repetir ninguna empresa. Con un Bitrix24 falso en memoria. Datos inventados (T11).
import { describe, expect, it } from 'vitest'
import { crearSiembra, PORTAL_DE_PRUEBAS } from '../../../../../supabase/functions/_shared/gd/siembra'
import { CLIENTES } from '../../../../../supabase/functions/_shared/gd/datos'

function bitrixFalso() {
  const empresas: { ID: string; TITLE: string }[] = []
  const contactos: { ID: string }[] = []
  let n = 0
  const campos = [
    { FIELD_NAME: 'UF_CRM_NIF' }, { FIELD_NAME: 'UF_CRM_CUOTA_MENSUAL' },
    // GB (nº 13) · Los dos que rellena Sumied desde la pestaña de Bitrix24.
    { FIELD_NAME: 'UF_CRM_TRABAJADORES' }, { FIELD_NAME: 'UF_CRM_ESTADO_COBRO' },
    { FIELD_NAME: 'UF_CRM_SITUACION', LIST: ['Activo', 'Baja', 'Moroso', 'Solo renta'].map((v, i) => ({ ID: `s${i}`, VALUE: v })) },
    { FIELD_NAME: 'UF_CRM_SERVICIOS', LIST: ['Contabilidad', 'Laboral'].map((v, i) => ({ ID: `v${i}`, VALUE: v })) },
    { FIELD_NAME: 'UF_CRM_FORMA_PAGO', LIST: ['Gestoría Demo', 'Elena Campos'].map((v, i) => ({ ID: `f${i}`, VALUE: v })) },
  ]
  const f = (async (u: string, init?: RequestInit) => {
    const metodo = String(u).split('/').pop()!.replace('.json', '')
    const p = init?.body ? JSON.parse(String(init.body)) : {}
    const r = (result: unknown) => new Response(JSON.stringify({ result }), { status: 200 })
    if (metodo === 'crm.company.userfield.list') return r(campos)
    if (metodo === 'crm.company.list') return r(empresas)
    if (metodo === 'crm.contact.list') return r(contactos)
    if (metodo === 'crm.company.add') { const ID = `e${++n}`; empresas.push({ ID, TITLE: p.fields.TITLE }); return r(ID) }
    if (metodo === 'crm.contact.add') { contactos.push({ ID: `c${++n}` }); return r(`c${n}`) }
    if (metodo === 'crm.company.delete') { empresas.splice(empresas.findIndex((e) => e.ID === p.id), 1); return r(true) }
    if (metodo === 'crm.contact.delete') { contactos.splice(contactos.findIndex((c) => c.ID === p.id), 1); return r(true) }
    throw new Error(metodo)
  }) as unknown as typeof fetch
  return { f, empresas, contactos }
}

const siembra = (f: typeof fetch) => crearSiembra({ b24Url: `https://${PORTAL_DE_PRUEBAS}/rest/1/abc123/`, gcToken: '', decir: () => {}, fetch: f, pausaMs: 0 })

describe('GD · nº71 · el portal de pruebas, por tandas', () => {
  it('sin presupuesto, todo de una vez: 40 empresas y una persona de contacto por sociedad', async () => {
    const b = bitrixFalso()
    expect(await siembra(b.f).sembrarBitrix()).toEqual({ quedan: 40 - 40 })
    expect(b.empresas).toHaveLength(CLIENTES.length)
    expect(b.contactos).toHaveLength(CLIENTES.filter((c) => c.tipo === 'sociedad').length)
  })

  it('sin tiempo, no hace nada y dice cuántas quedan; la tanda siguiente sigue sin repetir ninguna', async () => {
    const b = bitrixFalso()
    expect(await siembra(b.f).sembrarBitrix(0)).toEqual({ quedan: 40 })
    expect(b.empresas).toHaveLength(0)
    b.empresas.push({ ID: 'ya', TITLE: CLIENTES[0].nombre }) // una que dejó la tanda de antes
    expect(await siembra(b.f).sembrarBitrix()).toEqual({ quedan: 0 })
    expect(b.empresas).toHaveLength(40)
    expect(new Set(b.empresas.map((e) => e.TITLE)).size).toBe(40)
  })

  it('borrar, igual: primero los contactos y después las empresas, hasta que no queda nada', async () => {
    const b = bitrixFalso()
    await siembra(b.f).sembrarBitrix()
    expect((await siembra(b.f).borrarBitrix(0)).quedan).toBeGreaterThan(0)
    expect(await siembra(b.f).borrarBitrix()).toEqual({ quedan: 0 })
    expect(b.empresas).toHaveLength(0)
    expect(b.contactos).toHaveLength(0)
  })
})
