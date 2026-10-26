// src/modules/conta/lib/sepa.ts
//
// PC01 · Entrega 2 · El fichero de la remesa de transferencias para el banco:
// SEPA Credit Transfer, ISO 20022 pain.001.001.03 (el que piden los bancos
// españoles para pagos a proveedores). Sin React y sin red: recibe los datos
// (conta_remesa_fichero_datos) y devuelve el XML. Lo valida contra el esquema
// OFICIAL una unitaria (tests/fixtures/sepa/pain.001.001.03.xsd).
//
// En pantalla esto se llama «el fichero para el banco»: nada de «pain.001»,
// «XML» ni «SEPA» (palabras de la calle, encargo PC01). Los nombres técnicos
// viven aquí y en el fichero.
//
// Reglas del EPC que no mira el esquema y sí mira el banco:
//   · solo el juego de caracteres latino básico (a-z A-Z 0-9 / - ? : ( ) . , ' +
//     y espacio): los acentos se quitan, la ñ pasa a n y lo demás a espacio;
//   · un identificador no empieza ni acaba en «/» ni lleva «//»;
//   · importes con punto y dos decimales, en euros.
//
// El identificador del mensaje (MsgId) es el de la REMESA, siempre el mismo:
// si el fichero se sube dos veces, el banco rechaza el segundo por repetido y
// no se paga dos veces.

export interface OrdenanteSepa { nombre: string; nif: string | null; iban: string; bic: string | null }
export interface PagoSepa { id: string; importe: number; iban: string; bic: string | null; nombre: string; factura: string | null; fechaFactura: string | null }
export interface DatosRemesaSepa {
  codigo: string
  /** YYYY-MM-DD: el día que el banco hace las transferencias. */
  fechaPago: string
  /** Cuándo se crea el fichero (ISO). */
  creado: string
  ordenante: OrdenanteSepa
  pagos: readonly PagoSepa[]
  /** Sufijo del NIF que da el banco al ordenante (Cuaderno 34). Por defecto «000». */
  sufijo?: string
}

const PERMITIDOS = /[^A-Za-z0-9/\-?:().,'+ ]/g

/** Al juego de caracteres SEPA: sin acentos, ñ → n, lo demás a espacio, sin espacios de más. */
export function textoSepa(s: string, max: number): string {
  const limpio = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ñ/g, 'n').replace(/Ñ/g, 'N').replace(/&/g, 'Y').replace(/º/g, 'o').replace(/ª/g, 'a')
    .replace(PERMITIDOS, ' ').replace(/\s+/g, ' ').trim()
  return limpio.slice(0, max).trim()
}

/** Un identificador SEPA: sin espacios, sin «//», sin «/» al principio o al final, hasta 35. */
export function idSepa(s: string): string {
  const x = textoSepa(s, 70).replace(/ /g, '-').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '')
  return x.slice(0, 35).replace(/\/+$/, '')
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
export function importeSepa(n: number): string {
  if (!Number.isFinite(n)) throw new Error('Un importe del fichero no es un número.')
  // eslint-disable-next-line no-restricted-syntax -- número ya comprobado: el formato del fichero es punto y dos decimales, no el de pantalla
  return (Math.round(n * 100) / 100).toFixed(2)
}
const iban = (s: string) => s.replace(/\s/g, '').toUpperCase()

/** El agente (banco): con su BIC si se sabe; si no, «NOTPROVIDED» (EPC, solo IBAN, desde 2016). */
function agente(bic: string | null, sangria: string): string {
  const b = bic?.replace(/\s/g, '').toUpperCase()
  return b && /^[A-Z]{6}[A-Z2-9][A-NP-Z0-9]([A-Z0-9]{3})?$/.test(b)
    ? `${sangria}<FinInstnId><BIC>${b}</BIC></FinInstnId>`
    : `${sangria}<FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>`
}

/** Fecha y hora sin milisegundos ni zona (ISODateTime del esquema). */
const fechaHora = (iso: string) => new Date(iso).toISOString().slice(0, 19)

