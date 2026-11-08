// supabase/functions/_shared/crm/fichaSuelta.ts
//
// G01d · El núcleo partido: lo que hace UN aviso del CRM con su ficha, con las
// mismas reglas que la lectura entera (leer.ts) y sin cambiarla. Puro.
//
// Una ficha no se decide sola: la unión por NIF, la situación más viva del
// grupo, «su NIF sale en 10 fichas o más» y si un contacto es cliente dependen
// de las demás. Por eso el aviso parte de lo que Sumied ya guarda de cada
// ficha (conta_gestoria_ficha.ficha, la ficha neutra de la última lectura),
// pone la nueva en su sitio y pasa el conjunto por las MISMAS funciones que la
// lectura entera (fichasDeClientes, agrupar, diferenciasDeLectura,
// repartirContactos). De lo que sale, solo se guardan los clientes tocados:
// el grupo de la ficha ahora y, si cambió de NIF, el de antes.
//
//   · Empresa: cambia su ficha en el conjunto.
//   · Contacto (con el mapa de contactos confirmado): su destino, como en la
//     lectura entera. Cliente, entra en el conjunto; persona de contacto, se
//     cambian SUS filas de persona (las de los demás no se tocan); fuera, sale
//     del conjunto. Su negociación es la de la última lectura entera (Julio,
//     08/11).
//   · Baja: no se borra nada en Sumied. Sale en «Pendiente de revisar» y la
//     ficha se queda como estaba (la lectura de la noche lo vuelve a mirar).

import { agrupar, diferenciasDeLectura, nifComoLaBase, yaNoSonClientes, type Cliente, type ClienteGuardado, type DiferenciaDeCrm } from './clientes.ts'
import { personaDeContacto, repartirContactos } from './contactos.ts'
import { claveDeFicha, nombreDelCrm, type FichaContactoCrm, type FichaCrm } from './ficha.ts'
import { fichasDeClientes } from './leer.ts'

export type FichaGuardada = FichaCrm | FichaContactoCrm

export interface EntradaFichaSuelta {
  crm: string
  unir: boolean
  /** Con el mapa de contactos confirmado entran contactos (como en la lectura entera). */
  contactosConfirmados: boolean
  /** Las fichas que entran como clientes, como las guardó Sumied (de_empresa = ''). */
  guardadas: readonly FichaGuardada[]
  /**
   * Si la ficha del aviso es la principal de un cliente de Sumied que vino del
   * CRM (conta_gestoria_cliente, sin archivar): su nombre. Si deja de entrar
   * como cliente, sale «ya no es cliente», como en la lectura entera.
   */
  clienteGuardado: ClienteGuardado | null
  /** La ficha del aviso, ya leída (null: se ha borrado en el CRM). */
  tipoFicha: 'empresa' | 'contacto'
  idExterno: string
  nueva: FichaGuardada | null
}

export interface PlanFichaSuelta {
  /** Los clientes que se guardan con conta_crm_guardar_clientes (los tocados, enteros). */
  clientes: Cliente<FichaCrm>[]
  /** Las fichas cuyo «Pendiente de revisar» se renueva, y lo nuevo. */
  fichasARenovar: { tipoFicha: 'empresa' | 'contacto'; idExterno: string }[]
  diferencias: DiferenciaDeCrm[]
  /** Un contacto persona de contacto: sus empresas y lo que se guarda de él. Null: no es persona de contacto (se quitan sus filas). */
  persona: { idExterno: string; empresas: string[]; contacto: ReturnType<typeof personaDeContacto> } | null
  /** Se tocan las filas de persona de este contacto (solo en avisos de contacto). */
  tocaPersona: boolean
  /** Qué ha hecho, en una frase para el registro. */
  frase: string
}

const clave = (tipoFicha: 'empresa' | 'contacto', idExterno: string) => claveDeFicha({ tipoFicha, idExterno })

/** Las empresas y los contactos-cliente guardados, como LecturaDelCrm (para usar las mismas funciones). */
function comoLectura(e: EntradaFichaSuelta, fichas: readonly FichaGuardada[]) {
  const empresas = fichas.filter((f) => (f.tipoFicha ?? 'empresa') === 'empresa') as FichaCrm[]
  const contactos = fichas.filter((f) => f.tipoFicha === 'contacto') as FichaContactoCrm[]
  return { crm: e.crm, unir: e.unir, empresas, contactos: e.contactosConfirmados ? { contactos, confirmado: true } : null }
}

