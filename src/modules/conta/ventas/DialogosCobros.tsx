// src/modules/conta/ventas/DialogosCobros.tsx
//
// PC01 · Entregas 3 y 4 · Los diálogos de Ventas › Cobros:
//   · «Enviarle el mandato para firmar»: prepara el mandato del cliente (su
//     referencia y un enlace de un solo uso que vale 30 días) y, si hay correo,
//     LO MANDA SUMIED (E4: ya no se abre el correo de quien lo prepara), con
//     el nombre y la marca de la empresa. El enlace también se puede copiar.
//   · «Recordatorios»: qué días se mandan, los próximos y los últimos, los
//     clientes con los recordatorios apagados (y apagarlos), y una prueba a tu
//     correo (DialogoRecordatorios).
// Cada uno dice lo que ha pasado con la frase que escribe la base o la función
// (regla 8), o el fallo, dentro del diálogo.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Boton, Campo, Dialogo, Selector, Texto } from '@/modules/conta/diseno'
import { textoDias, type FilaCobro } from '@/modules/conta/lib/cobros'
import { rutaAjustes } from '@/config/navegacion'
import { supabase } from '@/lib/supabase'
import {
  enviarMandato, prepararMandato, probarRecordatorio, recordatoriosCliente,
  type Recordatorios, type SinMandato,
} from '@/modules/conta/services/cobrosService'

const correoValido = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim())
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

export function DialogoMandato({ empresaId, cliente, alCerrar }: {
  empresaId: string
  cliente: SinMandato
  alCerrar: (frase: string | null) => void
}) {
  const [correo, setCorreo] = useState(cliente.correo ?? '')
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [hecho, setHecho] = useState<{ frase: string; enviado: boolean; enlace: string } | null>(null)
  const [copiado, setCopiado] = useState(false)

  const preparar = async () => {
    const para = correo.trim()
    if (para && !correoValido(para)) { setError('Ese correo no vale: revísalo.'); return }
    setOcupado(true); setError(null)
    try {
      const r = await prepararMandato(empresaId, cliente.id, para || null)
      const enlace = `${window.location.origin}${r.enlace}`
      if (!para) { setHecho({ frase: `${r.frase} Copia el enlace y mándaselo.`, enviado: false, enlace }); return }
      const e = await enviarMandato(r.mandato, para)
      setHecho({ frase: `${r.frase} ${e.texto}`, enviado: e.enviado, enlace })
    } catch (e) { setError((e as Error).message) } finally { setOcupado(false) }
  }

  const copiar = async () => {
    if (!hecho) return
    try { await navigator.clipboard.writeText(hecho.enlace); setCopiado(true) } catch { setError('No se ha podido copiar: selecciona el enlace y cópialo a mano.') }
  }

  return (
    <Dialogo titulo={`Mandato de ${cliente.nombre}`} alCerrar={() => alCerrar(hecho?.frase ?? null)}
      explicacion={`${cliente.nombre} paga por domiciliación y no tiene mandato firmado. Le preparo uno y se lo mando desde Sumied, con el nombre de tu empresa: lo firma desde el móvil, sin cuenta, con su nombre y su IBAN. Al firmar, su ficha de Contactos queda con el IBAN y el mandato.`}
      acciones={hecho
        ? <Boton variante="principal" onClick={() => alCerrar(hecho.frase)}>Hecho</Boton>
        : <>
          <Boton onClick={() => alCerrar(null)}>Cancelar</Boton>
          <Boton variante="principal" onClick={() => void preparar()} disabled={ocupado}>{ocupado ? 'Preparando…' : correo.trim() ? 'Preparar y mandar' : 'Preparar el enlace'}</Boton>
        </>}>
      {!hecho && (
        <div className="pg-dialogo-campos">
          <Campo etiqueta="Su correo" ayuda={cliente.correo ? 'El de sus últimas facturas. Puedes cambiarlo.' : 'Si lo dejas vacío, te doy el enlace para que se lo mandes como quieras.'}>{(c) => (
            <Texto {...c} type="email" valor={correo} alCambiar={(x) => { setCorreo(x); setError(null) }} autoComplete="off" placeholder="administracion@cliente.es" />
          )}</Campo>
        </div>
      )}
      {hecho && (
        <div className="pg-dialogo-campos" data-prueba="mandato-preparado">
          <p className="s-aviso-lista" data-tono={hecho.enviado || !correo.trim() ? 'seguro' : 'duda'} role="status">{hecho.frase}</p>
          <Campo etiqueta="El enlace para firmar">{(c) => <Texto {...c} valor={hecho.enlace} alCambiar={() => undefined} readOnly />}</Campo>
          <span className="pg-aviso-acciones">
            <button type="button" className="pg-enlace" onClick={() => void copiar()}>{copiado ? 'Copiado' : 'Copiar el enlace'}</button>
          </span>
        </div>
      )}
      {error && <p className="s-aviso-lista" data-tono="falta" role="alert">{error}</p>}
    </Dialogo>
  )
}

