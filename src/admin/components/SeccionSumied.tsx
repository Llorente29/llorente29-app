// src/admin/components/SeccionSumied.tsx
//
// S01f · La sección «Sumied» de la ficha de la cuenta (administración de la
// plataforma): los tres interruptores, con su estado, desde cuándo, quién y
// por qué. Al tocar uno se abre en la propia fila el cuadro del motivo
// (obligatorio) con «Guardar» y «Cancelar». Apagar «Contabilidad» con datos
// dentro avisa de lo que deja de verse y apaga las tres (Julio, 31/10); nunca
// borra nada. Cada cambio confirma con contenido o enseña el error (regla 8).
// Maqueta: «Sumied · S01f · Interruptores de Sumied por cuenta».

import { useEffect, useState } from 'react'
import { CuadradoMarca } from '@/marca/PiezasMarca'
import { MARCAS } from '@/marca/marca'
import {
  FRASE_BLOQUEADA, NOMBRE_INTERRUPTOR, avisoApagar, bloqueada, fraseConfirmacion, lineaDeEstado,
  type ClaveSumied, type DatosCuenta, type Interruptor,
} from '@/admin/lib/interruptoresSumied'
import { cambiarInterruptor, leerInterruptores } from '@/admin/services/interruptoresSumiedService'

const AZUL = '#2b62c4'
const LINEA = '#dde3ea'
const APOYO = '#4a5a70'

function BotonInterruptor({ encendida, apagado, etiqueta, alPulsar }: { encendida: boolean; apagado: boolean; etiqueta: string; alPulsar: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={encendida} aria-disabled={apagado || undefined} aria-label={etiqueta}
      onClick={() => { if (!apagado) alPulsar() }}
      style={{ width: 52, height: 30, minWidth: 52, border: 0, borderRadius: 999, position: 'relative', cursor: apagado ? 'not-allowed' : 'pointer',
        background: apagado ? '#e3e7ed' : encendida ? AZUL : '#c5ccd6' }}>
      <span aria-hidden="true" style={{ position: 'absolute', top: 3, width: 24, height: 24, borderRadius: 999, background: '#fff', left: encendida ? 25 : 3, transition: 'left .15s' }} />
    </button>
  )
}