export function planDeFichaSuelta(e: EntradaFichaSuelta): PlanFichaSuelta {
  const nombre = nombreDelCrm(e.crm)
  const k = clave(e.tipoFicha, e.idExterno)
  const vieja = e.guardadas.find((f) => claveDeFicha(f) === k) ?? null

  // Baja: nada se borra. «Pendiente de revisar» de esa ficha, con su porqué.
  if (!e.nueva) {
    const quien = e.tipoFicha === 'empresa' ? 'La empresa' : 'El contacto'
    return {
      clientes: [], fichasARenovar: [], persona: null, tocaPersona: false,
      diferencias: [{ tipo: 'ya_no_es_cliente_en_crm', porque_codigo: 'borrada_en_crm', tipo_ficha: e.tipoFicha, id_externo: e.idExterno, datos: { nombre: vieja?.nombre ?? null },
        porque: `${quien} ${vieja?.nombre ? `«${vieja.nombre}» ` : ''}(${e.tipoFicha === 'contacto' ? 'contacto' : 'ficha'} ${e.idExterno} de ${nombre}) se ha borrado en ${nombre}. En Sumied no se borra nada: decide si se queda.` }],
      frase: `${quien} ${e.idExterno} se ha borrado en ${nombre}: en «Pendiente de revisar», sin borrar nada en Sumied.`,
    }
  }

  // Un contacto sin el mapa confirmado no entra (como en la lectura entera): solo lo cuenta la de la noche.
  if (e.tipoFicha === 'contacto' && !e.contactosConfirmados) {
    return { clientes: [], fichasARenovar: [], diferencias: [], persona: null, tocaPersona: false,
      frase: `Contacto ${e.idExterno}: no entra hasta confirmar el mapa de los contactos.` }
  }

  const otras = e.guardadas.filter((f) => claveDeFicha(f) !== k)
  // La nueva, en el sitio de la vieja (sin la unión, agrupar deja las fichas en el orden en que llegan).
  let conNueva: FichaGuardada[] = vieja ? e.guardadas.map((f) => (claveDeFicha(f) === k ? e.nueva! : f)) : [...e.guardadas, e.nueva]
  let persona: PlanFichaSuelta['persona'] = null
  const pendientesDelContacto: DiferenciaDeCrm[] = []

  if (e.tipoFicha === 'contacto') {
    // Su destino, con la misma regla y los mismos NIF que la lectura entera.
    const { nifs } = fichasDeClientes(comoLectura(e, conNueva))
    const r = repartirContactos([e.nueva as FichaContactoCrm], nifs, nombre)
    if (!r.clientes.length) conNueva = otras
    for (const [empresa, cs] of r.personas) {
      persona = persona ?? { idExterno: e.idExterno, empresas: [], contacto: personaDeContacto(cs[0]) }
      persona.empresas.push(empresa)
    }
    for (const p of r.pendientes) {
      pendientesDelContacto.push({ tipo: p.tipo, porque_codigo: p.tipo === 'contacto_solo_negociacion' ? 'solo_negociacion' : 'empresa_con_datos',
        porque: p.porque, tipo_ficha: 'contacto', id_externo: p.idExterno, datos: { empresas: p.empresas, nombre: p.nombre } })
    }
  }

  // Los clientes, como en la lectura entera, con todo el conjunto.
  const { fichas } = fichasDeClientes(comoLectura(e, conNueva))
  const todos = agrupar(fichas, e.unir)
  // Los tocados: el que tiene la ficha ahora y el que tenía antes su NIF (si cambió de grupo).
  const nifViejo = vieja ? nifComoLaBase(vieja.nif) : null
  const tocados = todos.filter((c) => c.fichas.some((f) => claveDeFicha(f) === k) || (!!nifViejo && c.nif === nifViejo))
  const diferencias = [...diferenciasDeLectura(tocados, [], e.unir, nombre), ...pendientesDelContacto]
  const fichasARenovar = new Map<string, { tipoFicha: 'empresa' | 'contacto'; idExterno: string }>()
  for (const c of tocados) for (const f of c.fichas) fichasARenovar.set(claveDeFicha(f), { tipoFicha: f.tipoFicha ?? 'empresa', idExterno: f.idExterno })
  fichasARenovar.set(k, { tipoFicha: e.tipoFicha, idExterno: e.idExterno })

  const esCliente = tocados.some((c) => c.fichas.some((f) => claveDeFicha(f) === k))
  if (!esCliente && e.clienteGuardado) diferencias.push(...yaNoSonClientes([e.clienteGuardado], todos, e.contactosConfirmados, nombre))
  const frase = esCliente
    ? `${e.tipoFicha === 'empresa' ? 'Empresa' : 'Contacto'} ${e.idExterno} de ${nombre}, al día en Sumied${tocados.length > 1 ? ` (y ${tocados.length - 1} cliente más de su NIF de antes)` : ''}.`
    : persona ? `Contacto ${e.idExterno} de ${nombre}: persona de contacto de ${persona.empresas.length === 1 ? 'la empresa' : 'las empresas'} ${persona.empresas.join(', ')}.`
    : `Contacto ${e.idExterno} de ${nombre}: no entra en Sumied (sin empresa y sin señales de cliente).`
  return { clientes: tocados as Cliente<FichaCrm>[], fichasARenovar: [...fichasARenovar.values()], diferencias, persona, tocaPersona: e.tipoFicha === 'contacto', frase }
}
