import { describe, expect, it } from 'vitest'
import {
  LOCAL_COMUN, TIPOS_DE_SERIE, comprobarRecibida, cuotaDe, leerImporteEs, textoDeFallo, textoGuardada, totalDe, type BorradorRecibida,
} from '@/modules/conta/lib/recibidaAMano'
import { CINTAS, ordenPorId } from '@/modules/conta/esqueleto/ordenes'
import { CONSULTA_RECIBIDA_A_MANO, CONTA, rutaRecibidaAMano, rutaRecibidaEnAsientos } from '@/config/navegacion'

const HOY = '2026-10-18'
const bien: BorradorRecibida = { proveedorId: 'p1', numero: ' A-123 ', fecha: '2026-10-10', base: '1.234,56', tipo: '21', cuota: '', local: 'loc1' }

describe('S01d · recibida a mano: los importes en español', () => {
  it('lee coma decimal, punto de miles y sin decimales', () => {
    expect(leerImporteEs('1.234,56')).toBe(1234.56)
    expect(leerImporteEs('1234,5')).toBe(1234.5)
    expect(leerImporteEs('12')).toBe(12)
    expect(leerImporteEs('  0,07 € ')).toBe(0.07)
    expect(leerImporteEs('1.234')).toBe(1234)
    expect(leerImporteEs('1234.56')).toBe(1234.56)
  })
  it('no adivina: vacío, letras o más de dos decimales tras la coma', () => {
    expect(leerImporteEs('')).toBeNull()
    expect(leerImporteEs('doce')).toBeNull()
    expect(leerImporteEs('1,234')).toBeNull()
    expect(leerImporteEs('12,5x')).toBeNull()
  })
})

describe('S01d · la cuota y el total, al céntimo', () => {
  it('la cuota es base × tipo redondeada como el asiento', () => {
    expect(cuotaDe(1234.56, 21)).toBe(259.26)
    expect(cuotaDe(100, 10)).toBe(10)
    expect(cuotaDe(0.05, 21)).toBe(0.01)
    expect(cuotaDe(19.99, 4)).toBe(0.8)
    expect(cuotaDe(50, 0)).toBe(0)
  })
  it('el total es base + cuota sin errores de coma flotante', () => {
    expect(totalDe(0.1, 0.2)).toBe(0.3)
    expect(totalDe(1234.56, 259.26)).toBe(1493.82)
  })
})

describe('S01e · el local de la recibida a mano (Julio: Foodint necesita su analítica por local)', () => {
  it('con el eje de local: sin elegir no se guarda, y lo dice', () => {
    const c = comprobarRecibida({ ...bien, local: '' }, TIPOS_DE_SERIE, HOY, true)
    expect(c.datos).toBeNull()
    expect(c.errores).toEqual({ local: 'Elige el local de la factura, o «Común» si es de todos.' })
  })
  it('«Común» es una opción más: se guarda sin local (null), que es como el asiento lo lee', () => {
    expect(comprobarRecibida({ ...bien, local: LOCAL_COMUN }, TIPOS_DE_SERIE, HOY, true).datos?.localId).toBeNull()
  })
  it('sin el eje de local no se pregunta: común, como antes', () => {
    const c = comprobarRecibida({ ...bien, local: '' }, TIPOS_DE_SERIE, HOY, false)
    expect(c.errores).toEqual({})
    expect(c.datos?.localId).toBeNull()
    expect(comprobarRecibida({ ...bien, local: 'loc1' }, TIPOS_DE_SERIE, HOY, false).datos?.localId).toBeNull()
  })
})

