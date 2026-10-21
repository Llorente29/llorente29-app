// S01e · Libro diario: lo que confundía.
//   · «Para revisar · 0» y «Te toca hoy: 0» con un asiento en la lista: los
//     contadores contaban solo propuestos y la lista también los borradores.
//     Ahora los dos salen de paraRevisar (la misma vara a los dos lados, regla 31).
//   · «Mes cerrado ✓» con un borrador dentro del mes.
//   · Los porqués guardados, sin jerga ni cuentas en bruto.

import { describe, expect, it } from 'vitest'
import { filtrar, pasosCierre, type ApunteDiario, type AsientoDiario } from '@/modules/conta/lib/diario'
import { paraRevisar, sinValidarDelMes } from '@/modules/conta/libro/paraRevisar'
import { nombresDeCuentas, palabrasLlanas } from '@/modules/conta/libro/palabrasLlanas'

function apunte(p: Partial<ApunteDiario>): ApunteDiario {
  return {
    posicion: 1, cuentaId: 'c', cuenta: '57200001', nombreCuenta: 'Banco Norte', tituloOficial: null, debe: 0, haber: 0, concepto: null, localId: null, local: null,
    comun: false, marcaId: null, marca: null, cedida: false, documento: null, iva: null, retencion: null, negativoEnDiez: null, ...p,
  }
}
function asiento(p: Partial<AsientoDiario>): AsientoDiario {
  return {
    id: 'a', serie: 4, numero: null, fecha: '2026-10-05', concepto: 'Alquiler', origen: 'manual', origenId: null, estado: 'propuesto',
    confianza: null, porque: null, razones: [], documento: null, terceroId: null, creadoPor: 'Ana', creadoEn: '2026-10-06T01:00:00Z',
    validadoPor: null, validadoEn: null, anuladoPor: null, anuladoEn: null, motivoAnulacion: null, anuladoCon: null, anulaA: null, traido: null,
    huella: null, huellaAnterior: null, cadena: null,
    apuntes: [apunte({ cuenta: '62100000', nombreCuenta: 'Alquiler', debe: 100 }), apunte({ haber: 100 })],
    ...p,
  }
}

describe('«Para revisar»: la lista y sus contadores con la MISMA regla', () => {
  // La cuenta B de la auditoría: un borrador a mano y nada propuesto.
  const cuentaB = [
    asiento({ id: 'borrador', estado: 'borrador' }),
    asiento({ id: 'v1', estado: 'validado', numero: 1 }),
    asiento({ id: 'v2', estado: 'anulado', numero: 2 }),
  ]
  const sinEspera = () => null

  it('un borrador sale en la lista Y en el número (antes: lista 1, número 0)', () => {
    const lista = paraRevisar(cuentaB, sinEspera)
    expect(lista.map((a) => a.id)).toEqual(['borrador'])
    // Lo que contaba antes el contador, para que se vea la diferencia:
    expect(cuentaB.filter((a) => a.estado === 'propuesto').length).toBe(0)
    expect(lista.length).toBe(1)
  })

  it('lo que espera no cuenta ni sale (va en «Esperan»), sea propuesto o borrador', () => {
    const libro = [...cuentaB, asiento({ id: 'p1' }), asiento({ id: 'p2', fecha: '2026-09-30' }), asiento({ id: 'b2', estado: 'borrador', fecha: '2026-09-29' })]
    const espera = (a: AsientoDiario) => (a.id === 'p2' || a.id === 'b2' ? 'El mes de septiembre está cerrado.' : null)
    const lista = paraRevisar(libro, espera)
    expect(lista.map((a) => a.id).sort()).toEqual(['borrador', 'p1'])
    // La lista de siempre («revisar» de lib/diario) menos lo que espera: el mismo orden.
    expect(lista).toEqual(filtrar(libro, 'revisar').filter((a) => !espera(a)))
  })

  it('sin nada sin validar, 0 y la lista vacía (con 0 dice que no hay nada: regla 7)', () => {
    expect(paraRevisar([asiento({ id: 'v', estado: 'validado', numero: 1 })], sinEspera)).toEqual([])
  })
})

