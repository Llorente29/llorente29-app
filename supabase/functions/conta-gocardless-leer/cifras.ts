// supabase/functions/conta-gocardless-leer/cifras.ts
//
// R20 · La comprobación de cada noche de «Clientes y cuotas» (Julio, 26/11, regla 5): con lo recién leído, calcula las
// cifras con el MISMO código que la pantalla (_shared/tarifa/cifras.ts) y, si GoCardless y las cuotas de Sumied no
// cuadran en el mes del próximo cobro, o una cifra no es la suma de su lista, lo deja en «Pendiente de revisar»
// (cifras_no_cuadran) con la diferencia y sus grupos en palabras; de ahí sale en «Lo que tienes que hacer».
//
// Lee lo mismo que la pantalla (conta_pantalla_clientes) pero como servidor: las vistas de la tarifa son
// security_invoker y se filtran aquí por la cuenta (regla 9); conta_cifras_del_cobro contesta al servidor.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { avisosDeLasCifras, cargosParaDeuda, cifrasDeCuotas, cruceDelBanco, delCobro, mesAnterior, noCobrado, recibosDeLaEmpresa } from '../_shared/tarifa/cifras.ts'
import type { FilasDeLaTarifa } from '../_shared/cobro/datos.ts'
import { leerTodas } from './paginas.ts'
import type { DiferenciaAEscribir } from './plan.ts'

type Fila = Record<string, unknown>

export async function comprobarCifras(db: SupabaseClient, cuenta: string, empresa: string, hoy: string): Promise<DiferenciaAEscribir[]> {
  const { data: cob, error } = await db.rpc('conta_cifras_del_cobro', { p_cuenta: cuenta })
  if (error) throw new Error(`conta_cifras_del_cobro: ${error.message}`)
  const del = delCobro(cob)
  const mes = del.meses.find((m) => m.empresaId === empresa)?.mes
  if (!mes) return []
  const todas = <T extends Fila>(tabla: string, columnas: string, filtro: 'account_id' | 'cuenta_id') =>
    leerTodas<T>((d, h) => db.from(tabla).select(columnas).eq(filtro, cuenta).order('id').range(d, h), tabla)
  const [servicios, precios, asignaciones, niveles, paquetes, lineasDePaquete, ajustes, cargos] = await Promise.all([
    todas('conta_servicio', 'id, company_id, clave, nombre, forma, activo, incluye', 'account_id'),
    todas('conta_consulta_tarifa_precio', '*', 'cuenta_id'),
    todas('conta_consulta_asignacion', '*', 'cuenta_id'),
    todas('conta_servicio_nivel', 'id, servicio_id, nombre, orden, incluye, mas_elegido, activo', 'account_id'),
    todas('conta_paquete', 'id, company_id, nombre, descripcion, exceso_por_trabajador, activo', 'account_id'),
    todas('conta_paquete_linea', 'id, paquete_id, servicio_id, nivel_id, limite_trabajadores, orden', 'account_id'),
    leerTodas<Fila>((d, h) => db.from('conta_gestoria_ajustes').select('company_id, mitad_de_mes, cambios_de_tarifa').eq('account_id', cuenta).order('company_id').range(d, h), 'los ajustes'),
    leerTodas<Fila>((d, h) => db.from('conta_consulta_cargo_devuelto').select('*').eq('cuenta_id', cuenta).eq('empresa_id', empresa).order('gc_id').range(d, h), 'los cargos devueltos'),
  ])
  const filas: FilasDeLaTarifa = { servicios, precios, asignaciones, niveles, paquetes, lineasDePaquete, ajustes }
  const fichas = new Set(asignaciones.filter((a) => a.empresa_id === empresa).map((a) => String(a.cliente_id)))
  const nombres = new Map<string, string>()
  const ids = [...fichas]
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error: e } = await db.from('party').select('id, name').eq('account_id', cuenta).in('id', ids.slice(i, i + 300))
    if (e) throw new Error(`party: ${e.message}`)
    for (const p of (data ?? []) as { id: string; name: string }[]) nombres.set(p.id, p.name)
  }
  const nombreDe = (id: string) => nombres.get(id) ?? null
  const c = cifrasDeCuotas(mes, del.suscripciones.filter((s) => s.empresaId === empresa),
    recibosDeLaEmpresa(filas, empresa, mes, nombreDe), recibosDeLaEmpresa(filas, empresa, mesAnterior(mes), nombreDe), nombreDe)
  // R20b · Cruzado con el banco (K14), como en la pantalla: lo que pagó el banco no es deuda.
  const { data: ban, error: eBan } = await db.rpc('conta_cifras_del_banco', { p_cuenta: cuenta })
  if (eBan) throw new Error(`conta_cifras_del_banco: ${eBan.message}`)
  const n = noCobrado(cargosParaDeuda(cargos, nombreDe), hoy, cruceDelBanco(ban, [empresa], () => 'esta empresa'))
  const avisos = avisosDeLasCifras(c, n)
  console.log(JSON.stringify({ r20: 'cifras', empresa, mes, gocardless: c.gocardless.lista.totalCent, sumied: c.sumied.lista.totalCent,
    diferencia: c.diferencia.cent, no_cobrado: n.lista.totalCent, avisos: avisos.map((a) => a.codigo) }))
  return avisos.map((a) => ({ tipo: 'cifras_no_cuadran', porque_codigo: a.codigo, porque: a.porque, company_id: empresa, party_id: null, gc_cliente_id: null, crm: null, tipo_ficha: null, id_externo: null,
    datos: { mes, gocardless_cent: c.gocardless.lista.totalCent, sumied_cent: c.sumied.lista.totalCent, diferencia_cent: c.diferencia.cent,
      grupos: c.diferencia.grupos.map((g) => ({ titulo: g.titulo, cent: g.totalCent, n: g.filas.length })) } }))
}