describe('S01d · comprobar lo escrito', () => {
  it('bien escrita: sale lista para guardar, con la cuota calculada y total = base + cuota', () => {
    const c = comprobarRecibida(bien, TIPOS_DE_SERIE, HOY, true)
    expect(c.errores).toEqual({})
    expect(c.aviso).toBeNull()
    expect(c.datos).toEqual({ proveedorId: 'p1', numero: 'A-123', fecha: '2026-10-10', base: 1234.56, tipo: 21, cuota: 259.26, total: 1493.82, localId: 'loc1' })
    expect(c.datos!.total).toBe(totalDe(c.datos!.base, c.datos!.cuota))
  })
  it('vacía: un fallo por campo, en palabras normales', () => {
    const c = comprobarRecibida({ proveedorId: '', numero: '  ', fecha: '', base: '', tipo: '', cuota: '', local: '' }, TIPOS_DE_SERIE, HOY, true)
    expect(c.datos).toBeNull()
    expect(Object.keys(c.errores).sort()).toEqual(['base', 'fecha', 'local', 'numero', 'proveedor', 'tipo'])
    expect(c.errores.proveedor).toBe('Elige el proveedor. Si no está, dalo de alta primero.')
    expect(c.errores.base).toBe('Escribe la base imponible.')
  })
  it('la fecha: que exista y que no sea del futuro', () => {
    expect(comprobarRecibida({ ...bien, fecha: '2026-02-30' }, TIPOS_DE_SERIE, HOY, true).errores.fecha).toBe('Esa fecha no existe: escríbela como dd/mm/aaaa.')
    expect(comprobarRecibida({ ...bien, fecha: '2026-10-19' }, TIPOS_DE_SERIE, HOY, true).errores.fecha).toMatch(/posterior a hoy \(18\/10\/2026\)/)
    expect(comprobarRecibida({ ...bien, fecha: HOY }, TIPOS_DE_SERIE, HOY, true).datos).not.toBeNull()
  })
  it('la base: un importe y mayor que 0', () => {
    expect(comprobarRecibida({ ...bien, base: 'mil' }, TIPOS_DE_SERIE, HOY, true).errores.base).toBe('La base no es un importe: escríbela así, 1.234,56.')
    expect(comprobarRecibida({ ...bien, base: '0' }, TIPOS_DE_SERIE, HOY, true).errores.base).toMatch(/mayor que 0/)
    expect(comprobarRecibida({ ...bien, base: '-10' }, TIPOS_DE_SERIE, HOY, true).errores.base).toMatch(/abono/)
  })
  it('el tipo tiene que ser uno de los que se ofrecen', () => {
    expect(comprobarRecibida({ ...bien, tipo: '7' }, TIPOS_DE_SERIE, HOY, true).errores.tipo).toBe('Elige el tipo de IVA de la factura.')
    expect(comprobarRecibida({ ...bien, tipo: '10' }, [21, 10, 0], HOY, true).datos?.cuota).toBe(123.46)
  })
  it('la cuota cambiada a mano: se guarda la suya, con aviso, y el total la sigue', () => {
    const c = comprobarRecibida({ ...bien, cuota: '259,25' }, TIPOS_DE_SERIE, HOY, true)
    expect(c.datos?.cuota).toBe(259.25)
    expect(c.datos?.total).toBe(1493.81)
    expect(c.aviso).toMatch(/es 259,26 €; has puesto 259,25 €/)
    // La misma que la calculada no avisa.
    expect(comprobarRecibida({ ...bien, cuota: '259,26' }, TIPOS_DE_SERIE, HOY, true).aviso).toBeNull()
  })
  it('la cuota: un importe, no negativa, y 0 sin IVA', () => {
    expect(comprobarRecibida({ ...bien, cuota: 'x' }, TIPOS_DE_SERIE, HOY, true).errores.cuota).toMatch(/no es un importe/)
    expect(comprobarRecibida({ ...bien, cuota: '-1' }, TIPOS_DE_SERIE, HOY, true).errores.cuota).toMatch(/negativa/)
    expect(comprobarRecibida({ ...bien, tipo: '0', cuota: '3' }, TIPOS_DE_SERIE, HOY, true).errores.cuota).toBe('Sin IVA (0 %), la cuota es 0.')
    expect(comprobarRecibida({ ...bien, tipo: '0' }, TIPOS_DE_SERIE, HOY, true).datos).toMatchObject({ cuota: 0, total: 1234.56 })
  })
})

describe('S01d · lo que se dice (regla 8)', () => {
  it('al guardar, con su número y su proveedor', () => {
    expect(textoGuardada('123', 'Hermanos Ruiz')).toBe('Factura 123 de Hermanos Ruiz guardada. Revísala y apúntala.')
  })
  it('la repetida del disparador, el permiso y lo demás', () => {
    const repetida = { code: '23505', message: 'Repetida: ya está la factura 123 de este proveedor (FAC-00012), con el mismo total.' }
    expect(textoDeFallo(repetida, '123', 'Hermanos Ruiz')).toMatch(/^No se ha guardado: ya tienes la factura 123 de Hermanos Ruiz con el mismo total\./)
    expect(textoDeFallo({ code: '42501', message: 'permission denied' }, '1', 'X')).toBe('No se ha guardado: no tienes permiso para dar de alta facturas en esta cuenta.')
    expect(textoDeFallo({ message: 'algo' }, '1', 'X', (m) => `«${m}»`)).toBe('No se ha guardado la factura: «algo»')
  })
})

describe('S01d · por dónde se llega', () => {
  // S02 · PR 2: la recibida a mano es de Compras y gastos › Facturas recibidas
  // («Escribir una a mano»), con su dirección; la de antes (Asientos, ?nueva=a-mano) lleva allí.
  it('«Escribir una a mano», en Compras y gastos, a su dirección (documentos/nueva); ya no en Asientos', () => {
    const o = ordenPorId('asiento.recibida-a-mano')
    expect(o?.etiqueta).toBe('Escribir una a mano')
    expect(o?.producto).toBe('compras')
    expect(o && 'ruta' in o.a ? o.a.ruta : null).toBe(CONTA.rutas.recibidaAMano)
    expect(CINTAS['contabilidad.asientos'][0].ordenes).not.toContain('asiento.recibida-a-mano')
    expect(rutaRecibidaAMano()).toBe('/conta/documentos/nueva')
    expect(CONSULTA_RECIBIDA_A_MANO).toBe('nueva=a-mano')
    expect(rutaRecibidaEnAsientos()).toBe('/conta/documentos?ver=por-revisar')
  })
})
