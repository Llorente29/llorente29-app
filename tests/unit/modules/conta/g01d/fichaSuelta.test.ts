// tests/unit/modules/conta/g01d/fichaSuelta.test.ts
//
// G01d · Tarea 3 · El núcleo partido (regla 31): lo que hace un aviso del CRM
// con su ficha es EXACTAMENTE lo que haría la lectura entera con el CRM tal
// como queda después del cambio, en los clientes tocados y en su «Pendiente de
// revisar». La medida, la misma a los dos lados: las funciones de la lectura
// entera (fichasDeClientes, agrupar, diferenciasDeLectura, repartirContactos)
// sobre el estado de DESPUÉS, contra el aviso sobre el estado de ANTES más su
// ficha.
//
// La población imita la de la unión del G01b (unionFichas.test.ts: un NIF en
// 3 fichas, otro en 2, uno suelto, uno sin formato, uno en 10 fichas, sin NIF)
// y añade contactos de cada clase. NIF de ceros y nombres de prueba (T11).

import { describe, expect, it } from 'vitest'
import { MAX_FICHAS_POR_NIF, agrupar, diferenciasDeLectura, type DiferenciaDeCrm } from '../../../../../supabase/functions/_shared/crm/clientes'
import { repartirContactos } from '../../../../../supabase/functions/_shared/crm/contactos'
import { claveDeFicha, type FichaContactoCrm, type FichaCrm, type Situacion } from '../../../../../supabase/functions/_shared/crm/ficha'
import { fichasDeClientes } from '../../../../../supabase/functions/_shared/crm/leer'
import { planDeFichaSuelta, type FichaGuardada } from '../../../../../supabase/functions/_shared/crm/fichaSuelta'

const base = { calle: null, cp: null, poblacion: null, provincia: null, correos: [], telefonos: [], situacionTexto: null, direccionDe: null, otrasDirecciones: [],
  servicios: [], formaPago: null, emisorSegunCrm: null, cuotasReferencia: [], avisos: [] }
const empresa = (id: string, nif: string | null, situacion: Situacion | null): FichaCrm =>
  ({ ...base, tipoFicha: 'empresa', idExterno: id, nombre: `Empresa ${id} de Prueba`, nif, nifEnCrm: nif, situacion })
const contacto = (id: string, o: { nif?: string | null; empresas?: string[]; tarifa?: boolean; negociacion?: boolean; datos?: boolean }): FichaContactoCrm =>
  ({ ...base, tipoFicha: 'contacto', idExterno: id, nombre: `Contacto ${id} de Prueba`, nif: o.nif ?? null, nifEnCrm: o.nif ?? null, situacion: null,
    empresas: o.empresas ?? [], tipoCliente: null, datosDeCliente: !!o.datos,
    senales: { nif: !!o.nif, tarifa: !!o.tarifa, negociacion: !!o.negociacion, gocardless: false } })

const EMPRESAS: FichaCrm[] = [
  empresa('10', '00000000T', 'baja'), empresa('11', '00000000-t', 'activo'), empresa('12', 'ES00000000T', 'moroso'),
  empresa('20', 'B00000000', 'sin_clasificar'), empresa('21', 'b-00000000', 'solo_renta'),
  empresa('30', 'X0000000T', null),
  empresa('40', '123', 'activo'), empresa('41', '123', 'baja'),
  empresa('50', null, 'activo'),
  ...Array.from({ length: MAX_FICHAS_POR_NIF }, (_, i) => empresa(String(60 + i), 'Y0000000Z', 'activo')),
]
const CONTACTOS: FichaContactoCrm[] = [
  contacto('1', { nif: 'B00000000' }),                         // con el NIF de una empresa: se une a ese cliente
  contacto('2', { empresas: ['30'] }),                         // persona de contacto de la 30
  contacto('3', { empresas: ['30'], tarifa: true, datos: true }), // persona de contacto con datos de cliente: a revisar
  contacto('4', { negociacion: true }),                        // solo una negociación: cliente y a revisar
  contacto('5', { tarifa: true }),                             // cliente por su tarifa
  contacto('6', {}),                                           // sin nada: fuera
]

/** La lectura entera sobre un CRM: sus clientes y su «Pendiente de revisar» (como leer.ts · guardarLectura, sin la base). */
function lecturaEntera(empresas: FichaCrm[], contactos: FichaContactoCrm[], unir: boolean) {
  const l = { crm: 'bitrix24', unir, empresas, contactos: { contactos, confirmado: true } }
  const { fichas, reparto } = fichasDeClientes(l)
  const clientes = agrupar(fichas, unir)
  const difs: DiferenciaDeCrm[] = [...diferenciasDeLectura(clientes, [], unir, 'Bitrix24')]
  for (const p of repartirContactos(contactos, fichasDeClientes(l).nifs, 'Bitrix24').pendientes) {
    difs.push({ tipo: p.tipo, porque_codigo: p.tipo === 'contacto_solo_negociacion' ? 'solo_negociacion' : 'empresa_con_datos', porque: p.porque,
      tipo_ficha: 'contacto', id_externo: p.idExterno, datos: { empresas: p.empresas, nombre: p.nombre } })
  }
  return { clientes, difs, reparto: reparto! }
}

/** Lo que Sumied guarda como fichas de cliente tras una lectura entera (de_empresa = ''). */
const guardadasDe = (empresas: FichaCrm[], contactos: FichaContactoCrm[], unir: boolean): FichaGuardada[] =>
  lecturaEntera(empresas, contactos, unir).clientes.flatMap((c) => c.fichas)

