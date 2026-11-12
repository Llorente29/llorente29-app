// src/modules/conta/gestoria/CobrosGestoria.tsx
//
// G01 · Tarea 4 · Ajustes › Cobros, lo de la gestoría (solo en una cuenta de
// asesoría):
//   · por cada empresa emisora, la tarjeta «Domiciliación con GoCardless»: si
//     está conectada, la última lectura, los mandatos activos, la forma de
//     cobro por defecto de sus clientes, «Leer ahora» y el interruptor
//     «Reintentos inteligentes» (apagado de serie; puede tener coste según el
//     plan de GoCardless; en este encargo solo se guarda). Sin conectar: pegar
//     una vez el token de solo lectura (GoCardless › Developers › Create ›
//     Access token, de solo lectura).
//   · la tarjeta «Bitrix24 · tus clientes» (uno para toda la cuenta): pegar una
//     vez la dirección que da Bitrix24 y «Leer ahora»; y, conectado, «Qué es cada
//     campo» (G01b): el mapa que una persona confirma.
// Cada botón dice lo que ha hecho, con su contenido (regla 8): «Conectada la
// cuenta de GoCardless de QBO INTEGRITY S.L.: 208 mandatos activos y …».

import { useState } from 'react'
import { Boton, Campo, Selector, Tarjeta, Texto } from '@/modules/conta/diseno'
import type { ConexionBitrix, ConexionGc } from '@/modules/conta/services/gestoriaService'
import type { MapaBitrix } from './queEsCadaCampo'
import { CamposDeBitrix } from './CamposDeBitrix'
import { UnionDeFichas } from './UnionDeFichas'
import { AlInstante } from '@/modules/conta/avisos/AlInstante'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import type { DatosEnsayo } from './pdfUnion'
import type { MapaContactos } from '../../../../supabase/functions/conta-bitrix-leer/contactosClientes'

const fechaHora = (iso: string | null) => {
  if (!iso) return null
  const d = new Date(iso)
  return `${d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', timeZone: 'Europe/Madrid' })} a las ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })}`
}
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const miles = (n: number) => n.toLocaleString('es-ES')

export interface AccionesGestoria {
  conectarGc: (emisor: string, entorno: 'real' | 'pruebas', token: string) => Promise<string>
  leerGc: (emisor: string) => Promise<string>
  reintentos: (emisor: string, encendido: boolean) => Promise<string>
  conectarBitrix: (entorno: 'real' | 'pruebas', url: string) => Promise<string>
  leerBitrix: () => Promise<string>
  /** G01b · Confirmar el mapa en «Qué es cada campo» y leer de nuevo. */
  confirmarMapa: (mapa: MapaBitrix) => Promise<string>
  /** G01b · El ensayo de la unión (los datos del PDF) y aplicarla y leer. */
  ensayoUnion: () => Promise<DatosEnsayo>
  aplicarUnion: () => Promise<string>
  /** G01c · Confirmar el mapa de contactos y leer (llega con la base de los contactos). */
  confirmarMapaContactos?: (mapa: MapaContactos) => Promise<string>
}

export function Interruptor({ encendido, alCambiar, etiqueta, descrito, disabled }: {
  encendido: boolean; alCambiar: (v: boolean) => void; etiqueta: string; descrito?: string; disabled?: boolean
}) {
  return (
    <button type="button" role="switch" aria-checked={encendido} aria-label={etiqueta} aria-describedby={descrito} disabled={disabled}
      className="cxg-interruptor" data-on={encendido || undefined} onClick={() => alCambiar(!encendido)}>
      <span className="cxg-interruptor-bola" aria-hidden="true" />
    </button>
  )
}

function Aviso({ a }: { a: { ok: boolean; texto: string } | null }) {
  if (!a) return null
  return <p className="s-aviso-lista" data-tono={a.ok ? 'seguro' : 'falta'} role={a.ok ? 'status' : 'alert'}>{a.texto}</p>
}

function Estado({ conectada, entorno }: { conectada: boolean; entorno: 'real' | 'pruebas' }) {
  return conectada
    ? <span className="cxg-estado" data-tono="verde">Conectada{entorno === 'pruebas' ? ' · de pruebas' : ''}</span>
    : <span className="cxg-estado" data-tono="gris">Sin conectar</span>
}