const MOTIVO_NO_SALIO: Record<string, string> = {
  cerrado: 'los recordatorios aún están cerrados',
  sin_correo: 'el cliente no tiene correo',
  proveedor: 'el correo lo rechazó',
  configuracion: 'el correo no está configurado',
}

/** «Recordatorios»: lo que se manda, lo que ha salido, los clientes apagados y una prueba. */
export function DialogoRecordatorios({ empresaId, datos, filas, alCerrar, alCambiar }: {
  empresaId: string
  datos: Recordatorios
  /** Las facturas por cobrar de la lista (para el nombre del cliente y la prueba). */
  filas: readonly FilaCobro[]
  alCerrar: (frase: string | null) => void
  alCambiar: () => void
}) {
  const [aviso, setAviso] = useState<{ tono: 'seguro' | 'falta' | 'duda'; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const conRecordatorio = filas.filter((f) => { const r = datos.facturas.get(f.id); return r && (r.sin === null || r.sin === 'cliente') })
  const [facturaPrueba, setFacturaPrueba] = useState(conRecordatorio[0]?.id ?? '')
  const [paraPrueba, setParaPrueba] = useState('')
  // La prueba va, de entrada, a tu correo (el de la sesión).
  useEffect(() => {
    let vivo = true
    void supabase?.auth.getUser().then(({ data }) => { if (vivo && data.user?.email) setParaPrueba((x) => x || data.user!.email!) })
    return () => { vivo = false }
  }, [])
  // Los clientes con algo por cobrar que llevaría recordatorio, para apagarlos (los ya apagados, arriba).
  const apagados = new Set(datos.clientesApagados.map((c) => c.id))
  const clientes = [...new Map(conRecordatorio.filter((f) => f.clienteId && !apagados.has(f.clienteId)).map((f) => [f.clienteId!, f.cliente])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], 'es'))

  const cliente = async (id: string, nombre: string, apagar: boolean) => {
    setOcupado(id); setAviso(null)
    try { const r = await recordatoriosCliente(empresaId, id, apagar); setAviso({ tono: 'seguro', texto: r.frase }); alCambiar() }
    catch (e) { setAviso({ tono: 'falta', texto: `No se ha cambiado ${nombre}: ${(e as Error).message}` }) }
    finally { setOcupado(null) }
  }
  const prueba = async () => {
    if (!facturaPrueba) { setAviso({ tono: 'falta', texto: 'Elige una factura para la prueba.' }); return }
    if (!correoValido(paraPrueba)) { setAviso({ tono: 'falta', texto: 'Ese correo no vale: revísalo.' }); return }
    setOcupado('prueba'); setAviso(null)
    const r = await probarRecordatorio(facturaPrueba, paraPrueba.trim())
    setAviso({ tono: r.enviado ? 'seguro' : 'duda', texto: r.texto }); setOcupado(null)
  }

  return (
    <Dialogo titulo="Recordatorios" alCerrar={() => alCerrar(null)}
      explicacion={datos.activos
        ? `Se mandan solos, ${textoDias(datos.dias)}, a las facturas por cobrar que no se cobran por remesa ni por una plataforma. Salen con el nombre de tu empresa y su factura en PDF, y se paran solos cuando cobras.`
        : 'Los recordatorios están apagados: no se manda ninguno.'}
      acciones={<Boton variante="principal" onClick={() => alCerrar(null)}>Hecho</Boton>}>
      <div className="pg-dialogo-campos" data-prueba="recordatorios">
        <p className="pg-dialogo-nota">
          <Link className="pg-enlace" to={rutaAjustes('cobros')}>Cambiar los días o apagarlos en Ajustes › Cobros</Link>
        </p>

        <h3 className="pg-dialogo-titulo">Los últimos</h3>
        {datos.ultimos.length === 0
          ? <p className="s-lista-vacia">Aún no ha salido ninguno.</p>
          : <ul className="pg-lista-simple">
            {datos.ultimos.slice(0, 8).map((u) => (
              <li key={`${u.facturaId}:${u.dia}`}>
                <strong>{u.cliente}</strong> · {u.factura} · {ddmm(u.at.slice(0, 10))} · {u.enviado ? `mandado a ${u.para}` : `no salió: ${MOTIVO_NO_SALIO[u.motivo ?? ''] ?? u.motivo}`}
              </li>
            ))}
          </ul>}

        <h3 className="pg-dialogo-titulo">Clientes sin recordatorios</h3>
        {datos.clientesApagados.length === 0
          ? <p className="s-lista-vacia">A todos se les mandan.</p>
          : <ul className="pg-lista-simple">
            {datos.clientesApagados.map((c) => (
              <li key={c.id}>
                <strong>{c.nombre}</strong>{c.por ? ` · apagados por ${c.por}` : ''}{' '}
                <button type="button" className="pg-enlace" disabled={ocupado !== null} onClick={() => void cliente(c.id, c.nombre, false)}>Volver a mandarle</button>
              </li>
            ))}
          </ul>}
        {clientes.length > 0 && (
          <Campo etiqueta="Apagar los de un cliente">{(c) => (
            <Selector {...c} valor="" alCambiar={(id) => { const n = clientes.find(([x]) => x === id); if (n) void cliente(n[0], n[1], true) }}
              opciones={[{ valor: '', texto: 'Elige un cliente' }, ...clientes.map(([id, nombre]) => ({ valor: id, texto: nombre }))]} />
          )}</Campo>
        )}

        <h3 className="pg-dialogo-titulo">Mandarte una prueba</h3>
        {conRecordatorio.length === 0
          ? <p className="s-lista-vacia">Ninguna factura por cobrar lleva recordatorio: no hay con qué hacer la prueba.</p>
          : <>
            <Campo etiqueta="Con la factura">{(c) => (
              <Selector {...c} valor={facturaPrueba} alCambiar={setFacturaPrueba}
                opciones={conRecordatorio.map((f) => ({ valor: f.id, texto: `${f.numero ?? 'Sin número'} · ${f.cliente}` }))} />
            )}</Campo>
            <Campo etiqueta="A este correo" ayuda="Te llega como le llegaría al cliente, con «[Prueba]» en el asunto. No cuenta como recordatorio.">{(c) => (
              <Texto {...c} type="email" valor={paraPrueba} alCambiar={setParaPrueba} autoComplete="email" placeholder="tu@correo.es" />
            )}</Campo>
            <span className="pg-aviso-acciones">
              <Boton onClick={() => void prueba()} disabled={ocupado !== null}>{ocupado === 'prueba' ? 'Mandando…' : 'Mandar la prueba'}</Boton>
            </span>
          </>}
        {aviso && <p className="s-aviso-lista" data-tono={aviso.tono} role={aviso.tono === 'falta' ? 'alert' : 'status'}>{aviso.texto}</p>}
      </div>
    </Dialogo>
  )
}