describe('un mes cerrado con algo sin validar dentro no sale «✓»', () => {
  const base = { diasVenta: null, facturas: null, liquidaciones: null, socios: null, nominas: null }

  it('cerrado y limpio: «Mes cerrado» hecho', () => {
    const p = pasosCierre({ ...base, pendientes: 0, cerrado: true })
    expect(p.at(-1)).toEqual({ texto: 'Mes cerrado', hecho: true })
  })

  it('cerrado con un borrador dentro: lo dice y no lo marca hecho', () => {
    const p = pasosCierre({ ...base, pendientes: 1, cerrado: true })
    expect(p.map((x) => x.texto)).toEqual(['1 asiento espera revisión', 'Mes cerrado, pero con 1 asiento sin validar dentro'])
    expect(p.at(-1)!.hecho).toBe(false)
    expect(pasosCierre({ ...base, pendientes: 3, cerrado: true }).at(-1)!.texto).toBe('Mes cerrado, pero con 3 asientos sin validar dentro')
  })

  it('sinValidarDelMes cuenta propuestos y borradores del mes, esperen o no', () => {
    const libro = [
      asiento({ id: '1', estado: 'borrador', fecha: '2026-10-02' }),
      asiento({ id: '2', estado: 'propuesto', fecha: '2026-10-31' }),
      asiento({ id: '3', estado: 'validado', fecha: '2026-10-15', numero: 3 }),
      asiento({ id: '4', estado: 'borrador', fecha: '2026-09-30' }),
    ]
    expect(sinValidarDelMes(libro, '2026-10-01')).toBe(2)
    expect(sinValidarDelMes(libro, '2026-09-01')).toBe(1)
    expect(sinValidarDelMes(libro, '2026-11-01')).toBe(0)
  })
})

describe('palabras llanas en los porqués y los motivos', () => {
  const nombres = nombresDeCuentas([
    { cuenta: '57200001', nombreCuenta: 'Banco Norte' },
    { cuenta: '40700001', nombreCuenta: 'Anticipos a Catcher' },
    { cuenta: '62600000', nombreCuenta: '62600000' }, // sin nombre propio: no se inventa
  ])

  it('una cuenta en bruto lleva su nombre; la que ya lo lleva, no se repite', () => {
    expect(palabrasLlanas('las facturas de la quincena se pagan contra la 40700001.', nombres))
      .toBe('las facturas de la quincena se pagan contra la 40700001 (Anticipos a Catcher).')
    expect(palabrasLlanas('No se valida: apunte 2 (57200001): falta el local (o marcarlo como común).', nombres))
      .toBe('No se valida: apunte 2 (Banco Norte · 57200001): falta el local (o marcarlo como común).')
    expect(palabrasLlanas('Banco Norte · 57200001', nombres)).toBe('Banco Norte · 57200001')
    expect(palabrasLlanas('Comisiones 62600000', nombres)).toBe('Comisiones 62600000')
  })

  it('sin «regla 9 del libro», «(concepto 17)», «tercero» ni «eje»', () => {
    expect(palabrasLlanas('Cada apunte de gasto lleva su local, regla 9 del libro.')).toBe('Cada apunte de gasto lleva su local.')
    expect(palabrasLlanas('Va con su local (regla 9 del libro).')).toBe('Va con su local.')
    expect(palabrasLlanas('El banco lo da como «intereses, comisiones, gastos» (concepto 17): Comisiones bancarias.'))
      .toBe('El banco lo da como «intereses, comisiones, gastos»: Comisiones bancarias.')
    expect(palabrasLlanas('El tercero no tiene NIF.')).toBe('El proveedor o cliente no tiene NIF.')
    expect(palabrasLlanas('Con el eje «local» apagado.')).toBe('Con el reparto por local apagado.')
    expect(palabrasLlanas('Los ejes del informe.')).toBe('Los repartos del informe.')
    // Lo que no es jerga se queda igual (no toca «ejercicio» ni «regla de reparto»).
    expect(palabrasLlanas('El ejercicio 2026 está cerrado; la regla de reparto no suma 100 %.')).toBe('El ejercicio 2026 está cerrado; la regla de reparto no suma 100 %.')
  })
})
