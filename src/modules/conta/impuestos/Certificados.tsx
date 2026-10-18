// src/modules/conta/impuestos/Certificados.tsx
//
// I01b · P4 · Impuestos › Certificados y accesos (tablero 10, maqueta
// «Certificados.png»):
//   · «Quién presenta los impuestos de esta empresa»: la propia empresa, con
//     su certificado (la ficha, si funciona, quién puede presentar y quién
//     solo ver, «Permisos»), o «Mi asesoría, con su certificado» («Invitar a
//     mi asesoría», la pieza 4b: la invitación vincula; si la asesoría aún no
//     tiene Sumied, su alta la da la plataforma).
//   · «Cada vez que se ha usado»: cuándo, quién, qué y el resultado.
//   · A la derecha, «Cómo guardamos tu certificado» con el texto de custodia
//     de su almacén (con el Vault NO dice «nadie puede verlo»), «Probar con
//     Hacienda» y «Quitar el certificado ahora».
//   · «+ Añadir un certificado» (la cinta): el .p12 y su contraseña van a
//     conta-certificado, que lo abre en memoria; no se guardan. Fuera de la
//     cuenta de Foodint se para antes con el mismo motivo que la base.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { rutaImpuestos } from '@/config/navegacion'
import { Boton, Campo, Chip, Dialogo, Selector, Tarjeta, Texto } from '@/modules/conta/diseno'
import { useEntradasEnCinta } from '@/modules/conta/marco/nuevo/contexto'
import { diaMesCorto } from '@/modules/conta/lib/formato'
import {
  asesoria, cancelarInvitacion, certificadoPresenta, enlaceJustificante, invitacionDeEmpresa, leerCertificados, permisoCertificado, probarCertificado,
  quitarCertificado, retirarAsesoria, subirCertificado, type InvitacionViva,
} from '@/modules/conta/services/impuestosService'
import { chipsCertificado, lineaAsesoria, lineaCertificado, resultadoUso, textoUso, type Certificado, type CertificadosVer } from './certificados'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function Certificados({ companyId }: { companyId: string }) {
  const [datos, setDatos] = useState<CertificadosVer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const [hecho, setHecho] = useState<{ tono: 'ok' | 'falta'; texto: string } | null>(null)
  const [busqueda, setBusqueda] = useSearchParams()
  const [permisos, setPermisos] = useState<Certificado | null>(null)
  const recargar = useCallback(() => setVuelta((v) => v + 1), [])
  const subir = busqueda.get('subir') === '1'
  const cerrarSubir = () => { const b = new URLSearchParams(busqueda); b.delete('subir'); setBusqueda(b, { replace: true }) }

  useEffect(() => {
    let vivo = true
    leerCertificados(companyId).then((d) => { if (vivo) { setDatos(d); setError(null) } }, (e: unknown) => { if (vivo) setError(msg(e)) })
    return () => { vivo = false }
  }, [companyId, vuelta])

  const esAdmin = datos?.es_admin ?? false
  useEntradasEnCinta(useMemo(() => (esAdmin ? {
    certificados: [{ id: 'impuestos.subir-certificado', etiqueta: '+ Añadir un certificado', a: `${rutaImpuestos('certificados')}?subir=1` }],
  } : null), [esAdmin]))

  const hacer = async (f: () => Promise<string>) => {
    setHecho(null)
    try { setHecho({ tono: 'ok', texto: await f() }) } catch (e) { setHecho({ tono: 'falta', texto: msg(e) }) }
    recargar()
  }

  const activo = datos?.certificados.find((c) => c.presenta && c.estado === 'active')
    ?? datos?.certificados.find((c) => c.estado === 'active') ?? null
  return (
    <div className="s-pantalla s-impuestos">
      <h1 className="cx-oculto">Impuestos · Certificados y accesos</h1>
      {hecho && <p className={hecho.tono === 'ok' ? 's-impuestos-hecho' : 's-impuestos-fallo'} role={hecho.tono === 'ok' ? 'status' : 'alert'}>{hecho.texto}</p>}
      {error && (
        <Tarjeta titulo="No se han podido leer los certificados" tono="falta" accion={<Boton onClick={recargar}>Volver a intentar</Boton>}>
          <p className="s-apoyo">{error}</p>
        </Tarjeta>
      )}
      {!error && !datos && <Tarjeta titulo="Leyendo los certificados…"><p className="s-apoyo">Un momento.</p></Tarjeta>}
      {!error && datos && (
        <div className="s-impuestos-columnas">
          <div className="s-impuestos-principal">
            <QuienPresenta d={datos} companyId={companyId} hacer={hacer} alPermisos={setPermisos} alSubir={() => setBusqueda({ subir: '1' })} />
            <Usos d={datos} hacer={hacer} />
          </div>
          <aside className="s-impuestos-lado">
            <Custodia d={datos} activo={activo} hacer={hacer} />
          </aside>
        </div>
      )}
      {subir && datos && <DialogoSubir d={datos} companyId={companyId} alCerrar={cerrarSubir} hacer={hacer} />}
      {permisos && datos && <DialogoPermisos c={permisos} d={datos} alCerrar={() => setPermisos(null)} hacer={hacer} />}
    </div>
  )
}