/** El XML del fichero. Los pagos, en el orden en que vienen. */
export function ficheroTransferencias(d: DatosRemesaSepa): string {
  if (d.pagos.length === 0) throw new Error('La remesa no tiene pagos.')
  const total = d.pagos.reduce((t, p) => t + Math.round(p.importe * 100), 0) / 100
  const msg = idSepa(`SUMIED-${d.codigo}`)
  const nombre = textoSepa(d.ordenante.nombre, 70)
  const idOrdenante = d.ordenante.nif ? textoSepa(`${d.ordenante.nif}${d.sufijo ?? '000'}`, 35).replace(/ /g, '') : null
  const txs = d.pagos.map((p, i) => {
    const concepto = textoSepa([p.factura ? `Factura ${p.factura}` : 'Pago', p.fechaFactura ? `de ${p.fechaFactura.split('-').reverse().join('/')}` : ''].join(' '), 140)
    return [
      '      <CdtTrfTxInf>',
      `        <PmtId><EndToEndId>${xml(idSepa(`${d.codigo}-${i + 1}`))}</EndToEndId></PmtId>`,
      `        <Amt><InstdAmt Ccy="EUR">${importeSepa(p.importe)}</InstdAmt></Amt>`,
      ...(p.bic ? ['        <CdtrAgt>', agente(p.bic, '          '), '        </CdtrAgt>'] : []),
      `        <Cdtr><Nm>${xml(textoSepa(p.nombre, 70))}</Nm></Cdtr>`,
      `        <CdtrAcct><Id><IBAN>${iban(p.iban)}</IBAN></Id></CdtrAcct>`,
      `        <RmtInf><Ustrd>${xml(concepto)}</Ustrd></RmtInf>`,
      '      </CdtTrfTxInf>',
    ].join('\n')
  })
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '  <CstmrCdtTrfInitn>',
    '    <GrpHdr>',
    `      <MsgId>${xml(msg)}</MsgId>`,
    `      <CreDtTm>${fechaHora(d.creado)}</CreDtTm>`,
    `      <NbOfTxs>${d.pagos.length}</NbOfTxs>`,
    `      <CtrlSum>${importeSepa(total)}</CtrlSum>`,
    `      <InitgPty><Nm>${xml(nombre)}</Nm>${idOrdenante ? `<Id><OrgId><Othr><Id>${xml(idOrdenante)}</Id></Othr></OrgId></Id>` : ''}</InitgPty>`,
    '    </GrpHdr>',
    '    <PmtInf>',
    `      <PmtInfId>${xml(idSepa(`${d.codigo}-PAGOS`))}</PmtInfId>`,
    '      <PmtMtd>TRF</PmtMtd>',
    '      <BtchBookg>true</BtchBookg>',
    `      <NbOfTxs>${d.pagos.length}</NbOfTxs>`,
    `      <CtrlSum>${importeSepa(total)}</CtrlSum>`,
    '      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>',
    `      <ReqdExctnDt>${d.fechaPago}</ReqdExctnDt>`,
    `      <Dbtr><Nm>${xml(nombre)}</Nm></Dbtr>`,
    `      <DbtrAcct><Id><IBAN>${iban(d.ordenante.iban)}</IBAN></Id></DbtrAcct>`,
    '      <DbtrAgt>', agente(d.ordenante.bic, '        '), '      </DbtrAgt>',
    '      <ChrgBr>SLEV</ChrgBr>',
    ...txs,
    '    </PmtInf>',
    '  </CstmrCdtTrfInitn>',
    '</Document>',
    '',
  ].join('\n')
}

/** El nombre del fichero que se descarga: «remesa-R-2026-014.xml». */
export const nombreFicheroRemesa = (codigo: string) => `remesa-${codigo.replace(/\//g, '-')}.xml`

