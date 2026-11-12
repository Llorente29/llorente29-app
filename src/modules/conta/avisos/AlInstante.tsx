// src/modules/conta/avisos/AlInstante.tsx
//
// G01d · El bloque «Al instante» de cada tarjeta de conexión en Ajustes ›
// Cobros (el CRM, y GoCardless de cada empresa). Va dentro de la tarjeta, con
// una línea en gestoria/CobrosGestoria.tsx; todo lo demás vive aquí.
//
//   · El estado en palabras: «Apagado», «Esperando el primer aviso» o
//     «Funciona: último aviso hace 2 min»; y, encendido sin avisos en 24 h,
//     «No llegan avisos desde ayer. Mira que siga dado de alta en Bitrix24».
//   · «Cómo activarlo»: los pasos para el administrador, la dirección de
//     Sumied con «Copiar» y el campo para pegar el código o el secreto (va a
//     Vault y no se vuelve a enseñar).
//   · Encender o apagar, y «Probar»: dice el resultado en una frase (regla 8).
// Toques de 44 px o más (los botones y el interruptor de diseño ya lo son).

import { useCallback, useEffect, useState } from 'react'
import { Boton, Campo, Texto } from '@/modules/conta/diseno'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { configurarAlInstante, leerAlInstante, probarAlInstante, type Conexion } from '@/modules/conta/services/avisosService'
import { direccionDelAviso, estadoAlInstante, pasosParaActivar, type DatosAlInstante } from './alInstante'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const BASE = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''

export function AlInstante(p: ({ origen: 'crm'; crm: string; nombre: string } | { origen: 'gocardless'; empresa: string; nombre: string }) & { entorno?: 'real' | 'pruebas' }) {
  const { accountId } = useCuentaConta()
  const conexion: Conexion | null = !accountId ? null : p.origen === 'crm'
    ? { origen: 'crm', cuenta: accountId, crm: p.crm } : { origen: 'gocardless', cuenta: accountId, empresa: p.empresa }
  const clave = conexion ? JSON.stringify(conexion) : ''
  const [d, setD] = useState<DatosAlInstante | null>(null)
  // El «ahora» de la última lectura: el estado («hace 2 min») se calcula contra él, no en cada pintado.
  const [ahora, setAhora] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [abierto, setAbierto] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const [copiado, setCopiado] = useState(false)

  const recargar = useCallback(() => {
    if (!conexion) return
    leerAlInstante(conexion).then((x) => { setD(x); setAhora(Date.now()); setError(null) }).catch((e) => setError(msg(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])
  useEffect(() => { recargar() }, [recargar])

  if (!conexion) return null
  const nombreCorto = p.origen === 'crm' ? p.nombre : 'GoCardless'
  const estado = d ? estadoAlInstante(d, nombreCorto, ahora) : null
  const direccion = direccionDelAviso(BASE, p.origen === 'crm' ? { origen: 'crm', cuenta: accountId!, crm: p.crm } : { origen: 'gocardless', empresa: p.empresa })
  const idEstado = `al-instante-${p.origen === 'crm' ? p.crm : p.empresa}`
  const que = p.origen === 'crm' ? 'código de seguridad' : 'secreto'

  const hacer = async (f: () => Promise<{ ok: boolean; texto: string }>) => {
    setOcupado(true); setAviso(null)
    try { setAviso(await f()) } catch (e) { setAviso({ ok: false, texto: msg(e) }) } finally { setOcupado(false); recargar() }
  }
  const copiar = async () => {
    try { await navigator.clipboard.writeText(direccion); setCopiado(true); setTimeout(() => setCopiado(false), 3000) }
    catch { setAviso({ ok: false, texto: 'No se ha podido copiar: selecciona la dirección y cópiala a mano.' }) }
  }

  return (
    <section className="cxg-interruptor-fila" aria-labelledby={idEstado} data-al-instante={p.origen} style={{ flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', width: '100%' }}>
        <div>
          <strong id={idEstado}>Al instante</strong>
          <p className="cxg-apoyo">Cuando algo cambia en {p.nombre}, Sumied lo sabe en segundos. La lectura de cada noche sigue.</p>
          {error ? <p className="cxg-nota" role="alert">{error}</p>
            : estado && <p className="cxg-apoyo" data-tono={estado.tono} data-prueba="al-instante-estado" role="status"
                style={estado.tono === 'falta' ? { color: 'var(--cx-ambar)', fontWeight: 600 } : estado.tono === 'bien' ? { color: 'var(--cx-verde-oscuro)' } : undefined}>{estado.frase}</p>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <Boton onClick={() => setAbierto((x) => !x)} disabled={ocupado}>{abierto ? 'Cerrar los pasos' : 'Cómo activarlo'}</Boton>
          {d?.tieneCodigo && (
            <Boton onClick={() => void hacer(async () => ({ ok: true, texto: await configurarAlInstante(conexion, { encender: !d.encendido }) }))} disabled={ocupado}>
              {d.encendido ? 'Apagar' : 'Encender'}
            </Boton>
          )}
          {d?.encendido && (
            <Boton onClick={() => void hacer(async () => { const r = await probarAlInstante(conexion); return { ok: r.ok, texto: r.frase } })} disabled={ocupado}>
              {ocupado ? 'Probando…' : 'Probar'}
            </Boton>
          )}
        </div>
      </div>

      {abierto && (
        <div className="pg-dialogo-campos" data-prueba="al-instante-pasos" style={{ width: '100%' }}>
          <ol className="cxg-apoyo" style={{ paddingLeft: 20, margin: 0, display: 'grid', gap: 6 }}>
            {pasosParaActivar(p.origen, nombreCorto, p.entorno === 'pruebas').map((t) => <li key={t}>{t}</li>)}
          </ol>
          <div className="cxg-fila-campos" style={{ alignItems: 'flex-end' }}>
            <Campo etiqueta="La dirección de Sumied">{(x) => <Texto {...x} valor={direccion} alCambiar={() => undefined} readOnly spellCheck={false} />}</Campo>
            <div><Boton onClick={() => void copiar()}>{copiado ? 'Copiada' : 'Copiar'}</Boton></div>
          </div>
          <div className="cxg-fila-campos" style={{ alignItems: 'flex-end' }}>
            <Campo etiqueta={`El ${que} de ${nombreCorto}`} ayuda={d?.tieneCodigo ? `Ya hay uno guardado: pegar otro lo sustituye. No se vuelve a enseñar.` : 'Se guarda cifrado y no se vuelve a enseñar.'}>
              {(x) => <Texto {...x} valor={codigo} alCambiar={setCodigo} autoComplete="off" spellCheck={false} type="password" />}
            </Campo>
            <div>
              <Boton variante="principal" disabled={ocupado || codigo.trim().length < 16}
                onClick={() => void hacer(async () => { const t = await configurarAlInstante(conexion, { codigo, encender: true }); setCodigo(''); return { ok: true, texto: t } })}>
                Guardar y encender
              </Boton>
            </div>
          </div>
        </div>
      )}
      {aviso && <p className="cxg-apoyo" role={aviso.ok ? 'status' : 'alert'} data-tono={aviso.ok ? 'bien' : 'falta'}
        style={{ color: aviso.ok ? 'var(--cx-verde-oscuro)' : 'var(--cx-rojo)', fontWeight: 600 }}>{aviso.texto}</p>}
    </section>
  )
}
