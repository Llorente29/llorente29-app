// src/modules/conta/gestoria/x35/ElMesDeUnVistazo.tsx
//
// X35 (27/11) · «El mes de un vistazo», el Inicio de «Clientes y cuotas»: la entrada del gestor. Fiel a la maqueta aprobada
// (GyPbKxEDqa8pPmnvwGqvcd, «Inicio · el mes de un vistazo»), no al estilo de hoy de Sumied: la banda oscura con el anillo,
// la frase del mes, las píldoras y tres cifras; y «Lo que hay que resolver», ordenado por dinero.
// Solo lee (datos.ts). Cada cifra y cada asunto se abren en la lista que los forma, que suma exactamente lo que se enseña
// (modelo.ts). Lo que no se puede calcular no sale, y se dice abajo en una línea.
// La empresa es la activa de Sumied (o la de ?empresa=); los meses, el anterior, el actual y el siguiente al de hoy.

import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { rutaClientesCuotas, rutaCobroGestoria, rutaFacturasCuotas } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { horaEnMadrid, primerNombre, saludo } from '@/modules/conta/lib/inicio'
import { Dialogo } from '@/modules/conta/proveedor/piezas'
import { euros } from '../../../../../supabase/functions/_shared/tarifa/cifras'
import { entradaDelMes, leerCobrosGc, leerLoDeLaCuenta, leerLoDelMes } from './datos'
import { dondeSeEscapa, grafica, seisMeses } from './escapa'
import { mesDe, mesDeUnVistazo, tituloDelMes, type Asunto, type Cifra, type EstadoPaso, type MesDeUnVistazo } from './modelo'

const C = { tinta: '#14202e', suave: '#5b6878', fondo: '#f4f6f9', banda: '#0f1b2d', bandaCaja: '#17263b', bandaSuave: '#9fb0c5', bandaTexto: '#c6d0dc',
  verde: '#4cc38a', ambar: '#f5a524', azul: '#0b4f86', borde: '#e3e8ef', linea: '#eef1f5' }
const PASO: Record<EstadoPaso, [string, string, string]> = { hecho: [C.verde, 'rgba(76,195,138,.15)', '✓'], falta: [C.ambar, 'rgba(245,165,36,.15)', '!'], luego: [C.bandaSuave, 'rgba(159,176,197,.12)', '○'] }
const ETIQUETA: Record<Asunto['etiqueta'], [string, string]> = { Urgente: ['#a12a2a', '#fdecec'], Facturar: ['#0b4f86', '#e6f0fa'], Cobrar: ['#9a4a00', '#fff1dc'], Revisar: ['#3d4a5a', '#eef1f5'] }
const NOMBRE_CORTO = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const horaDe = (iso: string | null) => (iso ? new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : null)
const diaDe = (iso: string | null) => (iso ? new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'numeric' }).format(new Date(iso)) : null)

type Abierta = { titulo: string; fuente: string; cifra: string; lista: Cifra['lista']; ir: { texto: string; ruta: string } | null }

