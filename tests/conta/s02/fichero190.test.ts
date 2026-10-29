// S02 · «Descargar el fichero oficial» del 190 (conta-hacienda, fichero_190):
// quién puede, que el fichero sale comprobado y que lo que no vale se dice.
// Datos INVENTADOS (NIF con su control bien hecho, nombres de prueba).
import { describe, expect, it } from 'vitest'
import { fichero190 } from '../../../supabase/functions/_shared/hacienda/acciones'
import type { ClienteBase } from '../../../supabase/functions/_shared/certificados/almacen'

const DATOS = {
  ejercicio: 2026, nif: 'B00000000', nombre: 'Empresa de Prueba SL', numero: '1902026000001',
  contacto: { telefono: '600000000', nombre: 'Persona Prueba', correo: 'prueba@example.com' },
  perceptores: [
    { nif: '00000000T', nombre: 'Uno Uno, Ana', provincia: '08', clave: 'G', subclave: '01', integra: 1000, retenciones: 150, anio_nacimiento: null },
    { nif: '00000001R', nombre: 'Dos Dos, Íñigo', provincia: '28', clave: 'A', subclave: null, integra: 4000, retenciones: 400, anio_nacimiento: 1990 },
  ],
}

function base(o: { gestiona?: boolean; datos?: Partial<typeof DATOS>; error?: string } = {}) {
  const fns: string[] = []
  const b = {
    rpc(fn: string) {
      fns.push(fn)
      if (fn === 'conta_impuesto_gestiona') return Promise.resolve({ data: o.gestiona ?? true, error: null })
      if (fn === 'conta_impuesto_190_fichero') {
        if (o.error) return Promise.resolve({ data: null, error: { message: o.error, code: '22023' } })
        return Promise.resolve({ data: { ...DATOS, ...o.datos }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    },
  } as unknown as ClienteBase
  return { b, fns }
}

describe('fichero190', () => {
  it('quien gestiona la empresa lo baja: tres registros de 500, comprobados', async () => {
    const { b, fns } = base()
    const r = await fichero190(b, { usuario: 'u', declaracion: 'd', empresa: 'e' })
    expect(r.ok).toBe(true)
    expect(r).toMatchObject({ nombre: '190_2026.txt' })
    expect(r.mensaje).toContain('2 perceptores')
    const f = String((r as { fichero: string }).fichero)
    expect(f.split('\r\n').filter(Boolean).map((x) => x.length)).toEqual([500, 500, 500])
    expect(fns).toEqual(['conta_impuesto_gestiona', 'conta_impuesto_190_fichero'])
  })
  it('quien no gestiona la empresa, no: ni se piden los datos', async () => {
    const { b, fns } = base({ gestiona: false })
    expect(await fichero190(b, { usuario: 'u', declaracion: 'd', empresa: 'e' })).toMatchObject({ ok: false, motivo: 'no_deja' })
    expect(fns).toEqual(['conta_impuesto_gestiona'])
  })
  it('con algo por resolver, la base no da los datos y se dice su frase', async () => {
    const r = await fichero190(base({ error: 'Este 190 tiene 2 cosas que resolver en «Lo comprobado»: sin eso no se prepara el fichero.' }).b, { usuario: 'u', declaracion: 'd', empresa: 'e' })
    expect(r.ok).toBe(false)
    expect(r.mensaje).toContain('2 cosas que resolver')
  })
  it('un perceptor sin provincia no da un fichero que Hacienda rechazaría: dice cuál', async () => {
    const r = await fichero190(base({ datos: { perceptores: [{ ...DATOS.perceptores[0], provincia: null as unknown as string }] } }).b, { usuario: 'u', declaracion: 'd', empresa: 'e' })
    expect(r.ok).toBe(false)
    expect(r.mensaje).toMatch(/Uno Uno, Ana: la provincia «falta»/)
  })
})