// ── PC01 · Entrega 3 · El fichero de la remesa de RECIBOS (cobros) ──────────
// SEPA Direct Debit CORE, ISO 20022 pain.008.001.02 (el de los bancos
// españoles para cobrar recibos domiciliados). Igual que el de pagos: sin React
// y sin red, y lo valida contra el esquema OFICIAL una unitaria
// (tests/fixtures/sepa/pain.008.001.02.xsd). En pantalla, «el fichero para el
// banco».
//
//   · Cada recibo lleva su MANDATO (referencia y fecha de firma): sin mandato
//     firmado no hay recibo (lo frena la base antes de llegar aquí).
//   · El primer cobro con un mandato va como «primero» (FRST) y los demás como
//     «recurrente» (RCUR): cada tipo en su bloque (PmtInf), como piden los bancos.
//   · El acreedor se identifica con su IDENTIFICADOR SEPA (AT-02): ES, dos
//     dígitos de control, el sufijo que da el banco (por defecto «000») y el NIF.

export interface AcreedorSepa { nombre: string; nif: string; iban: string; bic: string | null; sufijo?: string | null }
export interface ReciboSepa {
  id: string
  importe: number
  /** Del cliente que paga. */
  iban: string
  bic: string | null
  nombre: string
  mandato: string
  /** YYYY-MM-DD: cuándo firmó el mandato. */
  firmado: string
  primero: boolean
  factura: string | null
  fechaFactura: string | null
}
export interface DatosRemesaRecibos {
  codigo: string
  /** YYYY-MM-DD: el día que se carga a los clientes. */
  fechaCargo: string
  creado: string
  acreedor: AcreedorSepa
  recibos: readonly ReciboSepa[]
}

/** Las letras a números (A=10 … Z=35), como en el IBAN. */
const aNumeros = (s: string) => s.toUpperCase().replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))
function mod97(n: string): number {
  let r = 0
  for (let i = 0; i < n.length; i += 7) r = Number(String(r) + n.slice(i, i + 7)) % 97
  return r
}

/**
 * El identificador de acreedor SEPA de una empresa española (AT-02, norma de la
 * AEB): «ES» + 2 dígitos de control + sufijo (3) + NIF. Los dígitos de control
 * salen del NIF y de «ES00» (sin el sufijo), módulo 97, como en el IBAN.
 * Es la misma regla en toda Europa: el identificador de pruebas del Bundesbank,
 * DE98ZZZ09999999999, la cumple (lo comprueba la unitaria).
 */
export function identificadorAcreedor(nif: string, sufijo: string | null = '000'): string {
  const n = nif.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^ES(?=[A-Z0-9]{9}$)/, '')
  if (!/^[A-Z0-9]{9}$/.test(n)) throw new Error('El NIF de la empresa no tiene la forma de un NIF: no se puede sacar su identificador de acreedor.')
  const suf = (sufijo ?? '').trim() || '000'
  if (!/^[A-Z0-9]{3}$/i.test(suf)) throw new Error('El sufijo del banco tiene que ser de tres letras o cifras.')
  const cc = String(98 - mod97(aNumeros(`${n}ES00`))).padStart(2, '0')
  return `ES${cc}${suf.toUpperCase()}${n}`
}

/**
 * ¿Es un identificador de acreedor SEPA bien formado? País, dos dígitos de
 * control (de 02 a 98, ISO 7064), tres del sufijo y el identificador nacional;
 * el control sale del identificador nacional y del país, sin el sufijo.
 */
export function acreedorValido(id: string): boolean {
  const m = /^([A-Z]{2})(\d{2})([A-Z0-9]{3})([A-Z0-9]{1,28})$/.exec(id.toUpperCase().replace(/\s/g, ''))
  if (!m || Number(m[2]) < 2 || Number(m[2]) > 98) return false
  if (m[1] === 'ES' && m[4].length !== 9) return false
  return mod97(aNumeros(`${m[4]}${m[1]}${m[2]}`)) === 1
}

