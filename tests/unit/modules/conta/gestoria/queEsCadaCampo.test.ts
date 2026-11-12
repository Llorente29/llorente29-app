// G01b · «Qué es cada campo»: lo que se propone al abrir, lo que falta (en
// rojo) y el mapa que se confirma. Las etiquetas, como las del portal de QBO
// (medidas el 07/11); los códigos UF_CRM_ y los datos, inventados (T11).
import { describe, expect, it } from 'vitest'
import { cuotasSinCampo,
  eleccionInicial, loQueFalta, mapaParaConfirmar, opcionesDeCampos, resumenDeOpciones, sePuedeConfirmar, type CampoMedido, type MapaBitrix,
} from '@/modules/conta/gestoria/queEsCadaCampo'
import { leerEmpresa } from '../../../../../supabase/functions/conta-bitrix-leer/mapa'

const MEDIDOS: Record<string, CampoMedido> = {
  TITLE: { title: 'Nombre de la empresa' },
  ADDRESS: { title: 'Dirección' }, ADDRESS_POSTAL_CODE: { title: 'Código Postal' }, ADDRESS_CITY: { title: 'Ciudad' }, ADDRESS_PROVINCE: { title: 'Estado / Provincia' },
  UF_CRM_NIF1: { formLabel: 'CIF/NIF', type: 'string' },
  UF_CRM_NIF2: { formLabel: 'CIF - Compañía', type: 'string' },
  UF_CRM_NIF3: { formLabel: 'DNI / NIF ( Solo para clientes existentes )', type: 'string' },
  UF_CRM_FISCAL: { formLabel: 'Dirección Fiscal', type: 'address' },
  UF_CRM_SOCIAL: { formLabel: 'Dirección Social', type: 'address', isMultiple: true },
  UF_CRM_CALLE: { formLabel: 'Calle, casa núm.', type: 'string' },
  UF_CRM_CALLE_CP: { formLabel: 'Código Postal', type: 'string' },
  UF_CRM_CALLE_POB: { formLabel: 'Ciudad', type: 'string' },
  UF_CRM_CALLE_DIR: { formLabel: 'Dirección', type: 'string' },
  UF_CRM_SIT: { listLabel: 'Situación del Cliente', type: 'enumeration', items: [
    { ID: 398, VALUE: 'ACTIVO' }, { ID: 399, VALUE: 'BAJA DE AUTONOMO ❌' }, { ID: 400, VALUE: 'BAJA DE GESTORIA ❌' }, { ID: 401, VALUE: 'GRAVE DESAPARECIDO' },
    { ID: 402, VALUE: 'MOROSO' }, { ID: 984, VALUE: 'Vzla MOROSO' }, { ID: 985, VALUE: 'Vzla Activo' }, { ID: 986, VALUE: 'Vzla Excliente' }, { ID: 1342, VALUE: 'CLIENTE SOLO RENTA' }] },
  UF_CRM_CUOTA: { formLabel: 'Cuota Mensual', type: 'double' },
  UF_CRM_LAB: { formLabel: 'Cuota Mensual Laboral', type: 'double' },
  UF_CRM_CS: { formLabel: 'Cuota Mensual ContaSimple', type: 'double' },
  UF_CRM_CUOTA_Z: { formLabel: 'Cuota Mensual z', type: 'money' },
  UF_CRM_LAB_Z: { formLabel: 'Cuota Mensual Laboral z', type: 'money' },
  UF_CRM_CS_Z: { formLabel: 'Cuota Mensual ContaSimple z', type: 'money' },
}

// Como el de producción el 07/11: conectado antes del #494, sin situación ni NIF y con el código postal y la población de «Calle, casa núm.».
const MAPA: MapaBitrix = {
  nombre: 'Gestoría de prueba', formaPagoAEmisor: { 'EMISOR PRUEBA': 'empresa-a' },
  campos: [
    { codigo: 'TITLE', campo: 'nombre' },
    { codigo: null, campo: 'nif' }, { codigo: null, campo: 'calle' },
    { codigo: 'UF_CRM_CALLE_CP', campo: 'cp' }, { codigo: 'UF_CRM_CALLE_POB', campo: 'poblacion' }, { codigo: 'ADDRESS_PROVINCE', campo: 'provincia' },
    { codigo: null, campo: 'situacion' },
    { codigo: 'UF_CRM_CUOTA', campo: 'cuota_referencia', etiqueta: 'Cuota mensual' },
    { codigo: null, campo: 'cuota_referencia', etiqueta: 'Laboral' },
    { codigo: null, campo: 'cuota_referencia', etiqueta: 'ContaSimple' },
  ],
}

