// tests/unit/modules/conta/laboral/fichaTextos.test.ts
//
// N1 · PR 2 · Paso 1 (02/11/2026) · Las frases de la ficha nueva. Los códigos
// y textos son los de las tablas oficiales cargadas en la 0817 (T-19, T-18 y el
// modelo 145) y las pagas, el texto que trae Cegid en producción para el
// convenio 103 (regla 31: contra la población real, no contra ejemplos
// inventados). Las fechas y los importes sí son inventados.

import { describe, expect, it } from 'vitest'
import {
  avisosDeLaFicha, conCodigo, edad, finDePrueba, frasesMinimo, ibanBonito, mesDePaga, mesesDePagas,
  oficialSiDistinto, pais, proximoTrienio, vacacionesDelConvenio,
} from '../../../../../src/modules/conta/laboral/ficha/fichaTextos'
import type { Ficha } from '../../../../../src/modules/conta/laboral/ficha/fichaService'

const contrato100 = { codigo: '100', calle: 'Indefinido a jornada completa', oficial: 'INDEFINIDO TIEMPO COMPLETO – ORDINARIO' }
const grupo4 = { codigo: '4', calle: 'Ayudantes sin título', oficial: 'Ayudantes no titulados' }
const situacion1 = { codigo: '1', calle: 'Sin pareja, con hijos que viven solo con usted', oficial: 'Soltero/a, viudo/a, divorciado/a o separado/a legalmente con hijos…' }

describe('el código delante y siempre a la vista (Julio, 02/11)', () => {
  it('contrato, grupo y situación del IRPF', () => {
    expect(conCodigo(contrato100)).toBe('100 · Indefinido a jornada completa')
    expect(conCodigo(grupo4, 'Grupo')).toBe('Grupo 4 · Ayudantes sin título')
    expect(conCodigo(situacion1)).toBe('1 · Sin pareja, con hijos que viven solo con usted')
  })
  it('un código que no está en la tabla oficial se dice, no se esconde', () => {
    expect(conCodigo({ codigo: '999', calle: null, oficial: null, desconocido: true })).toBe('999 · código que no está en la tabla oficial')
  })
  it('sin palabra de la calle, el texto oficial', () => {
    expect(conCodigo({ codigo: '9310', calle: null, oficial: 'Ayudantes de cocina' })).toBe('9310 · Ayudantes de cocina')
  })
  it('el oficial, pequeño debajo, solo si dice otra cosa', () => {
    expect(oficialSiDistinto(grupo4)).toBe('Ayudantes no titulados')
    expect(oficialSiDistinto({ codigo: '724', calle: 'España', oficial: 'ESPAÑA' })).toBe('')
  })
  it('los países, sin código', () => {
    expect(pais({ codigo: '862', calle: 'Venezuela', oficial: 'VENEZUELA' })).toBe('Venezuela')
    expect(pais(null)).toBeNull()
  })
})

describe('las pagas extra del convenio 103, con el texto de Cegid', () => {
  const conv = {
    codigo: '103', nombre: 'HOSTELERIA (MADRID)', horas_anuales: 1800, horas_dia: null, cargado: true,
    paga_13: 'PAGA DE JUNIO, pago 20/06, devengo 01/07-30/06',
    paga_14: 'PAGA DE DICIEMBRE, pago 20/12, devengo 01/01-31/12',
    vacaciones: '30 días naturales; importe = SALARIO (1) + COMPLEMENTO DE VINCULACION (703)',
  }
  it('junio y diciembre', () => {
    expect(mesDePaga(conv.paga_13)).toBe('junio')
    expect(mesesDePagas(conv)).toBe('junio y diciembre')
  })
  it('si no se sabe un mes, no se inventa', () => {
    expect(mesesDePagas({ ...conv, paga_14: 'PAGA EXTRA' })).toBeNull()
    expect(mesesDePagas(null)).toBeNull()
  })
  it('las vacaciones, sin cómo se pagan', () => {
    expect(vacacionesDelConvenio(conv.vacaciones)).toBe('30 días naturales')
  })
})

