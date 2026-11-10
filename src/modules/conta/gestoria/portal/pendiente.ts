// src/modules/conta/gestoria/portal/pendiente.ts
//
// GP · Tarea 4 · Las tarjetas del portal en «Lo que tienes que hacer», de lo
// que lee conta_portal_pendiente. Pura: la prueba
// tests/unit/modules/conta/portal/pendiente.test.ts.

import type { PendientePortal } from './datos'

export interface Tarjeta { id: string; n: number; titulo: string; tono: 'mal' | 'aviso' | 'neutro'; clientes: { id: string; nombre: string; que: string }[] }

export function tarjetasDelPortal(d: PendientePortal): Tarjeta[] {
  const t: Tarjeta[] = []
  const por = <T extends { cliente_id: string; cliente: string }>(xs: T[], que: (x: T) => string) => {
    const m = new Map<string, { id: string; nombre: string; que: string[] }>()
    for (const x of xs) { const c = m.get(x.cliente_id) ?? { id: x.cliente_id, nombre: x.cliente, que: [] }; c.que.push(que(x)); m.set(x.cliente_id, c) }
    return [...m.values()].map((c) => ({ id: c.id, nombre: c.nombre, que: c.que.join(' · ') }))
  }
  const pide = [...d.solicitudes.map((s) => ({ cliente_id: s.cliente_id, cliente: s.cliente, t: `${s.tipo === 'alta' ? 'Alta' : 'Baja'} de ${s.nombre}` })),
    ...d.incidencias.map((i) => ({ cliente_id: i.cliente_id, cliente: i.cliente, t: i.tipo === 'no_de_acuerdo' ? 'No está de acuerdo con el recibo' : 'Quiere cambiar sus datos' }))]
  if (pide.length) t.push({ id: 'pide', n: pide.length, titulo: pide.length === 1 ? 'Petición de un cliente' : 'Peticiones de clientes', tono: 'aviso', clientes: por(pide, (x) => x.t) })
  const sinLeer = d.mensajes.reduce((a, m) => a + Number(m.sin_leer), 0)
  if (sinLeer) t.push({ id: 'mensajes', n: sinLeer, titulo: sinLeer === 1 ? 'Mensaje sin leer' : 'Mensajes sin leer', tono: 'neutro',
    clientes: d.mensajes.map((m) => ({ id: m.cliente_id, nombre: m.cliente, que: `${m.sin_leer} sin leer` })) })
  if (d.subidas.length) t.push({ id: 'subidas', n: d.subidas.length, titulo: d.subidas.length === 1 ? 'Documento sin llegar al buzón' : 'Documentos sin llegar al buzón', tono: 'mal',
    clientes: por(d.subidas, (s) => s.nombre) })
  return t
}