describe('G01b · Qué es cada campo', () => {
  it('propone la situación con sus opciones (lo que no encaja, sin clasificar), las cuotas sin «z» y las cuatro fuentes de la dirección por orden', () => {
    const e = eleccionInicial(MAPA, MEDIDOS)
    expect(e.situacion).toBe('UF_CRM_SIT')
    expect(e.opciones).toEqual({ '398': 'activo', '399': 'baja', '400': 'baja', '401': 'sin_clasificar', '402': 'moroso',
      '984': 'sin_clasificar', '985': 'sin_clasificar', '986': 'sin_clasificar', '1342': 'solo_renta' })
    expect(e.cuotas).toEqual([{ etiqueta: 'Cuota mensual', codigo: 'UF_CRM_CUOTA' }, { etiqueta: 'Laboral', codigo: 'UF_CRM_LAB' }, { etiqueta: 'ContaSimple', codigo: 'UF_CRM_CS' }])
    expect(e.direcciones).toEqual([
      { calle: 'UF_CRM_FISCAL', cp: null, poblacion: null, provincia: null },
      { calle: 'UF_CRM_SOCIAL', cp: null, poblacion: null, provincia: null },
      { calle: 'ADDRESS', cp: 'ADDRESS_POSTAL_CODE', poblacion: 'ADDRESS_CITY', provincia: 'ADDRESS_PROVINCE' },
      // El código postal y la población de antes son de «Calle, casa núm.»: van con ella, no con otra fuente.
      { calle: 'UF_CRM_CALLE', cp: 'UF_CRM_CALLE_CP', poblacion: 'UF_CRM_CALLE_POB', provincia: null },
    ])
    expect(resumenDeOpciones(e)).toBe('Activo: 1 · De baja: 2 · Moroso: 1 · Solo la renta: 1 · Sin clasificar: 4')
  })

  it('el NIF con tres candidatos no se elige solo: sale en rojo; sin situación no se confirma', () => {
    const e = eleccionInicial(MAPA, MEDIDOS)
    expect(e.nif).toBeNull()
    expect(loQueFalta(e)).toEqual(['El NIF: ningún campo elegido.'])
    expect(sePuedeConfirmar(e)).toBe(true)
    const sin = { ...e, situacion: null, direcciones: e.direcciones.map((d) => ({ ...d, calle: null })), cuotas: [{ etiqueta: 'Laboral', codigo: null }] }
    expect(loQueFalta(sin)).toEqual(['El NIF: ningún campo elegido.', 'La situación del cliente: ningún campo elegido. Sin él no se guarda la situación de nadie.',
      'La dirección: ninguna fuente elegida.'])
    // GD (nº32): una cuota de referencia sin campo no es una falta (no sale en rojo): se dice aparte.
    expect(cuotasSinCampo(sin)).toEqual(['Laboral'])
    expect(cuotasSinCampo(e)).toEqual([])
    expect(sePuedeConfirmar(sin)).toBe(false)
  })

  it('el mapa que se confirma: lo elegido en su sitio, sin los sueltos de antes, y una ficha se lee con él', () => {
    const e = { ...eleccionInicial(MAPA, MEDIDOS), nif: 'UF_CRM_NIF1' }
    const m = mapaParaConfirmar(MAPA, e, MEDIDOS)
    expect(m.campos.map((c) => [c.campo, c.codigo, c.etiqueta ?? null])).toEqual([
      ['nombre', 'TITLE', null], ['nif', 'UF_CRM_NIF1', null], ['situacion', 'UF_CRM_SIT', null],
      ['cuota_referencia', 'UF_CRM_CUOTA', 'Cuota mensual'], ['cuota_referencia', 'UF_CRM_LAB', 'Laboral'], ['cuota_referencia', 'UF_CRM_CS', 'ContaSimple'],
    ])
    expect(m.direcciones?.map((d) => d.etiqueta)).toEqual(['Dirección Fiscal', 'Dirección Social', 'Dirección', 'Calle, casa núm.'])
    expect(m.formaPagoAEmisor).toEqual({ 'EMISOR PRUEBA': 'empresa-a' })
    expect(m.dudas).toEqual([])
    // Confirmado (lo pone la base), una ficha sale con su situación, su texto y la dirección de la primera fuente con algo.
    const f = leerEmpresa({ ID: '1', TITLE: 'CLIENTE PRUEBA', UF_CRM_NIF1: 'B00000001', UF_CRM_SIT: '985',
      UF_CRM_SOCIAL: ['Plaza Prueba 3, 28000 Madrid|;|7'], UF_CRM_CALLE: 'Calle Prueba 1', UF_CRM_CALLE_CP: '28999', UF_CRM_LAB: '30' },
    { ...m, confirmado: { quien: 'persona-de-prueba', cuando: '2026-11-07T10:00:00Z' } })
    expect(f).toMatchObject({ nif: 'B00000001', situacion: 'sin_clasificar', situacionTexto: 'Vzla Activo', calle: 'Plaza Prueba 3, 28000 Madrid', cp: '28000',
      direccionDe: 'Dirección Social', otrasDirecciones: [{ etiqueta: 'Calle, casa núm.', texto: 'Calle Prueba 1, 28999' }],
      cuotasReferencia: [{ etiqueta: 'Laboral', importeCent: 3000, texto: '30' }] })
  })

  it('un mapa ya confirmado se abre como se guardó (sus opciones y sus fuentes)', () => {
    const e0 = { ...eleccionInicial(MAPA, MEDIDOS), nif: 'UF_CRM_NIF1' }
    const m = mapaParaConfirmar(MAPA, { ...e0, opciones: { ...e0.opciones, '985': 'activo' }, direcciones: e0.direcciones.slice(0, 2) }, MEDIDOS)
    const e = eleccionInicial(m, MEDIDOS)
    expect(e.nif).toBe('UF_CRM_NIF1')
    expect(e.opciones['985']).toBe('activo')
    expect(e.direcciones.map((d) => d.calle)).toEqual(['UF_CRM_FISCAL', 'UF_CRM_SOCIAL'])
  })

  it('los campos para elegir, por su etiqueta y con su código', () => {
    expect(opcionesDeCampos(MEDIDOS, (c) => !!c.items).map((o) => o.texto)).toEqual(['Situación del Cliente · UF_CRM_SIT'])
  })
})