describe('fechas', () => {
  it('edad cumplida', () => {
    expect(edad('1999-03-14', '2026-11-02')).toBe(27)
    expect(edad('1999-11-03', '2026-11-02')).toBe(26)
  })
  it('el siguiente trienio, después de hoy', () => {
    expect(proximoTrienio('2024-01-01', '2026-11-02')).toBe('2027-01-01')
    expect(proximoTrienio('2020-01-01', '2026-11-02')).toBe('2029-01-01')
    expect(proximoTrienio(null, '2026-11-02')).toBeNull()
  })
})

const fichaCon = (contrato: Partial<NonNullable<Ficha['contrato']>>): Ficha => ({
  privado: true,
  persona: {} as Ficha['persona'],
  contrato: {
    id: 'c', numero: '1', tipo: contrato100, desde: '2026-10-01', hasta: null, baja: null, prueba_dias: 60, antiguedad: '2026-10-01',
    puesto: null, centro: null, cuenta_cotizacion: null, grupo: grupo4, ocupacion: null, categoria: null, categoria_nombre: null,
    jornada: 'completa', coef_parcial: 0, horas_semana: 40, bonificaciones: [], convenio: null, categorias: [], ...contrato,
  },
  salario: null, irpf: null,
})

describe('el periodo de prueba y los avisos (solo lo que dicen los datos)', () => {
  it('prueba en curso y superada', () => {
    const f = fichaCon({})
    expect(finDePrueba(f.contrato!, '2026-11-02')).toEqual({ fecha: '2026-11-30', superado: false, texto: 'la prueba acaba el 30/11/2026' })
    expect(finDePrueba(f.contrato!, '2026-12-15')?.texto).toBe('prueba superada el 30/11/2026')
  })
  it('avisa del fin de prueba y del fin de contrato si llegan en 60 días', () => {
    const a = avisosDeLaFicha(fichaCon({ hasta: '2026-12-31' }), '2026-11-02')
    expect(a.map((x) => x.clave)).toEqual(['prueba', 'fin'])
  })
  it('el trienio, solo cuando llega', () => {
    expect(avisosDeLaFicha(fichaCon({ prueba_dias: null, antiguedad: '2024-01-01' }), '2026-11-02').map((x) => x.texto))
      .toEqual(['El 01/01/2027 cumple 3 años en la empresa a efectos de antigüedad: mira lo que le sube su convenio por el trienio.'])
    expect(avisosDeLaFicha(fichaCon({ prueba_dias: null, antiguedad: '2024-06-01' }), '2026-11-02')).toEqual([])
  })
  it('de baja, ningún aviso', () => {
    expect(avisosDeLaFicha(fichaCon({ baja: '2026-10-20' }), '2026-11-02')).toEqual([])
  })
})

describe('el mínimo del convenio', () => {
  const base = { conceptos: [], pagas: 14, nomina_cegid: null }
  it('sin categoría no se puede calcular, y se dice (Julio, 02/11)', () => {
    const r = frasesMinimo({ ...base, bruto_mes: 1500, minimo_convenio: null, minimo_porque: 'sin_categoria' })
    expect(r.tono).toBe('duda')
    expect(r.texto).toContain('le falta la categoría del convenio')
  })
  it('por encima y por debajo, con la diferencia', () => {
    expect(frasesMinimo({ ...base, bruto_mes: 1530.2, minimo_convenio: 1271.4, minimo_porque: null }).texto).toMatch(/Cobra 258,80\s€ más/)
    expect(frasesMinimo({ ...base, bruto_mes: 1200, minimo_convenio: 1271.4, minimo_porque: null }).tono).toBe('falta')
  })
})

describe('el IBAN', () => {
  it('por grupos de cuatro, o tapado salvo el final', () => {
    expect(ibanBonito('es4999990000000000000001')).toBe('ES49 9999 0000 0000 0000 0001')
    expect(ibanBonito('ES49 9999 0000 0000 0000 0001', true)).toBe('ES49 …0001')
    expect(ibanBonito(null)).toBe('')
  })
})