type Cambio = { nombre: string; antes: FichaGuardada; despues: FichaGuardada }
const cambiosDe = (f: FichaGuardada): Cambio[] => {
  const c = (despues: FichaGuardada, nombre: string) => ({ nombre, antes: f, despues })
  return [
    c({ ...f, nombre: `${f.nombre} (cambiada)` } as FichaGuardada, 'el nombre'),
    c({ ...f, situacion: f.tipoFicha === 'contacto' ? f.situacion : (f.situacion === 'activo' ? 'baja' : 'activo') } as FichaGuardada, 'la situación'),
    c({ ...f, nif: 'B00000000', nifEnCrm: 'B00000000' } as FichaGuardada, 'pasa al NIF B00000000'),
    c({ ...f, nif: null, nifEnCrm: null } as FichaGuardada, 'se queda sin NIF'),
  ]
}

describe('El aviso de una ficha deja lo mismo que la lectura entera', () => {
  for (const unir of [true, false]) {
    const todas: FichaGuardada[] = [...EMPRESAS, ...CONTACTOS]
    for (const f of todas) {
      for (const cambio of cambiosDe(f)) {
        it(`${unir ? 'con' : 'sin'} la unión · ${claveDeFicha(f)} · ${cambio.nombre}`, () => {
          const empresasDespues = EMPRESAS.map((x) => (claveDeFicha(x) === claveDeFicha(f) ? cambio.despues as FichaCrm : x))
          const contactosDespues = CONTACTOS.map((x) => (claveDeFicha(x) === claveDeFicha(f) ? cambio.despues as FichaContactoCrm : x))
          const entera = lecturaEntera(empresasDespues, contactosDespues, unir)

          const plan = planDeFichaSuelta({ crm: 'bitrix24', unir, contactosConfirmados: true, guardadas: guardadasDe(EMPRESAS, CONTACTOS, unir),
            tipoFicha: f.tipoFicha ?? 'empresa', idExterno: f.idExterno, nueva: cambio.despues, clienteGuardado: null })

          // Los clientes que guarda el aviso son, tal cual, los de la lectura entera que tienen alguna de sus fichas.
          const claves = new Set(plan.clientes.flatMap((c) => c.fichas.map(claveDeFicha)))
          expect(plan.clientes).toEqual(entera.clientes.filter((c) => c.fichas.some((x) => claves.has(claveDeFicha(x)))))
          // Y la ficha del aviso está en ellos si en la lectura entera entra como cliente.
          const entra = entera.clientes.some((c) => c.fichas.some((x) => claveDeFicha(x) === claveDeFicha(f)))
          expect(claves.has(claveDeFicha(f))).toBe(entra)
          // Su «Pendiente de revisar», el de la lectura entera para esas fichas.
          const renovar = new Set(plan.fichasARenovar.map((x) => claveDeFicha(x)))
          const deEsas = entera.difs.filter((d) => renovar.has(`${d.tipo_ficha}:${d.id_externo}`))
          expect([...plan.diferencias].sort(porDif)).toEqual([...deEsas].sort(porDif))
          // Una persona de contacto: sus empresas, las de la lectura entera.
          if (f.tipoFicha === 'contacto') {
            const empresasEnEntera = [...entera.reparto.personas].filter(([, cs]) => cs.some((c) => c.idExterno === f.idExterno)).map(([e]) => e).sort()
            expect(plan.persona?.empresas.sort() ?? []).toEqual(empresasEnEntera)
          }
        })
      }
    }
  }
})

const porDif = (a: DiferenciaDeCrm, b: DiferenciaDeCrm) => `${a.tipo}|${a.tipo_ficha}|${a.id_externo}`.localeCompare(`${b.tipo}|${b.tipo_ficha}|${b.id_externo}`)

describe('Lo que la lectura entera no ve igual, y el aviso dice', () => {
  const guardadas = guardadasDe(EMPRESAS, CONTACTOS, true)
  it('una baja no borra nada: no guarda clientes y sale en «Pendiente de revisar»', () => {
    const p = planDeFichaSuelta({ crm: 'bitrix24', unir: true, contactosConfirmados: true, guardadas, tipoFicha: 'empresa', idExterno: '30', nueva: null, clienteGuardado: null })
    expect(p.clientes).toEqual([])
    expect(p.diferencias).toEqual([{ tipo: 'ya_no_es_cliente_en_crm', porque_codigo: 'borrada_en_crm', tipo_ficha: 'empresa', id_externo: '30', datos: { nombre: 'Empresa 30 de Prueba' },
      porque: 'La empresa «Empresa 30 de Prueba» (ficha 30 de Bitrix24) se ha borrado en Bitrix24. En Sumied no se borra nada: decide si se queda.' }])
  })
  it('sin el mapa de contactos confirmado, un contacto no entra (como en la lectura entera)', () => {
    const p = planDeFichaSuelta({ crm: 'bitrix24', unir: true, contactosConfirmados: false, guardadas, tipoFicha: 'contacto', idExterno: '5', nueva: CONTACTOS[4], clienteGuardado: null })
    expect(p.clientes).toEqual([])
    expect(p.tocaPersona).toBe(false)
  })
  it('un contacto que era el cliente y pasa a persona de contacto: «ya no es cliente», sin archivar', () => {
    const ahora = { ...CONTACTOS[4], empresas: ['30'] }
    const p = planDeFichaSuelta({ crm: 'bitrix24', unir: true, contactosConfirmados: true, guardadas, tipoFicha: 'contacto', idExterno: '5', nueva: ahora,
      clienteGuardado: { tipoFicha: 'contacto', idExterno: '5', nombre: 'Contacto 5 de Prueba' } })
    expect(p.persona?.empresas).toEqual(['30'])
    expect(p.diferencias.map((d) => [d.tipo, d.id_externo])).toEqual([['ya_no_es_cliente_en_crm', '5']])
  })
})