/** El XML del fichero de recibos. Los recibos, en el orden en que vienen, separados en «primeros» y «recurrentes». */
export function ficheroRecibos(d: DatosRemesaRecibos): string {
  if (d.recibos.length === 0) throw new Error('La remesa no tiene recibos.')
  const acreedor = identificadorAcreedor(d.acreedor.nif, d.acreedor.sufijo ?? '000')
  const centimos = (xs: readonly ReciboSepa[]) => xs.reduce((t, r) => t + Math.round(r.importe * 100), 0) / 100
  const nombre = textoSepa(d.acreedor.nombre, 70)
  const grupos = ([['FRST', d.recibos.filter((r) => r.primero)], ['RCUR', d.recibos.filter((r) => !r.primero)]] as const).filter(([, xs]) => xs.length > 0)
  let n = 0
  const bloques = grupos.map(([tipo, xs]) => {
    const txs = xs.map((r) => {
      n += 1
      const concepto = textoSepa([r.factura ? `Factura ${r.factura}` : 'Recibo', r.fechaFactura ? `de ${r.fechaFactura.split('-').reverse().join('/')}` : ''].join(' '), 140)
      return [
        '      <DrctDbtTxInf>',
        `        <PmtId><EndToEndId>${xml(idSepa(`${d.codigo}-${n}`))}</EndToEndId></PmtId>`,
        `        <InstdAmt Ccy="EUR">${importeSepa(r.importe)}</InstdAmt>`,
        `        <DrctDbtTx><MndtRltdInf><MndtId>${xml(idSepa(r.mandato))}</MndtId><DtOfSgntr>${r.firmado}</DtOfSgntr></MndtRltdInf></DrctDbtTx>`,
        '        <DbtrAgt>', agente(r.bic, '          '), '        </DbtrAgt>',
        `        <Dbtr><Nm>${xml(textoSepa(r.nombre, 70))}</Nm></Dbtr>`,
        `        <DbtrAcct><Id><IBAN>${iban(r.iban)}</IBAN></Id></DbtrAcct>`,
        `        <RmtInf><Ustrd>${xml(concepto)}</Ustrd></RmtInf>`,
        '      </DrctDbtTxInf>',
      ].join('\n')
    })
    return [
      '    <PmtInf>',
      `      <PmtInfId>${xml(idSepa(`${d.codigo}-${tipo}`))}</PmtInfId>`,
      '      <PmtMtd>DD</PmtMtd>',
      '      <BtchBookg>true</BtchBookg>',
      `      <NbOfTxs>${xs.length}</NbOfTxs>`,
      `      <CtrlSum>${importeSepa(centimos(xs))}</CtrlSum>`,
      `      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl><LclInstrm><Cd>CORE</Cd></LclInstrm><SeqTp>${tipo}</SeqTp></PmtTpInf>`,
      `      <ReqdColltnDt>${d.fechaCargo}</ReqdColltnDt>`,
      `      <Cdtr><Nm>${xml(nombre)}</Nm></Cdtr>`,
      `      <CdtrAcct><Id><IBAN>${iban(d.acreedor.iban)}</IBAN></Id></CdtrAcct>`,
      '      <CdtrAgt>', agente(d.acreedor.bic, '        '), '      </CdtrAgt>',
      '      <ChrgBr>SLEV</ChrgBr>',
      `      <CdtrSchmeId><Id><PrvtId><Othr><Id>${acreedor}</Id><SchmeNm><Prtry>SEPA</Prtry></SchmeNm></Othr></PrvtId></Id></CdtrSchmeId>`,
      ...txs,
      '    </PmtInf>',
    ].join('\n')
  })
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '  <CstmrDrctDbtInitn>',
    '    <GrpHdr>',
    `      <MsgId>${xml(idSepa(`SUMIED-${d.codigo}`))}</MsgId>`,
    `      <CreDtTm>${fechaHora(d.creado)}</CreDtTm>`,
    `      <NbOfTxs>${d.recibos.length}</NbOfTxs>`,
    `      <CtrlSum>${importeSepa(centimos(d.recibos))}</CtrlSum>`,
    `      <InitgPty><Nm>${xml(nombre)}</Nm><Id><OrgId><Othr><Id>${acreedor}</Id></Othr></OrgId></Id></InitgPty>`,
    '    </GrpHdr>',
    ...bloques,
    '  </CstmrDrctDbtInitn>',
    '</Document>',
    '',
  ].join('\n')
}

/** El nombre del fichero de recibos que se descarga: «recibos-C-2026-009.xml». */
export const nombreFicheroRecibos = (codigo: string) => `recibos-${codigo.replace(/\//g, '-')}.xml`