export default function SeccionSumied({ accountId, cuenta }: { accountId: string; cuenta: string }) {
  const [lista, setLista] = useState<Interruptor[] | null>(null)
  const [datos, setDatos] = useState<DatosCuenta | null>(null)
  const [errorLeer, setErrorLeer] = useState<string | null>(null)
  const [abierta, setAbierta] = useState<{ clave: ClaveSumied; encender: boolean } | null>(null)
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hecho, setHecho] = useState<string | null>(null)

  const [lectura, setLectura] = useState(0)
  useEffect(() => {
    let viva = true
    leerInterruptores(accountId)
      .then((r) => { if (viva) { setLista(r.interruptores); setDatos(r.datos); setErrorLeer(null) } })
      .catch((e: unknown) => { if (viva) setErrorLeer(e instanceof Error ? e.message : String(e)) })
    return () => { viva = false }
  }, [accountId, lectura])

  const abrir = (i: Interruptor) => { setAbierta({ clave: i.clave, encender: !i.encendida }); setMotivo(''); setError(null); setHecho(null) }
  const cerrar = () => { setAbierta(null); setMotivo(''); setError(null) }
  const guardar = async () => {
    if (!abierta || !motivo.trim()) return
    setGuardando(true); setError(null)
    try {
      const r = await cambiarInterruptor(accountId, abierta.clave, abierta.encender, motivo.trim())
      setHecho(fraseConfirmacion(r.cuenta || cuenta, abierta.clave, abierta.encender, r.cambiados))
      setAbierta(null); setMotivo('')
      setLectura((x) => x + 1)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setGuardando(false) }
  }

  return (
    <section className="mb-8" aria-labelledby="sumied-titulo" data-prueba="seccion-sumied">
      {hecho && (
        <div role="status" className="rounded-lg p-3 mb-3" style={{ background: '#E3F0E6', border: '1px solid #A8D0B5' }}>
          <p className="text-sm font-medium" style={{ color: '#1F6B3B' }}>{hecho}</p>
        </div>
      )}
      <div style={{ border: `1px solid ${LINEA}`, borderRadius: 14, background: '#fff', overflow: 'hidden' }}>
        <header style={{ padding: '16px 20px', borderBottom: `1px solid ${LINEA}`, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <CuadradoMarca marca={MARCAS.sumied} lado={26} />
            <h2 id="sumied-titulo" className="text-base font-medium" style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#0f1b2d' }}>Sumied</h2>
          </div>
          <span style={{ fontSize: 15, color: APOYO }}>Lo que esta cuenta tiene de Sumied.</span>
        </header>

        {errorLeer && <p role="alert" style={{ padding: '14px 20px', margin: 0, color: '#A12626', fontSize: 14 }}>{errorLeer}</p>}
        {!lista && !errorLeer && <p style={{ padding: '14px 20px', margin: 0, color: APOYO, fontSize: 14 }}>Cargando…</p>}

        {lista?.map((i, n) => {
          const bloq = bloqueada(i, lista)
          const abiertaAqui = abierta?.clave === i.clave
          const nombre = NOMBRE_INTERRUPTOR[i.clave]
          const aviso = abiertaAqui && i.clave === 'conta' && !abierta.encender && datos ? avisoApagar(cuenta, datos, lista) : null
          const apagarConta = abiertaAqui && i.clave === 'conta' && !abierta.encender
          return (
            <div key={i.clave} data-prueba={`interruptor-${i.clave}`}
              style={{ padding: '14px 20px', borderTop: n ? `1px solid ${LINEA}` : undefined, background: abiertaAqui ? (aviso ? '#fff8ea' : '#f7f9fc') : undefined,
                display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, color: bloq ? '#6b7a8f' : undefined }}>
                  <strong style={{ fontSize: 16, color: bloq ? '#6b7a8f' : '#0f1b2d' }}>{nombre}</strong>
                  <span style={{ fontSize: 14, color: bloq ? '#6b7a8f' : APOYO, lineHeight: 1.45 }}>{bloq ? FRASE_BLOQUEADA : lineaDeEstado(i)}</span>
                </div>
                <BotonInterruptor encendida={abiertaAqui ? abierta.encender : i.encendida} apagado={bloq || guardando} etiqueta={nombre}
                  alPulsar={() => (abiertaAqui ? cerrar() : abrir(i))} />
              </div>
              {abiertaAqui && (
                <>
                  {aviso && (
                    <div data-prueba="aviso-apagar" style={{ border: '1px solid #f0d9a8', borderRadius: 12, background: '#fff', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <strong style={{ fontSize: 15 }}>{aviso.titulo}</strong>
                      <span style={{ fontSize: 15, color: '#23344d', lineHeight: 1.5 }}>{aviso.texto}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label htmlFor={`motivo-${i.clave}`} style={{ fontSize: 14, fontWeight: 600 }}>{`Vas a ${abierta.encender ? 'encender' : 'apagar'} «${nombre}». ¿Por qué?`}</label>
                    <input id={`motivo-${i.clave}`} type="text" value={motivo} autoFocus placeholder="Una línea: queda en la auditoría"
                      onChange={(e) => setMotivo(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void guardar(); if (e.key === 'Escape') cerrar() }}
                      style={{ font: 'inherit', fontSize: 16, padding: '10px 12px', border: '1px solid #cdd6e2', borderRadius: 10, background: '#fff' }} />
                  </div>
                  {error && <p role="alert" style={{ margin: 0, color: '#A12626', fontSize: 14 }}>{error}</p>}
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <button type="button" onClick={cerrar} disabled={guardando}
                      style={{ font: 'inherit', minHeight: 44, padding: '10px 16px', border: '1px solid #cdd6e2', borderRadius: 10, background: '#fff', color: '#0f1b2d' }}>Cancelar</button>
                    <button type="button" onClick={() => void guardar()} disabled={guardando || !motivo.trim()}
                      style={{ font: 'inherit', fontWeight: 600, minHeight: 44, padding: '10px 16px', border: 0, borderRadius: 10, color: '#fff',
                        background: apagarConta ? '#a5432a' : AZUL, opacity: guardando || !motivo.trim() ? 0.55 : 1 }}>
                      {guardando ? 'Guardando…' : apagarConta ? 'Apagar la contabilidad' : 'Guardar'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