function ConectarGc({ emisor, nombre, alConectar }: { emisor: string; nombre: string; alConectar: AccionesGestoria['conectarGc'] }) {
  // GD · Una cuenta de demostración solo lee los sistemas de pruebas: el entorno sale ya en «pruebas».
  const { esDemo } = useCuentaConta()
  const [elegido, setEntorno] = useState<'real' | 'pruebas' | null>(null)
  const entorno: 'real' | 'pruebas' = elegido ?? (esDemo ? 'pruebas' : 'real')
  const [token, setToken] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const ir = async () => {
    setOcupado(true); setAviso(null)
    try { setAviso({ ok: true, texto: await alConectar(emisor, entorno, token) }); setToken('') }
    catch (e) { setAviso({ ok: false, texto: msg(e) }) } finally { setOcupado(false) }
  }
  return (
    <div className="pg-dialogo-campos">
      <p className="cxg-apoyo">Pega una vez la clave de acceso de la cuenta de GoCardless de {nombre}. Se saca en <strong>GoCardless › Developers › Create › Access token, de solo lectura</strong>. Sumied solo lee: no cobra ni cambia nada en GoCardless.</p>
      <div className="cxg-fila-campos">
        <Campo etiqueta="Cuenta">{(c) => (
          <Selector {...c} valor={entorno} alCambiar={(v) => setEntorno(v === 'pruebas' ? 'pruebas' : 'real')}
            opciones={[{ valor: 'real', texto: 'La de verdad' }, { valor: 'pruebas', texto: 'La de pruebas' }]} />
        )}</Campo>
        <Campo etiqueta="Clave de acceso (de solo lectura)">{(c) => (
          <Texto {...c} valor={token} alCambiar={setToken} autoComplete="off" spellCheck={false} placeholder="live_…" />
        )}</Campo>
      </div>
      <div><Boton variante="principal" onClick={() => void ir()} disabled={ocupado || token.trim().length < 10}>{ocupado ? 'Conectando y leyendo…' : 'Conectar y leer'}</Boton></div>
      <Aviso a={aviso} />
    </div>
  )
}

export function TarjetaGocardless({ emisor, nombre, c, acciones }: { emisor: string; nombre: string; c: ConexionGc | null; acciones: AccionesGestoria }) {
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const [reintentos, setReintentos] = useState<boolean | null>(null)
  const hacer = async (f: () => Promise<string>) => {
    setOcupado(true); setAviso(null)
    try { setAviso({ ok: true, texto: await f() }) } catch (e) { setAviso({ ok: false, texto: msg(e) }) } finally { setOcupado(false) }
  }
  const conectada = !!c?.conectada
  const encendido = reintentos ?? c?.reintentos ?? false
  const idAviso = `reintentos-aviso-${emisor}`
  return (
    <Tarjeta titulo={`Domiciliación con GoCardless · ${nombre}`}
      apoyo="Los recibos domiciliados de tus clientes que cobra GoCardless. Sumied los lee cada noche y los compara con tus tarifas."
      accion={<Estado conectada={conectada} entorno={c?.entorno ?? 'real'} />}>
      {!conectada ? <ConectarGc emisor={emisor} nombre={nombre} alConectar={acciones.conectarGc} /> : (
        <div className="pg-dialogo-campos">
          <dl className="cxg-datos">
            <div><dt>Última lectura</dt><dd>{fechaHora(c!.ultimaLectura) ?? 'Aún ninguna'}</dd></div>
            <div><dt>Mandatos activos</dt><dd className="cxg-cifra">{c!.mandatosVivos == null ? '—' : miles(c!.mandatosVivos)}</dd></div>
            <div><dt>Líneas leídas</dt><dd className="cxg-cifra">{c!.lineasActivas == null ? '—' : miles(c!.lineasActivas)}</dd></div>
            <div><dt>Forma de cobro por defecto de tus clientes</dt><dd>{c!.porDefecto ? 'Domiciliación (GoCardless)' : 'La que tenga cada cliente'}</dd></div>
          </dl>
          {c!.abono.coincide === false && <p className="cxg-nota" data-tono="ambar">{c!.abono.porque ?? 'GoCardless abona en una cuenta que no es de esta empresa.'}</p>}
          {c!.conectadaPor && <p className="cxg-apoyo">Conectada por {c!.conectadaPor}{c!.conectadaAt ? ` el ${fechaHora(c!.conectadaAt)}` : ''}.</p>}

          <div className="cxg-interruptor-fila">
            <div>
              <strong>Reintentos inteligentes</strong>
              <p id={idAviso} className="cxg-apoyo">GoCardless vuelve a pasar un recibo devuelto el día que más probable es que se cobre. <strong>Puede tener coste: depende de tu plan de GoCardless.</strong> De momento solo se guarda: Sumied todavía no cobra nada.</p>
            </div>
            <Interruptor encendido={encendido} etiqueta="Reintentos inteligentes" descrito={idAviso} disabled={ocupado}
              alCambiar={(v) => void hacer(async () => { const f = await acciones.reintentos(emisor, v); setReintentos(v); return f })} />
          </div>
          <div><Boton onClick={() => void hacer(() => acciones.leerGc(emisor))} disabled={ocupado}>{ocupado ? 'Leyendo…' : 'Leer ahora'}</Boton></div>
          <AlInstante origen="gocardless" empresa={emisor} nombre={`GoCardless de ${nombre}`} entorno={c?.entorno} />
        </div>
      )}
      <Aviso a={aviso} />
    </Tarjeta>
  )
}

