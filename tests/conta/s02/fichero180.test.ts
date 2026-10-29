// S02 · «Descargar el fichero oficial» del 180 (conta-hacienda, fichero_180):
// quién puede, que el fichero sale comprobado y que lo que no vale se dice.
// Datos INVENTADOS (NIF con su control bien hecho, nombres y local de prueba).
import { describe, expect, it } from 'vitest'
import { fichero180 } from '../../../supabase/functions/_shared/hacienda/acciones'
import type { ClienteBase } from '../../../supabase/functions/_shared/certificados/almacen'

const LOCAL = { situacion: '1', catastral: '0000000AA0000A0001AA', tipo_via: 'CL', nombre_via: 'Calle de Prueba', tipo_numeracion: 'NUM', numero: '12',
  municipio: 'Madrid', codigo_municipio: '28079', provincia: '28', cp: '28001' }
const DATOS = {
  ejercicio: 2025, nif: 'B00000000', nombre: 'Empresa de Prueba SL', numero: '1802025000001',
  contacto: { telefono: '600000000', nombre: 'Persona Prueba' },
  perceptores: [
    { nif: '00000000T', nombre: 'Uno Uno, Ana', provincia: '28', modalidad: '1', base: 10389.04, porcentaje: 19, retenciones: 1973.92, inmueble: LOCAL as Record<string, string | null> | null },
    { nif: '00000001R', nombre: 'Dos Dos, Íñigo', provincia: '08', modalidad: '1', base: 2500, porcentaje: 19, retenciones: 475, inmueble: { ...LOCAL, situacion: '4', catastral: null } },
  ],
}

function base(o: { gestiona?: boolean; datos?: Partial<typeof DATOS>; error?: string } = {}) {
  const fns: string[] = []
  const b = {
    rpc(fn: string) {
      fns.push(fn)
      if (fn === 'conta_impuesto_gestiona') return Promise.resolve({ data: o.gestiona ?? true, error: null })
      if (fn === 'conta_impuesto_180_fichero') {
        if (o.error) return Promise.resolve({ data: null, error: { message: o.error, code: '22023' } })
        return Promise.resolve({ data: { ...DATOS, ...o.datos }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    },
  } as unknown as ClienteBase
  return { b, fns }
}
const a = { usuario: 'u', declaracion: 'd', empresa: 'e' }

describe('fichero180', () => {
  it('quien gestiona la empresa lo baja: tres registros de 500, comprobados, con lo de 2025 presentado', async () => {
    const { b, fns } = base()
    const r = await fichero180(b, a)
    expect(r.ok).toBe(true)
    expect(r).toMatchObject({ nombre: '180_2025.txt' })
    expect(r.mensaje).toContain('2 arrendadores')
    const regs = String((r as { fichero: string }).fichero).split('\r\n').filter(Boolean)
    expect(regs.map((x) => x.length)).toEqual([500, 500, 500])
    // Posiciones del anexo VI: base 146-160 y retenciones 161-175 del registro 1.
    expect(regs[0].slice(145, 160)).toBe('000000001288904')
    expect(regs[0].slice(160, 175)).toBe('000000000244892')
    expect(fns).toEqual(['conta_impuesto_gestiona', 'conta_impuesto_180_fichero'])
  })
  it('quien no gestiona la empresa, no: ni se piden los datos', async () => {
    const { b, fns } = base({ gestiona: false })
    expect(await fichero180(b, a)).toMatchObject({ ok: false, motivo: 'no_deja' })
    expect(fns).toEqual(['conta_impuesto_gestiona'])
  })
  it('con algo por resolver, la base no da los datos y se dice su frase', async () => {
    const r = await fichero180(base({ error: 'Este 180 tiene 1 cosas que resolver en «Lo comprobado»: sin eso no se prepara el fichero.' }).b, a)
    expect(r.ok).toBe(false)
    expect(r.mensaje).toContain('que resolver')
  })
  it('un arrendador sin local no da un fichero que Hacienda rechazaría: dice cuál y qué falta', async () => {
    const r = await fichero180(base({ datos: { perceptores: [{ ...DATOS.perceptores[0], inmueble: null }] } }).b, a)
    expect(r.ok).toBe(false)
    expect(r.mensaje).toMatch(/Uno Uno, Ana: falta la calle del inmueble/)
  })
})