export function ElMesDeUnVistazo() {
  const { accountId, cargando, userName } = useCuentaConta()
  const { empresas, activa: laActiva } = useEmpresas()
  // Como «Facturas del mes»: la empresa activa de Sumied, o la de ?empresa=.
  const [params] = useSearchParams()
  const activa = empresas.find((e) => e.id === params.get('empresa')) ?? laActiva
  const hoy = hoyEnMadrid()
  const actual = hoy.slice(0, 7)
  const meses = [mesDe(actual, -1), actual, mesDe(actual, 1)]
  const [mes, setMes] = useState(actual)
  const [abierta, setAbierta] = useState<Abierta | null>(null)
  const listo = !cargando && accountId && activa
  const lasEmpresas = empresas.map((e) => ({ id: e.id, nombre: e.nombre }))
  const cuenta = useLeer(listo ? () => leerLoDeLaCuenta(accountId, lasEmpresas, activa.id, hoy) : null, `${accountId}:${activa?.id}:x35-cuenta`)
  const seis = seisMeses(hoy)
  const cobros6 = useLeer(listo ? () => leerCobrosGc(activa.id, `${seis[0]}-01`, hoy) : null, `${activa?.id}:${seis[0]}:x35-seis`)
  const delMes = useLeer(listo && mes <= actual ? () => leerLoDelMes(accountId, activa.id, mes) : null, `${accountId}:${activa?.id}:${mes}:x35-mes`)

  const m: MesDeUnVistazo | null = !activa || (mes <= actual && !delMes.datos && !delMes.error) ? null
    : mesDeUnVistazo(entradaDelMes(mes, hoy, { id: activa.id, nombre: activa.nombre }, delMes.datos ?? null, cuenta.datos ?? null).entrada)

  const rutaDe = (ir: Asunto['ir']): { texto: string; ruta: string } => ir === 'clientes' ? { texto: 'Ir a Clientes', ruta: rutaClientesCuotas() }
    // «Facturar el mes» (R21) aún no está en main: «Mandar a Cegid» abre «Revisar el cobro».
    : ir === 'facturar' ? { texto: 'Ir a Revisar el cobro', ruta: rutaCobroGestoria(activa?.id, mes) }
    : { texto: 'Ir a Facturas del mes', ruta: rutaFacturasCuotas(activa?.id, mes) }
  const fallos = [...(delMes.datos?.fallos ?? []).map((f) => `No se ha podido leer ${f}.`), ...(delMes.error ? [`No se han podido leer los cobros del mes: ${delMes.error}`] : []),
    ...(cuenta.error ? [`No se ha podido leer «Te deben» ni el próximo cobro: ${cuenta.error}`] : [])]
  const leido = cuenta.datos?.leidoAt ?? null
  // PR 2 · La gráfica y «Dónde se te escapa el dinero» salen de «Te deben»: solo si es fiable (cruzado con el banco).
  const nc = cuenta.datos?.noCobrado?.cruzado ? cuenta.datos.noCobrado : null
  const nombre = primerNombre(userName)

  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif', color: C.tinta, background: C.fondo, minHeight: '100%' }} data-testid="x35-inicio">
      <div style={{ maxWidth: 1320, margin: '0 auto', padding: '24px 24px 48px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 18 }}>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14 }}>
          <div style={{ flex: '1 1 360px' }}>
            <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800, letterSpacing: '-.6px' }}>{saludo(horaEnMadrid())}{nombre ? `, ${nombre}` : ''}</h1>
            <p style={{ margin: '4px 0 0', fontSize: 14, color: C.suave }}>
              <span aria-hidden="true" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: fallos.length ? C.ambar : '#1f8a55', marginRight: 6 }} />
              {activa?.nombre ?? ''}{leido ? ` · GoCardless leído el ${diaDe(leido)} a las ${horaDe(leido)}` : ''}
            </p>
          </div>
          <nav aria-label="Elegir mes" style={{ display: 'flex', background: '#e6ebf1', borderRadius: 10, padding: 4, gap: 4 }}>
            {meses.map((x) => (
              <button key={x} type="button" aria-pressed={x === mes} onClick={() => setMes(x)}
                style={{ border: 0, cursor: 'pointer', padding: '10px 18px', borderRadius: 8, fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
                  ...(x === mes ? { background: '#fff', color: C.banda, boxShadow: '0 1px 3px rgba(15,27,45,.18)' } : { background: 'transparent', color: '#3d4a5a' }) }}>
                {NOMBRE_CORTO[Number(x.slice(5, 7)) - 1]}
              </button>
            ))}
          </nav>
        </div>

        {!m ? (
          <section aria-busy="true" style={{ background: C.banda, color: C.bandaSuave, borderRadius: 18, padding: '24px 26px', fontSize: 15 }}>Leyendo {tituloDelMes(mes).toLowerCase()}…</section>
        ) : (<>
          <section aria-label={`El mes: ${m.titulo}`} style={{ background: C.banda, color: '#fff', borderRadius: 18, padding: '24px 26px', display: 'flex', flexWrap: 'wrap', gap: 28, alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 20, alignItems: 'center', flex: '1 1 380px' }}>
              <svg width="112" height="112" viewBox="0 0 112 112" role="img" aria-label={`${m.pct} % del mes hecho`} style={{ flex: 'none' }}>
                <circle cx="56" cy="56" r="46" fill="none" stroke="#24364f" strokeWidth="12" />
                {/* eslint-disable-next-line no-restricted-syntax -- m.pct es un entero calculado aquí, nunca null */}
                <circle cx="56" cy="56" r="46" fill="none" stroke={C.verde} strokeWidth="12" strokeLinecap="round" strokeDasharray={`${(2 * Math.PI * 46 * m.pct / 100).toFixed(1)} 999`} transform="rotate(-90 56 56)" />
                <text x="56" y="62" textAnchor="middle" fill="#fff" fontSize="24" fontWeight="800" fontFamily="Inter, sans-serif">{m.pct} %</text>
              </svg>
              <div>
                <p style={{ margin: 0, fontSize: 13, color: C.bandaSuave, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.6px' }}>{m.titulo}</p>
                <p style={{ margin: '4px 0 10px', fontSize: 22, fontWeight: 700, lineHeight: 1.25 }} data-testid="x35-frase">{m.frase}</p>
                <ul aria-label="Los pasos del mes" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, listStyle: 'none', margin: 0, padding: 0 }}>
                  {m.pasos.map((p) => (
                    <li key={p.nombre} style={{ fontSize: 13, fontWeight: 600, padding: '5px 10px', borderRadius: 20, color: PASO[p.estado][0], background: PASO[p.estado][1] }}>
                      <span aria-hidden="true">{PASO[p.estado][2]}</span> {p.nombre}<span className="cx-solo-lector">{p.estado === 'hecho' ? ': hecho' : p.estado === 'falta' ? ': falta' : ': todavía no'}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, flex: '1 1 520px' }}>
              {m.cifras.map((k) => (
                <button key={k.id} type="button" data-testid={`x35-cifra-${k.id}`} onClick={() => setAbierta({ titulo: k.titulo, fuente: k.fuente, cifra: k.valor, lista: k.lista, ir: null })}
                  style={{ background: C.bandaCaja, borderRadius: 12, padding: '14px 16px', border: 0, textAlign: 'left', cursor: 'pointer', color: '#fff', fontFamily: 'inherit' }}>
                  <span style={{ display: 'block', fontSize: 13, color: C.bandaSuave }}>{k.titulo}</span>
                  <span style={{ display: 'block', margin: '4px 0 0', fontSize: 24, fontWeight: 800, letterSpacing: '-.5px', color: k.tono === 'bien' ? C.verde : k.tono === 'aviso' ? C.ambar : '#fff' }}>{k.valor}</span>
                  <span style={{ display: 'block', margin: '2px 0 0', fontSize: 12, color: C.bandaTexto }}>{k.fuente}</span>
                </button>
              ))}
            </div>
          </section>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'stretch' }}>
          <section aria-labelledby="x35-resolver" style={{ flex: '1 1 440px', minWidth: 0, background: '#fff', border: `1px solid ${C.borde}`, borderRadius: 16, padding: '20px 22px' }}>
            <h2 id="x35-resolver" style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700 }}>Lo que hay que resolver</h2>
            <p style={{ margin: '0 0 8px', fontSize: 13, color: C.suave }}>{m.asuntos.length ? 'Primero lo que más dinero mueve' : 'Nada que resolver en este mes.'}</p>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {m.asuntos.map((i) => (
                <li key={i.id}>
                  <button type="button" data-testid={`x35-asunto-${i.id}`} onClick={() => setAbierta({ titulo: i.titulo, fuente: i.texto, cifra: i.importe, lista: i.lista, ir: rutaDe(i.ir) })}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', width: '100%', border: 0, borderTop: `1px solid ${C.linea}`, background: 'none', textAlign: 'left', cursor: 'pointer', color: C.tinta, fontFamily: 'inherit' }}>
                    <span style={{ flex: 'none', width: 78, textAlign: 'center', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.3px', padding: '5px 0', borderRadius: 6, color: ETIQUETA[i.etiqueta][0], background: ETIQUETA[i.etiqueta][1] }}>{i.etiqueta}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>{i.titulo}</span>
                      <span style={{ display: 'block', fontSize: 13, color: C.suave, marginTop: 2 }}>{i.texto}</span>
                    </span>
                    <span style={{ fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap' }}>{i.importe}</span>
                    <span aria-hidden="true" style={{ color: C.azul, fontWeight: 700, fontSize: 18 }}>›</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          {nc && cobros6.datos && (() => {
            const g = grafica(hoy, cobros6.datos, nc)
            const tope = Math.max(1, ...g.map((x) => x.cobrado.totalCent + x.sinCobrar.totalCent))
            return (
              <section aria-labelledby="x35-grafica" style={{ flex: '1 1 440px', minWidth: 0, background: '#fff', border: `1px solid ${C.borde}`, borderRadius: 16, padding: '20px 22px' }} data-testid="x35-grafica">
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, alignItems: 'baseline' }}>
                  <h2 id="x35-grafica" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Cobrado y sin cobrar</h2>
                  <span style={{ fontSize: 12, color: C.suave }}><span aria-hidden="true" style={{ display: 'inline-block', width: 10, height: 10, background: C.azul, borderRadius: 2 }} /> cobrado <span aria-hidden="true" style={{ display: 'inline-block', width: 10, height: 10, background: '#e8833a', borderRadius: 2, marginLeft: 10 }} /> sin cobrar</span>
                </div>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: C.suave }}>Recibos de GoCardless de cada mes · encima, el % que sigue sin cobrar</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 14, alignItems: 'end', height: 190, marginTop: 14, borderBottom: `1px solid ${C.borde}` }}>
                  {g.map((x) => (
                    <button key={x.mes} type="button" data-testid={`x35-mes-${x.mes}`} aria-label={`${x.nombre}: cobrado ${euros(x.cobrado.totalCent)}, sin cobrar ${euros(x.sinCobrar.totalCent)} (${x.pct})`}
                      onClick={() => setAbierta({ titulo: `Sin cobrar de ${x.nombre}`, fuente: `Cobrado por GoCardless: ${euros(x.cobrado.totalCent)} · sin cobrar: ${x.pct}`, cifra: euros(x.sinCobrar.totalCent), lista: x.sinCobrar, ir: { texto: 'Ir a Clientes', ruta: rutaClientesCuotas() } })}
                      style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', gap: 2, border: 0, background: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}>
                      <span style={{ fontSize: 12, color: '#b45309', fontWeight: 700, textAlign: 'center' }}>{x.pct}</span>
                      <span style={{ display: 'block', background: '#e8833a', borderRadius: '4px 4px 0 0', height: Math.round((x.sinCobrar.totalCent / tope) * 150) }} />
                      <span style={{ display: 'block', background: C.azul, borderRadius: '0 0 4px 4px', height: Math.round((x.cobrado.totalCent / tope) * 150) }} />
                    </button>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 14, marginTop: 6 }}>
                  {g.map((x) => <span key={x.mes} style={{ textAlign: 'center', fontSize: 12, ...(x.mes === actual ? { fontWeight: 700, color: C.tinta } : { color: C.suave }) }}>{x.nombre}</span>)}
                </div>
                <p style={{ margin: '12px 0 0', fontSize: 12, color: C.suave, lineHeight: 1.45 }}>Sin cobrar: lo que GoCardless no cobró y el banco tampoco (cruzado con sus transferencias), por el mes de cada recibo. Pulsa un mes para ver quién.</p>
              </section>
            )
          })()}
          </div>

          {nc && (() => {
            const d = dondeSeEscapa(nc)
            const FONDO = { bien: ['#e9f6ef', '#1f7a4d', '#24543b'], mal: ['#fdecec', '#a12a2a', '#5b3030'], neutro: ['#eef1f5', C.tinta, '#3d4a5a'] } as const
            return (
              <section aria-labelledby="x35-escapa" style={{ background: '#fff', border: `1px solid ${C.borde}`, borderRadius: 16, padding: '20px 22px' }} data-testid="x35-escapa">
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
                  <h2 id="x35-escapa" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Dónde se te escapa el dinero</h2>
                  <Link to={rutaClientesCuotas()} style={{ fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>Ver los impagados ›</Link>
                </div>
                <p style={{ margin: '4px 0 14px', fontSize: 13, color: C.suave }}>{d.frase}</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
                  {d.tarjetas.map((t) => (
                    <button key={t.id} type="button" data-testid={`x35-escapa-${t.id}`} onClick={() => setAbierta({ titulo: t.titulo, fuente: t.texto, cifra: t.cifra, lista: t.lista, ir: null })}
                      style={{ background: FONDO[t.tono][0], borderRadius: 14, padding: '16px 18px', border: 0, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', color: C.tinta }}>
                      <span style={{ display: 'block', fontSize: 30, fontWeight: 800, color: FONDO[t.tono][1], letterSpacing: '-.5px' }}>{t.cifra}</span>
                      <span style={{ display: 'block', margin: '2px 0 0', fontSize: 14, fontWeight: 700 }}>{t.titulo}</span>
                      <span style={{ display: 'block', margin: '6px 0 0', fontSize: 13, color: FONDO[t.tono][2], lineHeight: 1.4 }}>{t.texto}</span>
                    </button>
                  ))}
                </div>
                {d.nota && <p style={{ margin: '12px 0 0', fontSize: 12, color: C.suave }}>{d.nota}</p>}
              </section>
            )
          })()}


          {(m.faltan.length > 0 || fallos.length > 0) && (
            <section aria-label="Lo que no sale" style={{ fontSize: 13, color: C.suave, lineHeight: 1.5 }} data-testid="x35-faltan">
              {[...fallos, ...m.faltan].map((f) => <p key={f} style={{ margin: '0 0 4px' }}>{f}</p>)}
            </section>
          )}
        </>)}
      </div>

      {abierta && (
        <Dialogo titulo={abierta.titulo} alCerrar={() => setAbierta(null)} cerrable sinBotonPorDefecto>
          <p style={{ margin: '0 0 10px', fontSize: 14, color: C.suave }}>{abierta.fuente}</p>
          <div style={{ maxHeight: '55vh', overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }} aria-label={abierta.lista.titulo}>
              <thead><tr><th style={{ textAlign: 'left', padding: '6px 4px' }}>Quién</th><th style={{ textAlign: 'left', padding: '6px 4px' }}>Qué</th><th style={{ textAlign: 'right', padding: '6px 4px' }}>Importe</th></tr></thead>
              <tbody>
                {abierta.lista.filas.map((f) => (
                  <tr key={f.id} style={{ borderTop: `1px solid ${C.linea}` }}>
                    <td style={{ padding: '6px 4px' }}>{f.texto}</td><td style={{ padding: '6px 4px', color: C.suave }}>{f.detalle}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', whiteSpace: 'nowrap' }}>{euros(f.importeCent)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr style={{ borderTop: `2px solid ${C.tinta}` }}>
                <th scope="row" colSpan={2} style={{ textAlign: 'left', padding: '8px 4px' }}>{abierta.lista.filas.length} {abierta.lista.filas.length === 1 ? 'fila' : 'filas'} · suman</th>
                <td style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }} data-testid="x35-lista-suma">{euros(abierta.lista.totalCent)}</td>
              </tr></tfoot>
            </table>
          </div>
          {abierta.ir && <p style={{ margin: '12px 0 0' }}><Link className="cx-enlace" to={abierta.ir.ruta}>{abierta.ir.texto} ›</Link></p>}
        </Dialogo>
      )}
    </div>
  )
}