export function TarjetaBitrix({ c, acciones }: { c: ConexionBitrix | null; acciones: AccionesGestoria }) {
  // GD · Una cuenta de demostración solo lee los sistemas de pruebas: el entorno sale ya en «pruebas».
  const { esDemo } = useCuentaConta()
  const [elegido, setEntorno] = useState<'real' | 'pruebas' | null>(null)
  const entorno: 'real' | 'pruebas' = elegido ?? (esDemo ? 'pruebas' : 'real')
  const [url, setUrl] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const hacer = async (f: () => Promise<string>) => {
    setOcupado(true); setAviso(null)
    try { setAviso({ ok: true, texto: await f() }); setUrl('') } catch (e) { setAviso({ ok: false, texto: msg(e) }) } finally { setOcupado(false) }
  }
  const conectada = !!c?.conectada
  return (
    <Tarjeta titulo={`Tu CRM · ${c?.nombre ?? 'Bitrix24'}`}
      apoyo="La ficha de cada cliente: quién es, si está activo, qué servicios tiene y con qué empresa se le factura. Uno para todas tus empresas."
      accion={<Estado conectada={conectada} entorno={c?.entorno ?? 'real'} />}>
      {conectada ? (
        <div className="pg-dialogo-campos">
          <dl className="cxg-datos">
            <div><dt>Portal</dt><dd>{c!.portal ?? '—'}</dd></div>
            <div><dt>Última lectura</dt><dd>{fechaHora(c!.ultimaLectura) ?? 'Aún ninguna'}</dd></div>
            <div><dt>Clientes leídos</dt><dd className="cxg-cifra">{c!.empresasLeidas == null ? '—' : miles(c!.empresasLeidas)}</dd></div>
          </dl>
          <div><Boton onClick={() => void hacer(acciones.leerBitrix)} disabled={ocupado}>{ocupado ? 'Leyendo…' : 'Leer ahora'}</Boton></div>
          <AlInstante origen="crm" crm={c!.crm} nombre={c!.nombre} />
          <CamposDeBitrix empresas={{ mapa: c!.mapa, medidos: c!.medidos, alConfirmar: acciones.confirmarMapa }}
            contactos={{ mapa: c!.contactos?.mapa ?? null, medidos: c!.contactos?.medidos ?? null, resumen: c!.contactos?.resumen ?? null, leidos: c!.contactos?.leidos ?? null,
              alConfirmar: acciones.confirmarMapaContactos ?? (async () => { throw new Error('Confirmar el mapa de contactos aún no está publicado en este entorno.') }) }} />
          <UnionDeFichas mapa={c!.mapa} alEnsayar={acciones.ensayoUnion} alAplicar={acciones.aplicarUnion} />
        </div>
      ) : (
        <div className="pg-dialogo-campos">
          <p className="cxg-apoyo">Pega una vez la dirección de acceso que da Bitrix24 en <strong>Aplicaciones › Webhooks › Webhook entrante</strong> (así lo llama Bitrix24), con permiso para el CRM. Es como <span className="cxg-mono">https://tu-portal.bitrix24.es/rest/1/…/</span>. Sumied solo lee las fichas.</p>
          <div className="cxg-fila-campos">
            <Campo etiqueta="Portal">{(x) => (
              <Selector {...x} valor={entorno} alCambiar={(v) => setEntorno(v === 'pruebas' ? 'pruebas' : 'real')}
                opciones={[{ valor: 'real', texto: 'El de verdad' }, { valor: 'pruebas', texto: 'El de pruebas' }]} />
            )}</Campo>
            <Campo etiqueta="Dirección de acceso">{(x) => (
              <Texto {...x} valor={url} alCambiar={setUrl} autoComplete="off" spellCheck={false} placeholder="https://tu-portal.bitrix24.es/rest/…" />
            )}</Campo>
          </div>
          <div><Boton variante="principal" onClick={() => void hacer(() => acciones.conectarBitrix(entorno, url))} disabled={ocupado || !/^https:\/\//.test(url.trim())}>{ocupado ? 'Conectando y leyendo…' : 'Conectar y leer'}</Boton></div>
        </div>
      )}
      <Aviso a={aviso} />
    </Tarjeta>
  )
}

/** Todo junto: una tarjeta de GoCardless por emisor y la de Bitrix24. */
export function CobrosGestoria({ emisores, gocardless, bitrix, acciones }: {
  emisores: { id: string; nombre: string }[]; gocardless: ConexionGc[]; bitrix: ConexionBitrix | null; acciones: AccionesGestoria
}) {
  return (
    <div className="pg-dialogo-campos" data-prueba="ajustes-cobros-gestoria">
      {emisores.map((e) => <TarjetaGocardless key={e.id} emisor={e.id} nombre={e.nombre} c={gocardless.find((g) => g.emisorId === e.id) ?? null} acciones={acciones} />)}
      <TarjetaBitrix c={bitrix} acciones={acciones} />
    </div>
  )
}