type Hacer = (f: () => Promise<string>) => Promise<void>

function QuienPresenta({ d, companyId, hacer, alPermisos, alSubir }: {
  d: CertificadosVer; companyId: string; hacer: Hacer; alPermisos: (c: Certificado) => void; alSubir: () => void
}) {
  const vivos = d.certificados.filter((c) => c.estado === 'active')
  const empresa = d.presentador.modo === 'company' || !!d.presentador.retirada_el
  return (
    <Tarjeta compacta titulo="Quién presenta los impuestos de esta empresa" apoyo="Elige uno. Se puede cambiar en cualquier momento.">
      <div className="s-impuestos-opciones" role="radiogroup" aria-label="Quién presenta">
        <div className="s-impuestos-opcion" data-elegida={empresa ? 'si' : undefined}>
          <span className="s-impuestos-radio" role="radio" aria-checked={empresa} aria-label="La propia empresa, con su certificado" />
          <div className="s-impuestos-opcion-cuerpo">
            <div className="s-impuestos-opcion-cabeza">
              <strong>La propia empresa, con su certificado</strong>
              {d.es_admin && vivos[0] && <Boton variante="enlace" onClick={() => alPermisos(vivos.find((c) => c.presenta) ?? vivos[0])}>Permisos</Boton>}
            </div>
            {vivos.length === 0 && (
              <p className="s-apoyo">
                Aún no hay ningún certificado.{' '}
                {d.es_admin && (d.puede_subir ? <Boton variante="enlace" onClick={alSubir}>Añadir un certificado</Boton> : <span>{d.por_que_no_subir}</span>)}
              </p>
            )}
            {vivos.map((c) => (
              <div key={c.id} className="s-impuestos-certificado">
                <span className="s-apoyo">{lineaCertificado(c)}</span>
                <span className="s-impuestos-chips">{chipsCertificado(c).map((x) => <Chip key={x.texto} tono={x.tono}>{x.texto}</Chip>)}</span>
                {d.es_admin && !c.presenta && (
                  <Boton variante="enlace" onClick={() => hacer(async () => (await certificadoPresenta(companyId, c.id)).mensaje)}>Presentar con este</Boton>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="s-impuestos-opcion" data-elegida={!empresa ? 'si' : undefined}>
          <span className="s-impuestos-radio" role="radio" aria-checked={!empresa} aria-label="Mi asesoría, con su certificado" />
          <div className="s-impuestos-opcion-cuerpo">
            <div className="s-impuestos-opcion-cabeza">
              <strong>Mi asesoría, con su certificado</strong>
              {d.es_admin && <AccionAsesoria d={d} companyId={companyId} hacer={hacer} />}
            </div>
            <p className="s-apoyo">{lineaAsesoria(d.presentador)}</p>
            <InvitacionEnCurso companyId={companyId} hacer={hacer} esAdmin={d.es_admin} />
          </div>
        </div>
      </div>
    </Tarjeta>
  )
}

function Usos({ d, hacer }: { d: CertificadosVer; hacer: Hacer }) {
  return (
    <Tarjeta compacta titulo="Cada vez que se ha usado">
      {d.usos.length === 0
        ? <p className="s-apoyo s-impuestos-vacio">Aún no se ha usado ningún certificado de esta cuenta.</p>
        : (
          <table className="s-tabla s-impuestos-tabla">
            <thead><tr><th scope="col">Cuándo</th><th scope="col">Quién</th><th scope="col">Qué</th><th scope="col">Resultado</th></tr></thead>
            <tbody>
              {d.usos.map((u, i) => {
                const r = resultadoUso(u)
                return (
                  <tr key={`${u.cuando}-${i}`}>
                    <td data-titulo="Cuándo">{diaMesCorto(u.cuando)} · {new Date(u.cuando).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })}</td>
                    <td data-titulo="Quién">{u.quien ?? '—'}</td>
                    <td data-titulo="Qué">{textoUso(u)}</td>
                    <td data-titulo="Resultado">
                      {r.justificante
                        ? <Boton variante="enlace" onClick={async () => { try { window.open(await enlaceJustificante(r.justificante!), '_blank', 'noopener') } catch (e) { void hacer(() => Promise.reject(e)) } }}>Justificante ↗</Boton>
                        : <span className={r.tono === 'ok' ? 's-impuestos-ok' : r.tono === 'falta' ? 's-impuestos-fallo' : 's-apoyo'}>{r.texto}</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
    </Tarjeta>
  )
}

function Custodia({ d, activo, hacer }: { d: CertificadosVer; activo: Certificado | null; hacer: Hacer }) {
  const [quitar, setQuitar] = useState(false)
  return (
    <section className="s-tarjeta s-impuestos-custodia" aria-labelledby="custodia-titulo">
      <h2 id="custodia-titulo" className="s-tarjeta-titulo">Cómo guardamos tu certificado</h2>
      <p>Lo subes una vez, con su contraseña. La contraseña y el fichero no se guardan. Después:</p>
      <p>{activo?.custodia ?? d.certificados[0]?.custodia ?? 'Queda cifrado y solo lo usa el servidor de Sumied para presentar, cuando una persona con permiso lo confirma. Nadie puede descargarlo desde la aplicación, y cada uso queda apuntado.'}</p>
      <p>Solo se usa cuando alguien con permiso pulsa «Presentar», y pide confirmación.</p>
      <p>Cada uso queda apuntado aquí, con quién y qué.</p>
      <p>Te avisamos 30 y 7 días antes de que caduque.</p>
      {activo && d.es_admin && (
        <>
          <Boton ancho onClick={() => hacer(async () => {
            const s = await probarCertificado(activo.id)
            if (!s.ok) throw new Error(s.mensaje)
            return s.mensaje
          })}>Probar con Hacienda</Boton>
          <Boton ancho onClick={() => setQuitar(true)}>Quitar el certificado ahora</Boton>
          <p className="s-impuestos-custodia-nota">Se borra al instante. Hasta que subas otro, los impuestos se pueden descargar y presentar fuera.</p>
        </>
      )}
      {quitar && activo && (
        <Dialogo titulo="¿Quitar el certificado ahora?" alCerrar={() => setQuitar(false)}
          explicacion={`Se borra del almacén al instante y nadie podrá usarlo para presentar. ${lineaCertificado(activo)}. El registro de usos se queda.`}
          acciones={<><Boton onClick={() => setQuitar(false)}>Cancelar</Boton><Boton variante="principal" onClick={() => { setQuitar(false); void hacer(() => quitarCertificado(activo.id)) }}>Sí, quitarlo</Boton></>} />
      )}
    </section>
  )
}

function DialogoSubir({ d, companyId, alCerrar, hacer }: { d: CertificadosVer; companyId: string; alCerrar: () => void; hacer: Hacer }) {
  const [fichero, setFichero] = useState<File | null>(null)
  const [contrasena, setContrasena] = useState('')
  if (!d.puede_subir) {
    return (
      <Dialogo titulo="Añadir un certificado" alCerrar={alCerrar} acciones={<Boton onClick={alCerrar}>Entendido</Boton>}
        explicacion={d.por_que_no_subir ?? 'No se puede subir un certificado desde aquí.'} />
    )
  }
  const enviar = () => hacer(async () => {
    alCerrar()
    const r = await subirCertificado(d.cuenta, fichero!, contrasena)
    setContrasena('')
    if (!r.ok) throw new Error(r.mensaje)
    // Si la empresa aún no presenta con ninguno, con éste.
    if (r.id && !d.certificados.some((c) => c.presenta && c.estado === 'active')) {
      const p = await certificadoPresenta(companyId, r.id)
      return `${r.mensaje} ${p.mensaje}`
    }
    return r.mensaje
  })
  return (
    <Dialogo titulo="Añadir un certificado" alCerrar={alCerrar}
      explicacion="El certificado de la empresa (o de su representante), en .p12 o .pfx, con su contraseña. Se abre en el servidor y se guarda cifrado; la contraseña y el fichero no se guardan."
      acciones={<><Boton onClick={alCerrar}>Cancelar</Boton><Boton variante="principal" disabled={!fichero || !contrasena} onClick={enviar}>Guardar</Boton></>}>
      <Campo etiqueta="El certificado (.p12 o .pfx)">
        {(p) => <input {...p} className="s-control" type="file" accept=".p12,.pfx,application/x-pkcs12" onChange={(e) => setFichero(e.target.files?.[0] ?? null)} />}
      </Campo>
      <Campo etiqueta="Su contraseña">
        {(p) => <input {...p} className="s-control" type="password" autoComplete="off" value={contrasena} onChange={(e) => setContrasena(e.target.value)} />}
      </Campo>
    </Dialogo>
  )
}

function DialogoPermisos({ c, d, alCerrar, hacer }: { c: Certificado; d: CertificadosVer; alCerrar: () => void; hacer: Hacer }) {
  const valor = (persona: string) => c.permisos.find((p) => p.persona === persona)?.permiso ?? 'ninguno'
  const opciones = [{ valor: 'file', texto: 'Puede presentar' }, { valor: 'view', texto: 'Solo ver' }, { valor: 'ninguno', texto: 'Nada' }]
  return (
    <Dialogo titulo="Permisos del certificado" alCerrar={alCerrar} acciones={<Boton onClick={alCerrar}>Cerrar</Boton>}
      explicacion={`${lineaCertificado(c)}. Los administradores de la cuenta siempre pueden presentar.`}>
      {d.personas.filter((p) => p.papel !== 'admin').length === 0 && <p className="s-apoyo">En la cuenta solo hay administradores.</p>}
      {d.personas.filter((p) => p.papel !== 'admin').map((p) => (
        <Campo key={p.id} etiqueta={p.nombre}>
          {(x) => <Selector {...x} valor={valor(p.id)} opciones={opciones} alCambiar={(v) => {
            alCerrar()
            void hacer(async () => `${p.nombre}: ${await permisoCertificado(c.id, p.id, v === 'ninguno' ? null : (v as 'file' | 'view'))}`)
          }} />}
        </Campo>
      ))}
    </Dialogo>
  )
}

// ── P4b · Invitar a mi asesoría ─────────────────────────────────────────────

/** El enlace de la derecha: «Invitar a mi asesoría», o «Retirar el permiso» si ya presenta ella. */
function AccionAsesoria({ d, companyId, hacer }: { d: CertificadosVer; companyId: string; hacer: Hacer }) {
  const [invitar, setInvitar] = useState(false)
  const vinculada = d.presentador.modo === 'advisor' && !d.presentador.retirada_el
  return (
    <>
      {vinculada
        ? <Boton variante="enlace" onClick={() => void hacer(() => retirarAsesoria(companyId))}>Retirar el permiso</Boton>
        : <Boton variante="enlace" onClick={() => setInvitar(true)}>Invitar a mi asesoría</Boton>}
      {invitar && <DialogoInvitar companyId={companyId} alCerrar={() => setInvitar(false)} hacer={hacer} />}
    </>
  )
}

/** La invitación viva: a quién, hasta cuándo, y volver a mandarla o cancelarla. */
function InvitacionEnCurso({ companyId, hacer, esAdmin }: { companyId: string; hacer: Hacer; esAdmin: boolean }) {
  const [inv, setInv] = useState<InvitacionViva | null>(null)
  const [vuelta, setVuelta] = useState(0)
  useEffect(() => {
    let vivo = true
    invitacionDeEmpresa(companyId).then((x) => { if (vivo) setInv(x) }, () => { if (vivo) setInv(null) })
    return () => { vivo = false }
  }, [companyId, vuelta])
  if (!inv) return null
  const hacerY = (f: () => Promise<string>) => hacer(f).then(() => setVuelta((v) => v + 1))
  return (
    <div className="s-impuestos-invitacion" role="status">
      <Chip tono={inv.estado === 'pending' ? 'duda' : 'accion'}>
        {inv.estado === 'pending' ? `Invitación mandada a ${inv.correo} · caduca el ${diaMesCorto(inv.expira)}` : `${inv.asesoria} aceptó · espera que Sumied dé de alta su cuenta`}
      </Chip>
      {esAdmin && inv.estado === 'pending' && (
        <Boton variante="enlace" onClick={() => void hacerY(async () => {
          const r = await asesoria('invitar', { empresa: companyId, correo: inv.correo, nombre: inv.asesoria, base: inv.base })
          if (!r.ok) throw new Error(r.mensaje)
          return `${r.mensaje}${r.enlace && !r.enviado ? ` ${String(r.enlace)}` : ''}`
        })}>Volver a mandarla</Boton>
      )}
      {esAdmin && <Boton variante="enlace" onClick={() => void hacerY(() => cancelarInvitacion(inv.id))}>Cancelar la invitación</Boton>}
    </div>
  )
}

function DialogoInvitar({ companyId, alCerrar, hacer }: { companyId: string; alCerrar: () => void; hacer: Hacer }) {
  const [correo, setCorreo] = useState('')
  const [nombre, setNombre] = useState('')
  const [base, setBase] = useState<'social_collaborator' | 'power_of_attorney'>('social_collaborator')
  const valido = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo.trim()) && nombre.trim().length >= 2
  const enviar = () => hacer(async () => {
    alCerrar()
    const r = await asesoria('invitar', { empresa: companyId, correo: correo.trim(), nombre: nombre.trim(), base })
    if (!r.ok) throw new Error(r.mensaje)
    return `${r.mensaje}${r.enlace && !r.enviado ? ` ${String(r.enlace)}` : ''}`
  })
  return (
    <Dialogo titulo="Invitar a mi asesoría" alCerrar={alCerrar}
      explicacion="Le llega un correo con un enlace (caduca a los 7 días). Al aceptar, verá y gestionará los impuestos de esta empresa con tu permiso, que queda apuntado con tu nombre. Lo puedes retirar cuando quieras. Si aún no usa Sumied, Sumied le da de alta antes."
      acciones={<><Boton onClick={alCerrar}>Cancelar</Boton><Boton variante="principal" disabled={!valido} onClick={enviar}>Mandar la invitación</Boton></>}>
      <Campo etiqueta="Nombre de la asesoría">{(p) => <Texto {...p} valor={nombre} alCambiar={setNombre} placeholder="Ej.: Asesoría Gómez" />}</Campo>
      <Campo etiqueta="Su correo">{(p) => <Texto {...p} valor={correo} alCambiar={setCorreo} type="email" autoComplete="off" />}</Campo>
      <Campo etiqueta="Cómo presenta ante Hacienda">
        {(p) => <Selector {...p} valor={base} alCambiar={(v) => setBase(v as typeof base)}
          opciones={[{ valor: 'social_collaborator', texto: 'Como colaboradora social' }, { valor: 'power_of_attorney', texto: 'Con un poder de la empresa en Hacienda' }]} />}
      </Campo>
    </Dialogo>
  )
}
