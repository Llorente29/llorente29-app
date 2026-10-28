// supabase/functions/_shared/impuestos/dr190.ts
//
// NO SE TOCA A MANO: lo escribe scripts/conta/s02/dr190.mjs desde
// docs/conta/referencia/dr190.json (y este, del anexo de la Orden EHA/3127/2009 (anexo modificado por la Orden HAC/1431/2025, de 3 de diciembre),
// BOE-A-2025-25390, vigente desde 2025-12-13, en docs/conta/fuentes/textos/orden-modelo-190.txt;
// sha256 del anexo 6d0c53c4060210931311c0023b10455bf44a1ba7b81202faf25dd4b682097b88).

export interface ParteDr190 { desde: number; hasta: number; texto: string }
export interface CampoDr190 { desde: number; hasta: number; lon: number; tipo: string; nombre: string; descripcion: string; partes: ParteDr190[] }
export interface ProvinciaDr190 { codigo: string; nombre: string; fuente: string }

export const DR190 = {
  "boe": "BOE-A-2025-25390",
  "vigenteDesde": "2025-12-13",
  "sha256": "6d0c53c4060210931311c0023b10455bf44a1ba7b81202faf25dd4b682097b88",
  "longitud": 500,
  "registros": {
    "1": [
      {
        "desde": 1,
        "hasta": 1,
        "tipo": "Numérico",
        "nombre": "TIPO DE REGISTRO",
        "descripcion": "Constante número ‘1’.",
        "partes": [],
        "lon": 1
      },
      {
        "desde": 2,
        "hasta": 4,
        "tipo": "Numérico",
        "nombre": "MODELO DECLARACIÓN",
        "descripcion": "Constante ‘190’.",
        "partes": [],
        "lon": 3
      },
      {
        "desde": 5,
        "hasta": 8,
        "tipo": "Numérico",
        "nombre": "EJERCICIO",
        "descripcion": "Las cuatro cifras del ejercicio fiscal al que corresponde la declaración.",
        "partes": [],
        "lon": 4
      },
      {
        "desde": 9,
        "hasta": 17,
        "tipo": "Alfanumérico",
        "nombre": "NIF DEL DECLARANTE",
        "descripcion": "Se consignará el número de identificación fiscal (NIF) del declarante, de acuerdo con las reglas previstas en el Reglamento General de las actuaciones y los procedimientos de gestión e inspección tributaria y de desarrollo de las normas comunes de los procedimientos de aplicación de los tributos, aprobado por el Real Decreto 1065/2007, de 27 de julio («BOE» del 5 de septiembre).\nEste campo deberá estar ajustado a la derecha, siendo la última posición el carácter de control y rellenando con ceros las posiciones de la izquierda.",
        "partes": [],
        "lon": 9
      },
      {
        "desde": 18,
        "hasta": 57,
        "tipo": "Alfanumérico",
        "nombre": "APELLIDOS Y NOMBRE, DENOMINACIÓN O RAZÓN SOCIAL DEL DECLARANTE",
        "descripcion": "Si es una persona física se consignará el primer apellido, un espacio, el segundo apellido, un espacio y el nombre completo, necesariamente en este orden.\nPara personas jurídicas y entidades en régimen de atribución de Rentas, se consignará la razón social completa, sin anagrama.\nEn ningún caso podrá figurar en este campo un nombre comercial.",
        "partes": [],
        "lon": 40
      },
      {
        "desde": 58,
        "hasta": 58,
        "tipo": "Alfabético",
        "nombre": "TIPO DE SOPORTE",
        "descripcion": "Se cumplimentará una de las siguientes claves:\n‘C’: Si la información se presenta en soporte (DVD–R o DVD+R).\n‘T’: Transmisión telemática.",
        "partes": [],
        "lon": 1
      },
      {
        "desde": 59,
        "hasta": 107,
        "tipo": "Alfanumérico",
        "nombre": "PERSONA CON QUIÉN RELACIONARSE",
        "descripcion": "Datos de la persona con quién relacionarse. Este campo se subdivide en dos:",
        "partes": [
          {
            "desde": 59,
            "hasta": 67,
            "texto": "TELÉFONO: Campo numérico de 9 posiciones."
          },
          {
            "desde": 68,
            "hasta": 107,
            "texto": "APELLIDOS Y NOMBRE: Se consignará el primer apellido, un espacio, el segundo apellido, un espacio y el nombre completo, necesariamente en este orden."
          }
        ],
        "lon": 49
      },
      {
        "desde": 108,
        "hasta": 120,
        "tipo": "Numérico",
        "nombre": "NÚMERO IDENTIFICATIVO DE LA DECLARACIÓN",
        "descripcion": "Se consignará el número identificativo correspondiente a la declaración. Campo de contenido numérico de 13 posiciones.",
        "partes": [],
        "lon": 13
      },
      {
        "desde": 121,
        "hasta": 122,
        "tipo": "Alfabético",
        "nombre": "DECLARACIÓN COMPLEMENTARIA O SUSTITUTIVA",
        "descripcion": "En el caso excepcional de segunda o posterior presentación de declaraciones, deberá cumplimentarle obligatoriamente uno de los siguientes campos:\nLa presentación de una declaración complementaria que tenga por objeto la modificación del contenido de datos declarados en otra declaración del mismo ejercicio presentada anteriormente se realizará desde el trámite de «consulta y modificación de declaraciones» del procedimiento del modelo 190, en la Sede electrónica de la Agencia Tributaria (www.agenciatributaria.gob.es).",
        "partes": [
          {
            "desde": 121,
            "hasta": 121,
            "texto": "DECLARACIÓN COMPLEMENTARIA: Se consignará una «C» si la presentación de esta declaración tiene por objeto incluir percepciones que, debiendo haber figurado en otra declaración del mismo ejercicio presentada anteriormente, hubieran sido completamente omitidas en la misma."
          },
          {
            "desde": 122,
            "hasta": 122,
            "texto": "DECLARACIÓN SUSTITUTIVA: Se consignará una «S» si la presentación tiene como objeto anular y sustituir completamente a otra declaración anterior, del mismo ejercicio. Una declaración sustitutiva solo puede anular a una única declaración anterior."
          }
        ],
        "lon": 2
      },
      {
        "desde": 123,
        "hasta": 135,
        "tipo": "Numérico",
        "nombre": "NÚMERO IDENTIFICATIVO DE LA DECLARACIÓN ANTERIOR",
        "descripcion": "En caso de que se haya consignado una «C» en el campo «Declaración complementaria» (posición 121) o una «S» en el campo «Declaración sustitutiva» (posición 122), se consignará el número identificativo correspondiente a la declaración a la que complementa o la que se sustituye mediante la nueva.\nCampo de contenido numérico de 13 posiciones.\nEn cualquier otro caso deberá rellenarse a ceros.",
        "partes": [],
        "lon": 13
      },
      {
        "desde": 136,
        "hasta": 144,
        "tipo": "Numérico",
        "nombre": "NÚMERO TOTAL DE PERCEPCIONES",
        "descripcion": "Se consignará el número total de percepciones declaradas para este retenedor, con independencia de las claves o subclaves de percepción a que correspondan. (Número de registros de tipo 2.)",
        "partes": [],
        "lon": 9
      },
      {
        "desde": 145,
        "hasta": 160,
        "tipo": "Alfanumérico",
        "nombre": "IMPORTE TOTAL DE LAS PERCEPCIONES",
        "descripcion": "Este campo se subdivide en dos:\nLos importes deben consignarse en euros.\nEste campo se subdivide en dos:",
        "partes": [
          {
            "desde": 145,
            "hasta": 145,
            "texto": "SIGNO: campo alfabético que se cumplimentará cuando el resultado de la suma para obtener el importe de las percepciones satisfechas (posiciones 146 a 160 de este registro de tipo 1) sea menor de 0 (cero). En este caso se consignará una «N», en cualquier otro caso el contenido de este campo será un espacio."
          },
          {
            "desde": 146,
            "hasta": 160,
            "texto": "IMPORTE: campo numérico en el que se consignará la suma de las cantidades, sin coma decimal, reflejadas en las percepciones íntegras satisfechas (posiciones 82 a 94, 109 a 121, 256 a 268 y 283-295, correspondientes a los registros de percepciones), con independencia de la clave de percepción a la que correspondan. En el supuesto de que en los registros de perceptores se hubiera consignado «N» en los campos «Signo de la percepción íntegra», «Signo de la percepción en especie», «Signo de la percepción íntegra derivada de incapacidad laboral» y «Signo de la percepción en especie derivada de incapacidad laboral» (posiciones 81, 108, 255 y 282, respectivamente, del registro de tipo 2), por corresponder al reintegro de percepciones indebida o excesivamente satisfechas en ejercicios anteriores, dichas cantidades se computarán igualmente con signo menos al totalizar los importes que deben reflejarse en esta suma."
          },
          {
            "desde": 146,
            "hasta": 158,
            "texto": "Parte entera del importe total de las percepciones. Si no tiene contenido se consignará a ceros."
          },
          {
            "desde": 159,
            "hasta": 160,
            "texto": "Parte decimal del importe total de las percepciones. Si no tiene contenido se consignará a ceros."
          }
        ],
        "lon": 16
      },
      {
        "desde": 161,
        "hasta": 175,
        "tipo": "Numérico",
        "nombre": "IMPORTE TOTAL DE LAS RETENCIONES E INGRESOS A CUENTA",
        "descripcion": "Se consignará sin signo y sin coma decimal, la suma de las cantidades reflejadas en los campos «Retenciones practicadas», «Ingresos a cuenta efectuados», «Retenciones practicadas sobre prestaciones derivadas de incapacidad laboral» e «Ingresos a cuenta efectuados por prestaciones en especie derivadas de incapacidad laboral» (posiciones 95 a 107, 122 a 134, y 269 a 281 y 296 a 308, respectivamente, correspondientes a los registros de tipo 2), con independencia de las claves o subclaves de percepción a que correspondan.\nLos importes deben consignarse en euros.\nEste campo se subdivide en dos:",
        "partes": [
          {
            "desde": 161,
            "hasta": 173,
            "texto": "Parte entera del importe total de las retenciones e ingresos a cuenta. Si no tiene contenido se consignará a ceros."
          },
          {
            "desde": 174,
            "hasta": 175,
            "texto": "Parte decimal del importe total de las retenciones e ingresos a cuenta. Si no tiene contenido se consignará a ceros."
          }
        ],
        "lon": 15
      },
      {
        "desde": 176,
        "hasta": 225,
        "tipo": "Alfanumérico",
        "nombre": "CORREO ELECTRÓNICO DE LA PERSONA CON QUIEN RELACIONARSE: Se incluirá aquí una dirección de correo electrónico de la persona con quien relacionarse",
        "descripcion": "",
        "partes": [],
        "lon": 50
      },
      {
        "desde": 226,
        "hasta": 487,
        "tipo": "Blancos",
        "nombre": "BLANCOS",
        "descripcion": "",
        "partes": [],
        "lon": 262
      },
      {
        "desde": 488,
        "hasta": 500,
        "tipo": "Alfanumérico",
        "nombre": "SELLO ELECTRÓNICO",
        "descripcion": "Campo reservado para el sello electrónico, que será cumplimentado exclusivamente por los programas de la AEAT. En cualquier otro caso, se rellenará a blancos.\n* Todos los importes serán positivos.\n* Los campos numéricos que no tengan contenido se rellenarán a ceros.\n* Los campos alfanuméricos/alfabéticos que no tengan contenido se rellenarán a blancos.\n* Todos los campos numéricos ajustados a la derecha y rellenos de ceros por la izquierda.\n* Todos los campos alfanuméricos/alfabéticos ajustados a la izquierda y rellenos de blancos por la derecha, en mayúsculas, sin caracteres especiales y sin vocales acentuadas, excepto que se especifique lo contrario en la descripción del campo.\nMODELO 190",
        "partes": [],
        "lon": 13
      }
    ],
    "2": [
      {
        "desde": 1,
        "hasta": 1,
        "tipo": "Numérico",
        "nombre": "TIPO DE REGISTRO",
        "descripcion": "Constante ‘2’.",
        "partes": [],
        "lon": 1
      },
      {
        "desde": 2,
        "hasta": 4,
        "tipo": "Numérico",
        "nombre": "MODELO DECLARACIÓN",
        "descripcion": "Constante ‘190’.",
        "partes": [],
        "lon": 3
      },
      {
        "desde": 5,
        "hasta": 8,
        "tipo": "Numérico",
        "nombre": "EJERCICIO",
        "descripcion": "Consignar lo contenido en estas mismas posiciones del registro de tipo 1.",
        "partes": [],
        "lon": 4
      },
      {
        "desde": 9,
        "hasta": 17,
        "tipo": "Alfanumérico",
        "nombre": "NIF DEL DECLARANTE",
        "descripcion": "Consignar lo contenido en estas mismas posiciones del registro de tipo 1.",
        "partes": [],
        "lon": 9
      },
      {
        "desde": 18,
        "hasta": 26,
        "tipo": "Alfanumérico",
        "nombre": "NIF DEL PERCEPTOR",
        "descripcion": "Si el perceptor es una persona física se consignará su número de identificación fiscal (NIF) de acuerdo con las reglas previstas en el Reglamento General de las actuaciones y los procedimientos de gestión e inspección tributaria y de desarrollo de las normas comunes de los procedimientos de aplicación de los tributos, aprobado por el Real Decreto 1065/2007, de 27 de julio («BOE» del 5 de septiembre).\nSi el perceptor es una entidad en régimen de atribución de rentas (comunidad de bienes, sociedad civil, herencia yacente, etc.), se consignará el número de identificación fiscal correspondiente a la misma.\nPara la identificación de los menores de 14 años en sus relaciones de naturaleza o con trascendencia tributaria habrán de figurar tanto los datos de la persona menor de 14 años, incluido su número de identificación fiscal, como el número de identificación fiscal de su representante legal.\nEn las percepciones correspondientes a la clave J se consignará en quien concurran las condiciones a que se refiere el artículo 92.1 de la Ley del Impuesto.\nEste campo deberá estar ajustado a la derecha, siendo la última posición el carácter de control y rellenando con ceros las posiciones a la izquierda.",
        "partes": [],
        "lon": 9
      },
      {
        "desde": 27,
        "hasta": 35,
        "tipo": "Alfanumérico",
        "nombre": "NIF DEL REPRESENTANTE LEGAL",
        "descripcion": "Si el perceptor es menor de 14 años, se consignará en este campo el número de identificación fiscal de su representante legal (padre, madre o tutor).\nEste campo deberá estar ajustado a la derecha, siendo la última posición el carácter de control y rellenando con ceros las posiciones a la izquierda.\nEn cualquier otro caso el contenido de este campo se rellenará a espacios.",
        "partes": [],
        "lon": 9
      },
      {
        "desde": 36,
        "hasta": 75,
        "tipo": "Alfanumérico",
        "nombre": "APELLIDOS Y NOMBRE O DENOMINACIÓN DEL PERCEPTOR",
        "descripcion": "a) Para personas físicas se consignará el primer apellido, un espacio, el segundo apellido, un espacio y el nombre completo, necesariamente en este mismo orden.\nb) Tratándose de entidades en régimen de atribución de rentas, se consignará la denominación completa de la entidad, sin anagramas.",
        "partes": [],
        "lon": 40
      },
      {
        "desde": 76,
        "hasta": 77,
        "tipo": "Numérico",
        "nombre": "CÓDIGO PROVINCIA",
        "descripcion": "a) Con carácter general, se consignarán los dos dígitos numéricos que correspondan a la provincia o, en su caso, Ciudad con Estatuto de Autonomía, del domicilio del perceptor, según la siguiente relación:\nÁLAVA/ARABA\n01\nLEÓN\n24\nALBACETE\n02\nLLEIDA\n25\nALICANTE/ALACANT\n03\nLUGO\n27\nALMERÍA\n04\nMADRID\n28\nASTURIAS\n33\nMÁLAGA\n29\nÁVILA\n05\nMELILLA\n52\nBADAJOZ\n06\nMURCIA\n30\nBARCELONA\n08\nNAVARRA\n31\nBURGOS\n09\nOURENSE\n32\nCÁCERES\n10\nPALENCIA\n34\nCÁDIZ\n11\nPALMAS, LAS\n35\nCANTABRIA\n39\nPONTEVEDRA\n36\nCASTELLÓN/CASTELLÓ\n12\nRIOJA, LA\n26\nCEUTA\n51\nSALAMANCA\n37\nCIUDAD REAL\n13\nS.C. DE TENERIFE (a excepción de isla de la Palma).\n38\nCÓRDOBA\n14\nSEGOVIA\n40\nCORUÑA, A\n15\nSEVILLA\n41\nCUENCA\n16\nSORIA\n42\nGIRONA\n17\nTARRAGONA\n43\nGRANADA\n18\nTERUEL\n44\nGUADALAJARA.\n19\nTOLEDO\n45\nGUIPÚZCOA/GIPUZKOA\n20\nVALENCIA\n46\nHUELVA\n21\nVALLADOLID\n47\nHUESCA\n22\nVIZCAYA/BIZKAIA\n48\nILLES BALEARS\n07\nZAMORA\n49\nISLA DE LA PALMA\n53\nZARAGOZA\n50\nb) Supuesto especial.–Tratándose de percepciones correspondientes a contribuyentes del Impuesto sobre la Renta de las Personas Físicas con residencia habitual en el extranjero, a los que se refieren los artículos 8.2 y 10 de la Ley del Impuesto (personas físicas de nacionalidad española que acrediten su nueva residencia fiscal en un país o territorio considerado como paraíso fiscal, miembros de misiones diplomáticas españolas, miembros de oficinas consulares españolas,... etc.), se consignarán como código de provincia los dígitos 98.\nEn ningún caso se incluirán en el modelo 190 percepciones correspondientes a personas o entidades no residentes en territorio español que no sean contribuyentes del IRPF, sin perjuicio de la inclusión, en su caso, de la información correspondiente a dichas percepciones en el resumen anual de retenciones e ingresos a cuenta del Impuesto sobre la Renta de no Residentes (modelo 296) a que se refiere el artículo 15.2 del Reglamento de dicho Impuesto, aprobado por el Real Decreto 1776/2004, de 30 de julio («BOE» del 5 de agosto).",
        "partes": [],
        "lon": 2
      },
      {
        "desde": 78,
        "hasta": 78,
        "tipo": "Alfabético",
        "nombre": "CLAVE DE PERCEPCIÓN",
        "descripcion": "Se consignará la clave alfabética que corresponda a las percepciones de que se trate, según la relación de claves siguientes:\nA. Rendimientos del trabajo: Empleados por cuenta ajena en general. Se utilizará esta clave para relacionar todas aquellas percepciones, dinerarias o en especie, que hayan sido satisfechas por la persona o entidad declarante en concepto de rendimientos del trabajo, siempre que para determinar el importe de la retención hubiese resultado aplicable el procedimiento general establecido en el artículo 82 del Reglamento del Impuesto y que sean distintas de las que deban reflejarse específicamente en las claves B, C y D. Por consiguiente, también se incluirán en esta clave, entre otras, las percepciones correspondientes a los trabajadores manuales que perciban sus retribuciones por peonadas o jornales diarios como consecuencia de una relación esporádica y diaria con el empleador, así como las correspondientes a las relaciones laborales especiales de carácter dependiente y a los contratos o relaciones laborales de duración inferior al año.Se incluirán también en esta clave las percepciones en concepto de incapacidad laboral abonadas directamente por el empleador al trabajador (en virtud del respectivo acuerdo de colaboración con la Seguridad Social, sea esta colaboración de carácter obligatorio o voluntario). En otro caso, estas percepciones por incapacidad laboral se reflejarán por parte de la entidad pagadora en la Clave B, subclave 01.\nPor excepción, no se incluirán en el modelo 190 las retribuciones del trabajo en especie respecto de las cuales no exista obligación de efectuar ingresos a cuenta conforme a lo previsto en el artículo 102.2 del Reglamento del Impuesto (contribuciones satisfechas por los promotores de Planes de Pensiones y de Mutualidades de Previsión Social y de los Planes de Previsión Social Empresarial, así como las aportaciones a dichos Sistemas de Previsión Social que deriven de una decisión del trabajador, que reduzcan la base imponible), sin perjuicio de la obligación de declarar los datos relativos a dichos conceptos en el modelo 345.\nLas retribuciones del trabajo en especie que tengan la consideración de retribuciones exentas de acuerdo con lo dispuesto en las letras a) a f) del art. 42.3 de la Ley del impuesto se incluirán en la subclave correspondiente de la Clave L. \"Rentas exentas y dietas exceptuadas de gravamen\". No obstante, respecto de los rendimientos del trabajo exentos previstos en las letras a) y b) de dicho apartado, únicamente se exigirán datos cuando para la prestación de los servicios se utilicen fórmulas indirectas.\nB. Rendimientos del trabajo: Pensionistas y perceptores de haberes pasivos y demás prestaciones previstas en el artículo 17.2.a) de la Ley del Impuesto. Se identificarán con esta clave las percepciones no exentas del IRPF correspondientes a las pensiones y haberes pasivos de los regímenes públicos de la Seguridad Social y clases pasivas, así como las que correspondan a las demás, sean dinerarias o en especie, a que hace referencia el artículo 17.2, letra a), de la Ley del Impuesto.\nSe consignará, obligatoriamente, la subclave que en cada caso proceda de las indicadas en el campo SUBCLAVE.\nC. Rendimientos del trabajo: Prestaciones o subsidios por desempleo. Se identificarán con esta clave las percepciones correspondientes a las prestaciones o subsidios por desempleo, con excepción de las prestaciones satisfechas por este concepto en la modalidad de pago único.\nSe consignará, obligatoriamente, la subclave que en cada caso proceda de las indicadas en el campo SUBCLAVE.\nD. Rendimientos del trabajo: Prestaciones por desempleo abonadas en la modalidad de pago único. Desde el 1 de enero de 2013 esta clave queda suprimida en relación con las prestaciones por desempleo abonadas en la modalidad de pago único, establecida en el Real Decreto 1044/1985, de 19 de junio, cuyo reconocimiento por la respectiva entidad gestora haya tenido lugar a partir de dicha fecha. Al estar dichas prestaciones totalmente exentas del IRPF, conforme a lo establecido en el artículo 7, letra n), de la Ley del Impuesto, el importe de las mismas se incluirá entre las percepciones de la clave L, subclave 13.\nNo obstante, se utilizará esta clave para relacionar las prestaciones reintegradas por sus perceptores en el ejercicio como consecuencia de haber sido indebidamente percibidas en ejercicios anteriores a 2013, en la medida en que correspondan a percepciones originariamente declaradas con esta misma clave. A estos efectos, se seguirán las indicaciones contenidas en la descripción del campo \"Ejercicio de devengo\" (posiciones 148-151) que resulten de aplicación.\nE. Rendimientos del trabajo: Consejeros y administradores. Se identificarán con esta clave las retribuciones, dinerarias o en especie, satisfechas a personas físicas por su condición de administradores y miembros de los Consejos de administración o de las Juntas que hagan sus veces y demás miembros de otros órganos representativos.\nSe consignará obligatoriamente la subclave que en cada caso proceda de las indicadas en el campo SUBCLAVE.\nF. Rendimientos del trabajo: Cursos, conferencias, seminarios y similares y elaboración de obras literarias, artísticas o científicas. Se identificarán con esta clave las percepciones, dinerarias o en especie, satisfechas por la persona o entidad declarante en concepto de rendimientos del trabajo, cuando deriven de impartir cursos, conferencias, coloquios, seminarios y similares, o bien de la elaboración de obras literarias, artísticas o científicas, siempre que se hubiera cedido el derecho a la explotación de las mismas. También se incluirán en esta clave los rendimientos de la propiedad intelectual cuando tengan para su perceptor la calificación de rendimientos de trabajo.\nSe consignará, obligatoriamente, la subclave que en cada caso proceda de las indicadas en el campo SUBCLAVE.\nG. Rendimientos de actividades económicas: Actividades profesionales. Se identificarán con esta clave las percepciones, dinerarias o en especie, satisfechas por la persona o entidad declarante que sean contraprestación de las actividades económicas de naturaleza profesional a que se refiere la letra a) del apartado 5 del artículo 101 de la Ley del Impuesto. También se incluirán en esta clave los rendimientos de la propiedad intelectual, así como los rendimientos derivados de la cesión del derecho a la explotación de la imagen, cuando tales rendimientos tengan para su perceptor la calificación de rendimientos derivados de su actividad profesional.\nSe consignará, obligatoriamente, la subclave que en cada caso proceda de las indicadas en el campo SUBCLAVE.\nH. Rendimientos de actividades económicas: actividades agrícolas, ganaderas y forestales y actividades en estimación objetiva a las que se refiere el artículo 95.6 del Reglamento del Impuesto. Se identificarán con esta clave las percepciones, dinerarias o en especie, satisfechas por la persona o entidad declarante que sean contraprestación de las siguientes actividades económicas:\na) Las actividades agrícolas, ganaderas o forestales a que se refieren los apartados 4 y 5 del artículo 95 del Reglamento del Impuesto. Respecto de estas actividades, no se incluirán las subvenciones corrientes o de capital ni las indemnizaciones, conceptos que, en su caso, deberán ser declarados en el modelo 346.\nb) Las actividades económicas en estimación objetiva previstas en el apartado 6.2.º del artículo 95 del Reglamento del Impuesto.\nSe consignará, obligatoriamente, la subclave que en cada caso proceda de las indicadas en el campo SUBCLAVE.\nI. Rendimientos de actividades económicas: rendimientos a que se refiere el artículo 75.2, letra b), del Reglamento del Impuesto. Se identificarán con esta clave las percepciones, dinerarias o en especie, satisfechas por la persona o entidad declarante en concepto de rendimientos de la propiedad intelectual o industrial, de la prestación de asistencia técnica, del arrendamiento de bienes muebles, negocios o minas o del subarrendamiento de dichos bienes, así como los procedentes de la cesión del derecho a la explotación del derecho de imagen, cuando dichos rendimientos tengan para su perceptor la calificación fiscal de rendimientos de actividades económicas distintos de los procedentes de actividades profesionales que deban incluirse en la clave G.\nSe consignará, obligatoriamente, la subclave que en cada caso proceda de las indicadas en el campo SUBCLAVE.\nJ. Imputación de rentas por la cesión de derechos de imagen: contraprestaciones a que se refiere el artículo92.8 de la Ley del Impuesto. Se identificarán con esta clave las contraprestaciones, dinerarias o en especie, satisfechas por la persona o entidad declarante a personas o entidades no residentes en territorio español, que estén sujetas a la obligación de efectuar el ingreso a cuenta previsto en el artículo 92.8 de la Ley del Impuesto.\nEn las percepciones de esta clave se consignará como NIF del perceptor el correspondiente a la persona física residente que deba efectuar la imputación en la base imponible del IRPF de las rentas derivadas de la cesión del derecho de imagen, en aplicación del régimen especial establecido en el artículo 92 de la Ley del Impuesto.\nK. Premios y ganancias patrimoniales de los vecinos derivadas de los aprovechamientos forestales en montes públicos. Se identificarán con esta clave las siguientes rentas sometidas a retención o ingreso a cuenta:\na) Los premios, dinerarios o en especie, a que se refiere el artículo 75.2, letra c), del Reglamento del Impuesto, que hayan sido entregados por la persona o entidad declarante como consecuencia de la participación de los perceptores en juegos, concursos, rifas o combinaciones aleatorias, incluyendo aquellos sobre los que no exista obligación de practicar retención o ingreso a cuenta por no superar la base de retención la cantidad de 300 euros. Se exceptúan los premios sujetos al Gravamen Especial sobre los premios de determinadas loterías y apuestas a que se refiere la Disposición Adicional Trigésima Tercera de la Ley del Impuesto, así como los premios que se entreguen como consecuencia de juegos organizados al amparo de lo previsto en el Real Decreto-ley 16/1977, de 25 de febrero, por el que se regulan los aspectos penales, administrativos y fiscales de los juegos de suerte, envite o azar y apuestas, y demás normativa estatal o autonómica sobre el juego.\nb) Las ganancias patrimoniales a que se refiere el último inciso del artículo 75.1, letra d), del Reglamento del Impuesto, consistentes en percepciones obtenidas por los vecinos como consecuencia de aprovechamientos forestales en montes públicos.\nSe consignará, obligatoriamente, la subclave que en cada caso proceda de las indicadas en el campo SUBCLAVE.\nL. Rentas exentas y dietas exceptuadas de gravamen. Se identificarán con esta clave las dietas y asignaciones para gastos de viaje, en las cuantías que resulten exceptuadas de gravamen con arreglo a lo dispuesto en el artículo 9 del Reglamento del Impuesto, así como las rentas exentas del IRPF que tengan la consideración de rendimientos del trabajo, con excepción de las anualidades por alimentos a que se refiere la letra k) del artículo 7 de la Ley del Impuesto, y aquellas otras que, teniendo la consideración de rendimientos de actividades económicas, estén exentas en virtud de lo dispuesto en el citado artículo 7 de la Ley del Impuesto.\nTratándose de dietas y asignaciones para gastos de viaje, así como cuando la exención esté sujeta a límites cuantitativos, si la persona o entidad declarante hubiera satisfecho cantidades superiores a los límites legal o reglamentariamente establecidos, el exceso deberá incluirse en la clave y, en su caso, subclave, que corresponda de las demás claves y subclaves que en estas instrucciones se indican.\nSe consignará, obligatoriamente, la subclave que en cada caso proceda de las indicadas en el campo SUBCLAVE.",
        "partes": [],
        "lon": 1
      },
      {
        "desde": 79,
        "hasta": 80,
        "tipo": "Numérico",
        "nombre": "SUBCLAVE",
        "descripcion": "Tratándose de percepciones correspondientes a las claves B, C, E, F, G, H, I, K y L, deberá consignarse, además, la subclave numérica de dos dígitos que corresponda a las percepciones de que se trate, según la relación de subclaves que para cada una de las mencionadas claves figura a continuación.\nEn percepciones correspondientes a claves distintas de las mencionadas, no se cumplimentará este campo.\nCuando deban consignarse en el modelo 190 percepciones satisfechas a un mismo perceptor que correspondan a diferentes claves o subclaves de percepción, deberán cumplimentarle tantos apuntes o registros de percepción como sea necesario, de forma que cada uno de ellos refleje exclusivamente los datos de percepciones correspondientes a una misma clave y, en su caso, subclave.\nSubclaves a utilizar en percepciones correspondientes a la clave B:\n01. Se consignará esta subclave cuando se trate de percepciones consistentes en pensiones y haberes pasivos de los regímenes de la Seguridad Social y Clases Pasivas, con excepción de las que deban relacionarse bajo la subclave 02.\nTambién se consignarán en esta subclave las percepciones en concepto de incapacidad laboral abonadas directamente al trabajador por alguno de los regímenes públicos de la Seguridad Social o Clases Pasivas o, en su caso, por la respectiva Mutua Colaboradora con la Seguridad Social. Si dichas prestaciones son directamente abonadas por el empleador (en virtud del respectivo acuerdo de colaboración con la Seguridad Social), se reflejarán en la clave A.\n02. Se consignará esta subclave en todas las percepciones de la clave B en las que el importe de las retenciones se haya determinado con arreglo al procedimiento especial previsto en el artículo 89.A del Reglamento del Impuesto.\n03. Prestaciones percibidas por los beneficiarios de mutualidades generales obligatorias de funcionarios, colegios de huérfanos y entidades similares.\n04. Prestaciones derivadas de Planes de Pensiones y otros Sistemas de Previsión Social a los que se refiere el artículo 17.2.a) de la Ley 35/2006, de 28 de noviembre.\n99. Resto de prestaciones de la Clave B distintas de las que deban relacionarse bajo las subclaves anteriores.\nSubclaves a utilizar en percepciones correspondientes a la clave C:\n01. Prestaciones por desempleo. Se incluirán en esta subclave las prestaciones por desempleo que, debiendo relacionarse en el modelo 190, sean distintas de las específicamente señaladas en las subclaves siguientes.\n02. Prestaciones por desempleo ERE. Se consignarán en esta subclave las prestaciones por desempleo satisfechas vinculadas a la normativa reguladora de los expedientes de regulación de empleo (ERE).\n03. Prestaciones por desempleo ERTE. Se consignarán en esta subclave las prestaciones por desempleo satisfechas vinculadas a un expediente de regulación temporal de empleo (ERTE).\n04. Prestación por cese de actividad de trabajadores autónomos. Se consignarán en esta subclave las prestaciones por cese de actividad (de carácter extraordinario o no) satisfechas a trabajadores autónomos.\n05. Subsidios por desempleo. Se consignarán en esta subclave los diferentes subsidios satisfechos, en su modalidad no contributiva, tales como los subsidios por cotización insuficiente, subsidios para mayores de 45 o 52 años, para emigrantes retornados, el subsidio extraordinario por desempleo y otros subsidios de carácter no contributivo, a excepción de la renta activa de inserción, que se reflejará en la subclave 06 siguiente.\n06. Renta activa de inserción. Ayuda económica satisfecha vinculada a la realización de las acciones en materia de políticas activas de empleo que no conlleven retribuciones salariales.\n07. Otras prestaciones de carácter contributivo. Se consignarán en esta subclave el resto de prestaciones o ayudas de carácter contributivo satisfechas, que no deban reflejarse en las subclaves anteriores.\n08. Otras prestaciones de carácter no contributivo. Se consignarán en esta subclave el resto de prestaciones, subsidios o ayudas de carácter no contributivo satisfechas, que no deban reflejarse en las subclaves anteriores.\n09. Supuestos de percepción en el ejercicio de prestaciones de más de uno de los tipos anteriores por el mismo perceptor.\nSubclaves a utilizar en percepciones correspondientes a la clave E:\n01. Se consignará esta subclave únicamente cuando el Consejero o Administrador esté incluido en el régimen general de la Seguridad Social como trabajador«asimilado» a trabajadores por cuenta ajena, y los rendimientos percibidos no deban reflejarse en la subclave 02.\n02. Se consignará esta subclave únicamente cuando el Consejero o Administrador esté incluido en el régimen general de la Seguridad Social como trabajador«asimilado» a trabajadores por cuenta ajena, y los rendimientos procedan de entidades cuyo importe neto de la cifra de negocios del último período impositivo finalizado con anterioridad al pago de los rendimientos sea inferior a100.000 euros.\n03. Se consignará esta subclave únicamente cuando el Consejero o Administrador esté incluido en el régimen especial de la Seguridad Social de trabajadores autónomos, y los rendimientos procedan de entidades cuyo importe neto de la cifra de negocios del último período impositivo finalizado con anterioridad al pago de los rendimientos sea inferior a 100.000 euros.\n04. Se consignará esta subclave en todas las percepciones de la clave E distintas de las que deban relacionarse bajo las subclaves 01, 02 y 03.\nSubclaves a utilizar en percepciones correspondientes a la clave F:\n01. Se consignará esta subclave cuando las percepciones correspondan a alguno de los premios literarios, científicos o artísticos no exentos del Impuesto a que se refiere el artículo 12.1, letra g), del Reglamento del Impuesto.\n02. Rendimientos del trabajo derivados de impartir cursos, conferencias, coloquios y similares.\nSubclaves a utilizar en percepciones correspondientes a la clave G:\n01. Se consignará esta subclave cuando se trate de percepciones a las que resulte aplicable el tipo de retención establecido con carácter general en el artículo95.1 del Reglamento del Impuesto.\n02. Se consignará esta subclave cuando se trate de percepciones a las que resulte aplicable el tipo de retención específico establecido en el citado artículo del Reglamento del Impuesto para los rendimientos satisfechos a recaudadores municipales, mediadores de seguros que utilicen los servicios de auxiliares externos y delegados comerciales de la entidad pública empresarial«Loterías y Apuestas del Estado».\n03. Se consignará esta subclave cuando se trate de percepciones a las que resulte aplicable el tipo de retención reducido establecido en el artículo 95.1 del Reglamento del Impuesto para los rendimientos satisfechos a contribuyentes que inicien el ejercicio de actividades profesionales, tanto en el período impositivo en que se produzca dicho inicio como en los dos siguientes.\nSubclaves a utilizar en percepciones correspondientes a la clave H:\n01. Se consignará esta subclave cuando se trate de percepciones a las que resulte aplicable el tipo de retención establecido con carácter general en el artículo 95.4.2.º del Reglamento del Impuesto.\n02. Se consignará esta subclave cuando se trate de percepciones a las que resulte aplicable el tipo de retención específico establecido en el artículo 95.4.1.º del Reglamento del Impuesto para los rendimientos que sean contraprestación de actividades ganaderas de engorde de porcino y avicultura.\n03. Se consignará esta subclave cuando las percepciones satisfechas sean contraprestación de las actividades forestales a que se refiere el artículo 95.5 del Reglamento del Impuesto.\n04. Se consignará esta subclave cuando las percepciones satisfechas sean contraprestación de las actividades económicas en estimación objetiva recogidas en el artículo 95.6.2.º del Reglamento del Impuesto.\nSubclaves a utilizar en percepciones correspondientes a la clave I:\n01. Se consignará esta subclave cuando se trate de percepciones satisfechas por la persona o entidad declarante en concepto de rendimientos procedentes de la cesión del derecho a la explotación del derecho de imagen.\n02. Se consignará esta subclave cuando se trate de percepciones derivadas de la propiedad intelectual, a las que sea aplicable el tipo de retención establecido con carácter general en el artículo 101.9 de la Ley del Impuesto.\n03. Se consignará esta subclave cuando se trate de percepciones satisfechas por la persona o entidad declarante por cualquier otro de los conceptos a que se refiere el artículo 75.2, letra b), del Reglamento del Impuesto.\nSubclaves a utilizar en percepciones correspondientes a la clave K:\n01. Se consignará esta subclave cuando las percepciones correspondan a premios que, por su importe, se encuentren sometidos a retención, derivados de la participación en juegos, rifas o combinaciones aleatorias sin fines publicitarios, enmarcables en la definición del concepto de \"juego\" que se contiene en el artículo 3.a) de la Ley 13/2011, de 27 de mayo, de regulación del juego, caracterizado por arriesgarse cantidades de dinero u otros elementos patrimoniales a cambio de la posibilidad de obtener un premio o ganancia. Estos premios se consignarán por su importe íntegro, sin perjuicio del derecho del perceptor a minorar su importe en las pérdidas en el juego obtenidas en el mismo período impositivo, en los términos establecidos en el artículo 35.5.d) de la Ley del impuesto.\n02. Se consignará esta subclave cuando las percepciones correspondan a ganancias patrimoniales obtenidas por los vecinos como consecuencia de aprovechamientos forestales en montes públicos.\n03. Se consignará esta subclave cuando las percepciones correspondan a premios que, por su importe, se encuentren sometidos a retención, derivados de la participación en concursos o combinaciones aleatorias con fines publicitarios, en los que no se realice un desembolso económico por su participación en ellos, y por tanto, no enmarcables en la definición del concepto de \"juego\" que se contiene en el artículo 3.a) de la Ley 13/2011, de 27 de mayo, de regulación del juego. Se incluyen aquí premios derivados de programas desarrollados en medios de comunicación, así como los derivados de combinaciones aleatorias con fines publicitarios y promocionales definidas en el artículo 3.i) de la Ley 13/2011.\n04. Se consignará esta subclave cuando las percepciones correspondan a premios que, por su importe, no se encuentren sometidos a retención, derivados de la participación en juegos, rifas o combinaciones aleatorias sin fines publicitarios, enmarcables en la definición del concepto de \"juego\" que se contiene en el artículo 3.a) de la Ley 13/2011, de 27 de mayo, de regulación del juego, caracterizado por arriesgarse cantidades de dinero u otros elementos patrimoniales a cambio de la posibilidad de obtener un premio o ganancia. Estos premios se consignarán por su importe íntegro, sin perjuicio del derecho del perceptor a minorar su importe en las pérdidas en el juego obtenidas en el mismo período impositivo, en los términos establecidos en el artículo 35.5.d) de la Ley del impuesto.\n05. Se consignará esta subclave cuando las percepciones correspondan a premios que, por su importe, no se encuentren sometidos a retención, derivados de la participación en concursos o combinaciones aleatorias con fines publicitarios, en los que no se realice un desembolso económico por su participación en ellos, y por tanto, no enmarcables en la definición del concepto de \"juego\" que se contiene en el artículo 3.a) de la Ley 13/2011, de 27 de mayo, de regulación del juego. Se incluyen aquí premios derivados de programas desarrollados en medios de comunicación, así como los derivados de combinaciones aleatorias con fines publicitarios y promocionales definidas en el artículo 3.i) de la Ley 13/2011.\nSubclaves a utilizar en percepciones correspondientes a la clave L:\n01. Dietas y asignaciones para gastos de viaje exceptuadas de gravamen conforme a lo previsto en el artículo 9 del Reglamento del Impuesto.\n02. Prestaciones públicas extraordinarias por actos de terrorismo y pensiones derivadas de medallas y condecoraciones concedidas por actos de terrorismo que estén exentas en virtud de lo establecido en la letra a) del artículo 7 de la Ley del Impuesto.\n03. Ayudas percibidas por los afectados por el virus de la inmunodeficiencia humana a que se refiere la letra b) del artículo 7 de la Ley del Impuesto.\n04. Pensiones por lesiones o mutilaciones sufridas con ocasión o como consecuencia de la Guerra Civil 1936/1939 que estén exentas en virtud de lo establecido en la letra c) del artículo 7 de la Ley del Impuesto.\n05. Indemnizaciones por despido o cese del trabajador que estén exentas en virtud de lo establecido en la letra e) del artículo 7 de la Ley del Impuesto y en el artículo 1 del Reglamento.\n06. Prestaciones por incapacidad permanente absoluta o gran invalidez que estén exentas conforme a lo establecido en la letra f) del artículo 7 de la Ley del Impuesto.\n07. Pensiones por inutilidad o incapacidad permanente del régimen de clases pasivas a que se refiere la letra g) del artículo 7 de la Ley del Impuesto.\n08. Prestaciones, pensiones y haberes pasivos que estén exentos en virtud de lo establecido en la letra h) del artículo 7 de la Ley del Impuesto, sin incluir en esta subclave las prestaciones públicas por maternidad o paternidad exentas que deban consignarse en la subclave 27.\n09. Prestaciones económicas de instituciones públicas con motivo del acogimiento de personas con discapacidad, mayores de sesenta y cinco años o menores y ayudas económicas otorgadas por instituciones públicas a personas con discapacidad o mayores de sesenta y cinco años para financiar su estancia en residencias o centros de día, que estén exentas en virtud de lo establecido en la letra i) del artículo 7 de la Ley del Impuesto.\n10. Becas que estén exentas en virtud de lo establecido en la letra j) del artículo 7 de la Ley del Impuesto.\n11. Premios literarios, artísticos o científicos relevantes, así como los premios «Príncipe de Asturias», que estén exentos en virtud de lo establecido en la letra l) del artículo 7 de la Ley del Impuesto y en el artículo 3 del Reglamento.\n12. Ayudas económicas a los deportistas de alto nivel que estén exentas en virtud de lo establecido en la letra m) del artículo 7 de la Ley del Impuesto y en el artículo 4 del Reglamento.\n13. Prestaciones por desempleo abonadas en la modalidad de pago único que estén exentas en virtud de lo establecido en la letra n) del artículo 7 de la Ley del Impuesto.\n14. Gratificaciones extraordinarias satisfechas por el Estado español por la participación en misiones internacionales de paz o humanitarias que estén exentas en virtud de lo establecido en la letra o) del artículo 7 de la Ley del Impuesto y en el artículo 5 del Reglamento.\n15. Rendimientos del trabajo percibidos por trabajos realizados en el extranjero que estén exentos en virtud de lo establecido en la letra p) del artículo 7 de la Ley del Impuesto y en el artículo 6 del Reglamento.\n16. Prestaciones por entierro o sepelio que estén exentas en virtud de lo establecido en la letra r) del artículo 7 de la Ley del Impuesto.\n17. Ayudas a favor de las personas que hayan desarrollado la hepatitis C como consecuencia de haber recibido tratamiento en el ámbito del sistema sanitario público, que estén exentas en virtud de lo establecido en la letra s) del artículo 7 de la Ley del Impuesto.\n18. Prestaciones en forma de renta obtenidas por las personas con discapacidad correspondientes a aportaciones a sistemas de previsión social constituidos en favor de las mismas, que estén exentas en virtud de lo establecido en la letra w) del artículo 7 de la Ley del Impuesto.\n19. Prestaciones económicas públicas vinculadas al servicio para cuidados en el entorno familiar y de asistencia personalizada que se derivan de la Ley de promoción de la autonomía personal y atención a las personas en situación de dependencia, que estén exentas en virtud de lo establecido en la letra x) del artículo 7 de la Ley del Impuesto.\n20. Prestaciones y ayudas familiares públicas vinculadas al nacimiento, adopción, acogimiento o cuidado de hijos menores, que estén exentas en virtud de lo establecido en la letra z) del artículo 7 de la Ley del Impuesto.\n21. Rendimientos del trabajo de la persona titular de un patrimonio protegido a que se refiere la disposición adicional decimoctava de la Ley del Impuesto, derivados de las aportaciones a dichos patrimonios protegidos, que estén exentos en virtud de lo establecido en el segundo párrafo de la letra w) del artículo 7 de la Ley del Impuesto.\n22. Ayudas establecidas por Comunidades Autónomas o por entidades locales para atender, con arreglo a su normativa, a colectivos en riesgo de exclusión social, situaciones de emergencia social, necesidades habitacionales de personas sin recursos o necesidades de alimentación, escolarización y demás necesidades básicas de menores o personas con discapacidad cuando ellos y las personas a su cargo, carezcan de medios económicos suficientes, que estén exentas en virtud de lo establecido en el primer párrafo de la letra y) del artículo 7 de la Ley del Impuesto, sin incluir en esta subclave las prestaciones económicas establecidas por las Comunidades Autónomas en concepto de renta mínima de inserción que deban consignarse en la subclave 28.\n23. Ayudas concedidas a víctimas de delitos violentos a que se refiere la Ley 35/1995, de 11 de diciembre, de ayudas y asistencia a las víctimas de delitos violentos y contra la libertad sexual, ayudas previstas en la Ley Orgánica 1/2004, de 28 de diciembre, de Medidas de Protección Integral contra la Violencia de Género, y demás ayudas públicas satisfechas a víctimas de violencia de género por tal condición, que estén exentas en virtud de lo establecido en el segundo párrafo de la letra y) del artículo 7 de la Ley del Impuesto.\n24. Rendimientos del trabajo en especie exentos de acuerdo con lo dispuesto en las letras a) b), c), y e), del artículo 42.3 de la Ley del Impuesto, sin incluir en esta subclave los rendimientos del trabajo en especie exentos que deban consignarse en la subclave 25.\nNo obstante, respecto de los rendimientos del trabajo exentos previstos en las letras a) y b) del artículo 42.3 de la Ley del Impuesto que se incluyan en esta subclave 24, únicamente se exigirán datos cuando para la prestación de los servicios se utilicen fórmulas indirectas.\n25. Rendimientos del trabajo en especie exentos de acuerdo con lo dispuesto en la letra b) del artículo 42.3 de la Ley del Impuesto exclusivamente referidos a aquellos destinados por las empresas o empleadores a prestar el servicio de primer ciclo de educación infantil a los hijos de sus trabajadores. No obstante, respecto de los rendimientos del trabajo exentos previstos en esta subclave, únicamente se exigirán datos cuando para la prestación de los servicios se utilicen fórmulas indirectas.",
        "partes": [],
        "lon": 2
      },
      {
        "desde": 81,
        "hasta": 107,
        "tipo": "Alfanumérico",
        "nombre": "PERCEPCIONES DINERARIAS NO DERIVADAS DE INCAPACIDAD LABORAL",
        "descripcion": "Este campo se subdivide en tres:\nLos importes deben consignarse en euros. Este campo se subdivide en dos:\nSi algún perceptor no ha sufrido retención este campo se consignará relleno a ceros.\nLos importes deben consignarse en euros. Este campo se subdivide en dos:",
        "partes": [
          {
            "desde": 81,
            "hasta": 81,
            "texto": "SIGNO DE LA PERCEPCIÓN ÍNTEGRA: Se cumplimentará este campo cuando las percepciones correspondan a cantidades reintegradas por el perceptor en el ejercicio, como consecuencia de haber sido indebida o excesivamente percibidas en ejercicios anteriores. En este caso se consignará una «N», en cualquier otro caso el contenido de este campo será un espacio."
          },
          {
            "desde": 82,
            "hasta": 94,
            "texto": "PERCEPCIÓN ÍNTEGRA (Dineraria): Campo numérico de 13 posiciones. Se hará constar, sin signo y sin coma decimal, el importe íntegro anual de las percepciones dinerarias efectivamente satisfechas a cada perceptor, salvo las que deban consignarse en el campo «Percepción íntegra derivada de incapacidad laboral» satisfechas por el mismo pagador."
          },
          {
            "desde": 82,
            "hasta": 92,
            "texto": "Parte entera del importe de la percepción íntegra, si no tiene contenido se consignará a ceros."
          },
          {
            "desde": 93,
            "hasta": 94,
            "texto": "Parte decimal del importe de la percepción íntegra, si no tiene contenido se consignará a ceros."
          },
          {
            "desde": 95,
            "hasta": 107,
            "texto": "RETENCIONES PRACTICADAS: Campo numéricode 13 posiciones. Se consignará, sin signo y sin coma decimal, el importe anual efectivamente retenido a cuenta del IRPF en relación con las percepciones dinerarias consignadas en el campo anterior, sin incluir las que deban consignarse en el campo «Retenciones practicadas sobre prestaciones derivadas de incapacidad laboral» practicadas por el mismo pagador."
          },
          {
            "desde": 95,
            "hasta": 105,
            "texto": "Parte entera del importe de las retenciones practicadas, si no tiene contenido se consignará a ceros."
          },
          {
            "desde": 106,
            "hasta": 107,
            "texto": "Parte decimal del importe de las retenciones practicadas, si no tiene contenido se consignará a ceros."
          }
        ],
        "lon": 27
      },
      {
        "desde": 108,
        "hasta": 147,
        "tipo": "Alfanumérico",
        "nombre": "PERCEPCIONES EN ESPECIE NO DERIVADAS DE INCAPACIDAD LABORAL",
        "descripcion": "Este campo se subdivide en cuatro:\nEn este caso se consignará una «N», en cualquier otro caso el contenido de este campo será un espacio.\nLos importes deben consignarse en euros. Este campo se subdivide en dos:\nLos importes deben consignarse en euros. Este campo se subdivide en dos:\nLos importes deben consignarse en euros. Este campo se subdivide en dos:",
        "partes": [
          {
            "desde": 108,
            "hasta": 108,
            "texto": "SIGNO DE LA PERCEPCIÓN EN ESPECIE: Se cumplimentará este campo cuando el perceptor reintegre en este ejercicio percepciones en especie, como consecuencia de haber sido indebida o excesivamente percibidas en ejercicios anteriores."
          },
          {
            "desde": 109,
            "hasta": 121,
            "texto": "VALORACIÓN (De la percepción en especie): Campo numérico de 13 posiciones. Se hará constar sin signo y sin coma decimal, la suma de las valoraciones correspondientes a las percepciones en especie efectivamente satisfechas en el ejercicio al perceptor de que se trate, determinadas con arreglo a lo establecido en el artículo 43 de la Ley del Impuesto y sin incluir en ningún caso el importe del ingreso a cuenta. No se incluirán en este campo las percepciones en especie que deban incluirse, en su caso, en el campo «Valoración de la prestación en especie derivada de incapacidad laboral»."
          },
          {
            "desde": 109,
            "hasta": 119,
            "texto": "Parte entera del importe de la valoración, si no tiene contenido se consignará a ceros."
          },
          {
            "desde": 120,
            "hasta": 121,
            "texto": "Parte decimal del importe de la valoración, si no tiene contenido se consignará a ceros."
          },
          {
            "desde": 122,
            "hasta": 134,
            "texto": "INGRESOS A CUENTA EFECTUADOS: Camponumérico de 13 posiciones. Se consignará, sin signo y sin coma decimal, el importe anual efectivamente ingresado a cuenta por el pagador en relación con las percepciones en especie consignadas en el campo anterior. No se incluirán en este campo los ingresos a cuenta efectuados que correspondan a percepciones en especie derivadas de incapacidad laboral que deban incluirse, en su caso, en el campo «Ingresos a cuenta efectuados por prestaciones en especie derivadas de incapacidad laboral»."
          },
          {
            "desde": 122,
            "hasta": 132,
            "texto": "Parte entera del importe de los ingresos a cuenta efectuados, si no tiene contenido se consignará a ceros."
          },
          {
            "desde": 133,
            "hasta": 134,
            "texto": "Parte decimal del importe de los ingresos a cuenta efectuados, si no tiene contenido se consignará a ceros."
          },
          {
            "desde": 135,
            "hasta": 147,
            "texto": "INGRESOS A CUENTA REPERCUTIDOS: Campo numérico de 13 posiciones. Se consignará, sin signo y sin coma decimal, el importe anual de los ingresos a cuenta efectuados que, en su caso, el pagador de las retribuciones en especie hubiera repercutido al perceptor. No se incluirán en este campo los ingresos a cuenta repercutidos que correspondan a percepciones en especie derivadas de incapacidad laboral que deban incluirse, en su caso, en el campo «Ingresos a cuenta repercutidos por prestaciones en especie derivadas de incapacidad laboral»."
          },
          {
            "desde": 135,
            "hasta": 145,
            "texto": "Parte entera del importe de los ingresos a cuenta repercutidos, si no tiene contenido se consignará a ceros."
          },
          {
            "desde": 146,
            "hasta": 147,
            "texto": "Parte decimal del importe de los ingresos a cuenta repercutidos, si no tiene contenido se consignará a ceros."
          }
        ],
        "lon": 40
      },
      {
        "desde": 148,
        "hasta": 151,
        "tipo": "Numérico",
        "nombre": "EJERCICIO DEVENGO",
        "descripcion": "Únicamente se cumplimentará este campo en los supuestos que a continuación se indican:\na) Cuando alguna de las percepciones relacionadas en el resumen anual se refiera a cantidades satisfechas en concepto de atrasos cuyo devengo o exigibilidad corresponda a ejercicios anteriores al que es objeto de declaración. En tal caso, además de cumplimentar los demás datos que procedan, se reflejarán en este campo las cuatro cifras del ejercicio de devengo.Cuando se hayan satisfecho a un mismo perceptor cantidades cuyo devengo corresponda a diferentes ejercicios, el importe de dichas percepciones, así como el de las retenciones practicadas o el de los ingresos a cuenta efectuados, deberá desglosarse en varios apuntes o registros, de forma que cada uno de ellos refleje exclusivamente percepciones y retenciones o ingresos a cuenta correspondientes a devengos de un mismo ejercicio.\nb) Cuando se incluyan en el modelo 190 los datos relativos a cantidades reintegradas por sus perceptores en el ejercicio, como consecuencia de haber sido indebida o excesivamente percibidas en ejercicios anteriores.\nEn estos supuestos, cada reintegro se relacionará, por su importe íntegro, bajo la misma clave y, en su caso, subclave de percepción bajo la cual se incluyeron en su día las cantidades indebidas o excesivamente satisfechas, reflejando su importe en el campo «Percepción íntegra», «Valoración», o bien «Percepción íntegra derivada de incapacidad laboral» o «Valoración de la percepción en especie derivada de incapacidad laboral», según proceda, cumplimentando el campo «Signo de la percepción íntegra», «Signo de la percepción en especie», o bien el campo «Signo de la percepción íntegra derivada de incapacidad laboral» o «Signo de la percepción en especie derivada de incapacidad laboral» respectivamente, con la letra «N». En estos casos, se consignará también el importe (0) en el campo «Retenciones practicadas», «Ingresos a cuenta efectuados» o bien en los campos «Retenciones practicadas sobre prestaciones derivadas de incapacidad laboral» o «Ingresos a cuenta efectuados por prestaciones en especie derivadas de incapacidad laboral», según proceda, y se hará constar en el campo «Ejercicio devengo» el año en el que se hubieran devengado originariamente las percepciones reintegradas. Adicionalmente, si entre los datos de la percepción reintegrada reflejados en su día en el modelo 190 se hubiera incluido alguna cantidad en concepto de «Reducciones», en el campo «Reducciones aplicables» se hará constar, sin signo, el importe de las mismas que corresponda a la cuantía efectivamente reintegrada.\nCuando se hayan producido reintegros procedentes de una misma persona o entidad que correspondan a percepciones originariamente devengadas en varios ejercicios, su importe deberá desglosarse en varios apuntes o registros, de forma que cada uno de ellos refleje exclusivamente reintegros de percepciones correspondientes a un mismo ejercicio.\nEn cualquier otro caso este campo se rellenara a ceros (0).",
        "partes": [],
        "lon": 4
      },
      {
        "desde": 152,
        "hasta": 152,
        "tipo": "Numérico",
        "nombre": "CEUTA O MELILLA",
        "descripcion": "Se consignará el número 1 en los supuestos en que, por tratarse de rentas obtenidas en Ceuta o Melilla con derecho a la deducción establecida en el artículo 68.4 de la Ley del Impuesto, el pagador hubiera determinado el tipo de retención de acuerdo con lo previsto en los artículos 80.2 y 95.1, último párrafo, del Reglamento del Impuesto.\n153-254\nDATOS ADICIONALES (solo en las claves y subclaves A, B –subclaves 01, 03, 04 y 99–, C, E, F –subclaves 01 a 06–, G –subclaves 01 a 06 y 08–, H, I y L –subclaves 05, 10, 27 y 29–).\nPara cumplimentar estos datos se atenderá a los que hubieran sido comunicados por el perceptor a la persona o entidad pagadora con arreglo a lo dispuesto en el artículo 88 del Reglamento del Impuesto.\nCuando el tipo de retención hubiera sido objeto de regularización por aplicación de lo previsto en el artículo87 del Reglamento del Impuesto, se harán constar los datos que hayan sido tenidos en cuenta a efectos de la misma.\nDe haberse efectuado más de una regularización en el ejercicio, se harán constar los datos correspondientes a la última de ellas.",
        "partes": [],
        "lon": 1
      },
      {
        "desde": 153,
        "hasta": 156,
        "tipo": "Numérico",
        "nombre": "AÑO DE NACIMIENTO",
        "descripcion": "Solo para percepciones correspondientes a las claves A, B.01, B.03, B.04, B.99 y C.\nSe consignarán las cuatro cifras del año de nacimiento del perceptor.",
        "partes": [],
        "lon": 4
      },
      {
        "desde": 157,
        "hasta": 157,
        "tipo": "Numérico",
        "nombre": "SITUACIÓN FAMILIAR",
        "descripcion": "Solo para percepciones correspondientes a las claves A, B.01, B.03, B.04, B.99 y C.\nSe hará constar el dígito numérico indicativo de la situación familiar del perceptor, de acuerdo con la siguiente relación:\n1. Si el perceptor es soltero, viudo, divorciado o separado legalmente con hijos menores de 18 años o mayores incapacitados sujetos a patria potestad prorrogada o rehabilitada, que conviven exclusivamente con él, siempre que tenga, al menos, un hijo o descendiente con derecho a la aplicación del mínimo por descendientes a que se refiere el artículo 58 de la Ley del Impuesto.\n2. Si el perceptor está casado y no separado legalmente y su cónyuge no tiene rentas anuales superiores a la cuantía a la que se refiere la situación 2.ª de las contempladas en el artículo 81.1 del Reglamento del Impuesto.\n3. Si la situación familiar del perceptor es distinta de las anteriores o no deseó manifestarla ante la persona o entidad retenedora.",
        "partes": [],
        "lon": 1
      },
      {
        "desde": 158,
        "hasta": 166,
        "tipo": "Alfanumérico",
        "nombre": "NIF DEL CÓNYUGE / NIF DEL TITULAR DE LA UNIDAD DE CONVIVENCIA",
        "descripcion": "Solo para percepciones correspondientes a las claves A, B.01, B.03, B.04, B.99 y C, o percepciones correspondientes a la Clave L.29.\nEn el caso de percepciones correspondientes a las claves A, B.01, B.03, B.04, B.99 y C: Únicamente en el supuesto de que la “Situación familiar” del perceptor sea la señalada con el número 2, se hará constar el número de identificación fiscal (NIF) de su cónyuge.\nEn el caso de percepciones correspondientes a la clave L.29: Campo de cumplimentación obligatoria cuando el contenido del campo “Titular unidad de convivencia” sea el señalado con el número 2. En este caso, se consignará el número de identificación fiscal (NIF) de la persona física titular de la unidad de convivencia.\nEste campo debe ser distinto al campo “NIF del Declarante” y al campo “NIF del Perceptor”.\nEste campo deberá estar ajustado a la derecha, siendo la última posición el carácter de control y rellenando con ceros las posiciones a la izquierda.\nEn cualquier otro caso este campo se rellenará a espacios.",
        "partes": [],
        "lon": 9
      },
      {
        "desde": 167,
        "hasta": 167,
        "tipo": "Numérico",
        "nombre": "DISCAPACIDAD",
        "descripcion": "Solo para percepciones correspondientes a las claves A, B.01, B.03, B.04, B.99 y C.\nSi el perceptor es una persona con discapacidad que tiene acreditado un grado de discapacidad igual o superior al 33 por 100, se hará constar en este campo el código numérico indicativo de dicho grado. de acuerdo con la siguiente relación:\n0. Si el perceptor no padece ninguna discapacidad o si, padeciéndola, el grado de discapacidad es inferior al 33 por 100.\n1. Si el grado de discapacidad del perceptor es igual o superior al 33 por 100 e inferior al 65 por 100.\n2. Si el grado de discapacidad del perceptor es igual o superior al 33 por 100 e inferior al 65 por 100, siempre que, además, acredite necesitar ayuda de terceras personas o movilidad reducida.\n3. Si el grado de discapacidad del perceptor es igual o superior al 65 por 100.",
        "partes": [],
        "lon": 1
      },
      {
        "desde": 168,
        "hasta": 168,
        "tipo": "Numérico",
        "nombre": "CONTRATO O RELACIÓN",
        "descripcion": "Solo para percepciones correspondientes a la clave A.\nTratándose de empleados por cuenta ajena en activo, se hará constar el dígito numérico indicativo del tipo de contrato o relación existente entre el perceptor y la persona o entidad retenedora, de acuerdo con la siguiente relación:\n1. Contrato o relación de carácter general, que comprenderá todas las situaciones no contempladas en los códigos numéricos siguientes.\n2. Contrato o relación de duración inferior al año y contratos derivados de la relación laboral especial de las personas artistas que desarrollan actividades escénicas, audiovisuales y musicales, así como de quienes desarrollan actividades técnicas o auxiliares necesarias para el desarrollo de dicha actividad, con excepción de los supuestos contemplados en el código 4.\n3. Otras relaciones laborales especiales de carácter dependiente, con excepción de los rendimientos derivados de la relación laboral especial de las personas artistas comprendida en el código 2, así como con excepción de los rendimientos obtenidos por los penados en las instituciones penitenciarias y de las relaciones laborales de carácter especial que afecten a personas con discapacidad, que se considerarán comprendidos en el código 1.\n4. Relación esporádica propia de los trabajadores manuales que perciben sus retribuciones por peonadas o jornales diarios, a que se refiere la regla 2.ª del artículo83.2 del Reglamento del Impuesto.\nCuando en un mismo ejercicio se hayan satisfecho al mismo perceptor cantidades que correspondan a diferentes tipos de contrato o relación, el importe de las percepciones, así como el de las retenciones practicadas o el de los ingresos a cuenta efectuados, deberá desglosarse en varios apuntes o registros, de forma que cada uno de ellos refleje exclusivamente percepciones y retenciones o ingresos a cuenta correspondientes a un mismo tipo de contrato o relación.\nNo obstante, cuando un contrato temporal de duración inferior al año se haya transformado durante el ejercicio en contrato indefinido, el importe total de las percepciones satisfechas, así como el de las retenciones practicadas o el de los ingresos a cuenta efectuados, se reflejará en un único apunte o registro en el cual se hará constar como tipo de contrato o relación el código 1.",
        "partes": [],
        "lon": 1
      },
      {
        "desde": 169,
        "hasta": 169,
        "tipo": "Numérico",
        "nombre": "TITULAR UNIDAD DE CONVIVENCIA",
        "descripcion": "Solo para percepciones correspondientes a la clave L.29.\nSe hará constar en este campo el código numérico indicativo, de acuerdo con la siguiente relación:\n1. Si el perceptor es el titular de la unidad de convivencia.\n2. Si el perceptor no es el titular de la unidad de convivencia. En este caso, deberá cumplimentarse obligatoriamente el campo “NIF del titular de la unidad de convivencia”.",
        "partes": [],
        "lon": 1
      },
      {
        "desde": 170,
        "hasta": 170,
        "tipo": "Numérico",
        "nombre": "MOVILIDAD GEOGRÁFICA",
        "descripcion": "Solo para percepciones correspondientes a la clave A.\nTratándose de empleados por cuenta ajena en activo (percepciones correspondientes a la clave «A») que tengan derecho en el ejercicio al incremento en los gastos deducibles por la obtención de rendimientos del trabajo establecido en el artículo 19.2.f) de la Ley del Impuesto para los supuestos de movilidad geográfica previstos en el citado artículo, se hará constar en esta casilla el número 1. En otro caso se hará constar en este campo el número cero (0).",
        "partes": [],
        "lon": 1
      },
      {
        "desde": 171,
        "hasta": 183,
        "tipo": "Numérico",
        "nombre": "REDUCCIONES APLICABLES",
        "descripcion": "Solo para percepciones correspondientes a las claves A, B.01, B.03, B.04, B.99, C, E, F (subclaves 01 a 06), G (subclaves 01 a 06 y 08), H e I.\nDe haberse incluido entre las percepciones satisfechas al perceptor de que se trate alguna a la que resulte aplicable cualquiera de las reducciones previstas en los apartados 2 y 3 del artículo 18 o en las disposiciones transitorias undécima y duodécima de la Ley del Impuesto, se consignará en esta casilla el importe de dichas reducciones efectivamente considerado por la persona o entidad pagadora (tanto si esta reducción se tiene en cuenta a efectos de determinar el tipo de retención como en aquellos casos en que se apliquen tipos fijos de retención a las prestaciones satisfechas).\nIgualmente, se consignará en esta casilla el importe de la reducción aplicable a efectos de la determinación del rendimiento neto de la actividad, en el caso de haberse incluido entre las prestaciones satisfechas al perceptor de que se trate alguna prestación a la que resulte aplicable la reducción prevista en el apartado 1 del artículo 32 de la Ley del Impuesto.\nLos importes deben consignarse en euros.\nEste campo se subdivide en dos:",
        "partes": [
          {
            "desde": 171,
            "hasta": 181,
            "texto": "Parte entera del importe de las reducciones, si no tiene contenido se consignará a ceros."
          },
          {
            "desde": 182,
            "hasta": 183,
            "texto": "Parte decimal del importe de las reducciones, si no tiene contenido se consignará a ceros."
          }
        ],
        "lon": 13
      },
      {
        "desde": 184,
        "hasta": 196,
        "tipo": "Numérico",
        "nombre": "GASTOS DEDUCIBLES",
        "descripcion": "Solo para percepciones correspondientes a las claves A, B.01, B.03, B.04, B.99, C, E.01 y E.02.\nSe consignará, sin signo y sin coma decimal, el importe anual efectivamente considerado por la persona o entidad pagadora a efectos de determinar el tipo de retención, por los conceptos de gastos a que se refieren las letras a), b) yc) del artículo 19.2 de la Ley del Impuesto (cotizaciones a la Seguridad Social o a mutualidades generales obligatorias de funcionarios, detracciones por derechos pasivos y cotizaciones a Colegios de huérfanos o entidades similares).\nEn el caso de retribuciones correspondientes a la claveE.01 y E.02, se consignarán las cotizaciones a la Seguridad Social que hayan sido deducidas por el pagador de los rendimientos del trabajo satisfechos por este concepto. Los importes deben consignarse en euros.\nExcepcionalmente, este campo también podrá tener contenido en aquellas percepciones correspondientes a las claves L.05, L.10 y L.27 de las que, pese a estar exentas del IRPF, se hayan detraído cantidades por los citados conceptos que tengan la consideración de gastos deducibles para el perceptor.\nEste campo se subdivide en dos:",
        "partes": [
          {
            "desde": 184,
            "hasta": 194,
            "texto": "Parte entera del importe de los gastos, si no tiene contenido se consignará a ceros."
          },
          {
            "desde": 195,
            "hasta": 196,
            "texto": "Parte decimal del importe de los gastos, si no tiene contenido se consignará a ceros."
          }
        ],
        "lon": 13
      },
      {
        "desde": 197,
        "hasta": 209,
        "tipo": "Numérico",
        "nombre": "PENSIONES COMPENSATORIAS",
        "descripcion": "Solo para percepciones correspondientes a las claves A, B.01, B.03, B.04, B.99 y C.\nSe consignará, sin signo y sin coma decimal, el importe anual de la pensión compensatoria que, en su caso, el perceptor estuviese obligado a satisfacer a su cónyuge por resolución judicial.\nEn cualquier otro caso este campo se rellenará a ceros (0).\nLos importes deben consignarse en euros. Este campo se subdivide en dos:",
        "partes": [
          {
            "desde": 197,
            "hasta": 207,
            "texto": "Parte entera del importe de la pensión compensatoria al cónyuge, si no tiene contenido se consignará a ceros."
          },
          {
            "desde": 208,
            "hasta": 209,
            "texto": "Parte decimal del importe de la pensión compensatoria al cónyuge, si no tiene contenido se consignará a ceros."
          }
        ],
        "lon": 13
      },
      {
        "desde": 210,
        "hasta": 222,
        "tipo": "Numérico",
        "nombre": "ANUALIDADES POR ALIMENTOS",
        "descripcion": "Solo para percepciones correspondientes a las claves A, B.01, B.03, B.04, B.99 y C.\nSe consignará, sin signo y sin coma decimal, el importe anual de las anualidades por alimentos que, en su caso, el perceptor estuviese obligado a satisfacer a favor de sus hijos por decisión judicial.\nEn cualquier otro caso este campo se rellenará a ceros (0).\nLos importes deben consignarse en euros. Este campo se subdivide en dos:",
        "partes": [
          {
            "desde": 210,
            "hasta": 220,
            "texto": "Parte entera del importe de las anualidades por alimentos a hijos, si no tiene contenido se consignará a ceros."
          },
          {
            "desde": 221,
            "hasta": 222,
            "texto": "Parte decimal del importe de las anualidades por alimentos a hijos, si no tiene contenido se consignará a ceros."
          }
        ],
        "lon": 13
      },
      {
        "desde": 223,
        "hasta": 228,
        "tipo": "Numérico",
        "nombre": "HIJOS Y OTROS DESCENDIENTES",
        "descripcion": "Solo para percepciones correspondientes a las claves A, B.01, B.03, B.04, B.99 y C.\nDatos referidos a los hijos y demás descendientes del perceptor por los que éste tenga derecho a la aplicación del mínimo por descendientes previsto en el artículo 58 de la Ley del Impuesto.\nEste campo se subdivide en cuatro:\nEn cualquier otro caso este campo se rellenará a ceros (0).\nEn cualquier otro caso este campo se rellenará a ceros (0).\nEn cualquier otro caso este campo se rellenará a ceros (0).\nEn cualquier otro caso este campo se rellenará a ceros (0).",
        "partes": [
          {
            "desde": 223,
            "hasta": 223,
            "texto": "«< 3 años. N.º Total»: Número de descendientes del perceptor que, dando derecho a éste al mínimo por descendientes, sean menores de 3 años de edad el 31 de diciembre del ejercicio al que corresponda la declaración. Los hijos adoptados y los acogidos se computarán en este campo siempre que la adopción o el acogimiento haya tenido lugar en el ejercicio al que corresponda la declaración o en los dos ejercicios anteriores."
          },
          {
            "desde": 224,
            "hasta": 224,
            "texto": "«< 3 años. Por entero»: Se indicará, en su caso, el número de los descendientes menores de 3 años (posición223) que han sido computados por entero a efectos de determinar el tipo de retención."
          },
          {
            "desde": 225,
            "hasta": 226,
            "texto": "«Resto. N.º Total»: Número de los demás descendientes del perceptor que, dando derecho a la aplicación del mínimo por descendientes, no estén incluidos en el campo «< 3 años»."
          },
          {
            "desde": 227,
            "hasta": 228,
            "texto": "«Resto. Por entero»: se indicará, en su caso, el número de los descendientes anteriores (posición 225-226) que han sido computados por entero a efectos de determinar el tipo de retención."
          }
        ],
        "lon": 6
      },
      {
        "desde": 229,
        "hasta": 240,
        "tipo": "Numérico",
        "nombre": "HIJOS Y OTROS DESCENDIENTES CON DISCAPACIDAD",
        "descripcion": "Solo para percepciones correspondientes a las claves A, B.01, B.03, B.04, B.99 y C.\nDatos relativos a los descendientes del perceptor que, habiendo sido incluidos en alguno de los campos anteriores (posiciones 223-228) por dar derecho a éste a la aplicación del mínimo por descendientes previsto en el artículo 58 de la Ley del Impuesto, den también derecho al mínimo por discapacidad de descendientes contemplado en el artículo 60.2 de la citada Ley, por tratarse de personas con discapacidad que tienen acreditado un grado de discapacidad igual o superior al 33 por 100.\nEste campo se subdivide en seis:\nEn cualquier otro caso este campo se rellenará a ceros (0).\nEn cualquier otro caso este campo se rellenará a ceros (0).",
        "partes": [
          {
            "desde": 229,
            "hasta": 230,
            "texto": "«≥ 33% y < 65%. N.º Total»: Número de descendientes discapacitados cuyo grado de discapacidad sea igual o superior al 33 por 100 e inferior al 65 por 100. En cualquier otro caso este campo se rellenará a ceros (0)."
          },
          {
            "desde": 231,
            "hasta": 232,
            "texto": "«≥ 33% y < 65%. Por entero»: se indicará, en su caso, el número de los descendientes anteriores (posiciones 229-230) que han sido computados por entero a efectos de determinar el tipo de retención."
          },
          {
            "desde": 233,
            "hasta": 234,
            "texto": "«Movilidad Reducida. N.º Total»: Número de descendientes discapacitados que, habiendo sido incluidos en el campo «≥ 33% Y < 65%» anterior (posiciones 229-230) por tener un grado de discapacidad igual o superior al 33 por 100 e inferior al 65 por 100, acrediten, además, necesitar ayuda de terceras personas o movilidad reducida. En cualquier otro caso este campo se rellenará a ceros (0)."
          },
          {
            "desde": 235,
            "hasta": 236,
            "texto": "«Movilidad Reducida. Por entero»: Se indicará, en su caso, el número de los descendientes anteriores (posiciones 233-234) que han sido computados por entero a efectos de determinar el tipo de retención."
          },
          {
            "desde": 237,
            "hasta": 238,
            "texto": "«≥ 65%. N.º Total»: Número de descendientes discapacitados cuyo grado de discapacidad sea igual o superior al 65 por 100. En cualquier otro caso este campo se rellenará a ceros (0)."
          },
          {
            "desde": 239,
            "hasta": 240,
            "texto": "«≥ 65%. Por entero»: Se indicará, en su caso, el número de los descendientes anteriores (posiciones 237-238) que han sido computados por entero a efectos de determinar el tipo de retención. En cualquier otro caso este campo se rellenará a ceros (0)."
          }
        ],
        "lon": 12
      },
      {
        "desde": 241,
        "hasta": 244,
        "tipo": "Numérico",
        "nombre": "ASCENDIENTES",
        "descripcion": "Solo para percepciones correspondientes a las claves A, B.01, B.03, B.04, B.99 y C.\nDatos referidos a los ascendientes del perceptor por los que éste tenga derecho a la aplicación de la reducción por edad prevista en el artículo 59 de la Ley del Impuesto.\nEste campo se subdivide en cuatro:",
        "partes": [
          {
            "desde": 241,
            "hasta": 241,
            "texto": "«< 75 años. N.º Total»: Número de ascendientes del perceptor que tengan menos de 75 años de edad el 31 de diciembre del ejercicio al que corresponda la declaración. En cualquier otro caso este campo se rellenará a ceros (0)."
          },
          {
            "desde": 242,
            "hasta": 242,
            "texto": "«< 75 años. Por entero»: Se indicará, en su caso, el número de los ascendientes anteriores (posición 241) que han sido computados por entero a efectos de determinar el tipo de retención.En cualquier otro caso este campo se rellenará a ceros (0)."
          },
          {
            "desde": 243,
            "hasta": 243,
            "texto": "«≥ 75 años. N.º Total»: Número total de ascendientes del perceptor que tengan 75 o más años de edad el 31 de diciembre del ejercicio al que corresponda la declaración. En cualquier otro caso este campo se rellenará a ceros (0)."
          },
          {
            "desde": 244,
            "hasta": 244,
            "texto": "«≥ 75 años. Por entero»: se indicará, en su caso, el número de los ascendientes anteriores (posición 243) que han sido computados por entero a efectos de determinar el tipo de retención.En cualquier otro caso este campo se rellenará a ceros (0)."
          }
        ],
        "lon": 4
      },
      {
        "desde": 245,
        "hasta": 250,
        "tipo": "Numérico",
        "nombre": "ASCENDIENTES CON DISCAPACIDAD",
        "descripcion": "Solo para percepciones correspondientes a las claves A, B.01, B.03, B.04, B.99 y C.\nDatos relativos a los ascendientes del perceptor que, habiendo sido incluidos en alguna de las casillas anteriores por dar derecho a éste a la aplicación del mínimo por ascendientes previsto en el artículo 59 de la Ley del Impuesto, den también derecho al mínimo por discapacidad de ascendientes contemplado en el artículo60.2 de la citada Ley, por tratarse de personas con discapacidad que tienen acreditado un grado de discapacidad igual o superior al 33 por 100.\nEste campo se subdivide en seis:\nsuperior al 33 por 100 e inferior al 65 por 100. En cualquier otro caso este campo se rellenará a ceros (0).",
        "partes": [
          {
            "desde": 245,
            "hasta": 245,
            "texto": "«≥ 33% y < 65%. N.º Total»: Número de ascendientes discapacitados cuyo grado de discapacidad sea igual o"
          },
          {
            "desde": 246,
            "hasta": 246,
            "texto": "«≥ 33% y < 65%. Por entero»: se indicará, en su caso, el número de los ascendientes anteriores (posición 245) que han sido computados por entero a efectos de determinar el tipo de retención. En cualquier otro caso este campo se rellenará a ceros (0)."
          },
          {
            "desde": 247,
            "hasta": 247,
            "texto": "«Movilidad Reducida. N.º Total»: Número de ascendientes discapacitados que, habiendo sido incluidos en el campo «≥ 33% y < 65%» anterior (posición 245) por tener un grado de discapacidad igual o superior al 33 por 100 e inferior al 65 por 100, acrediten, además, necesitar ayuda de terceras personas o movilidad reducida. En cualquier otro caso este campo se rellenará a ceros (0)."
          },
          {
            "desde": 248,
            "hasta": 248,
            "texto": "«Movilidad Reducida. Por entero»: Se indicará, en su caso, el número de los ascendientes anteriores (posición247) que han sido computados por entero a efectos de determinar el tipo de retención. En cualquier otro caso este campo se rellenará a ceros (0)."
          },
          {
            "desde": 249,
            "hasta": 249,
            "texto": "«≥ 65%. N.º Total»: Número de ascendientes discapacitados cuyo grado de discapacidad sea igual o superior al 65 por 100. En cualquier otro caso este campo se rellenará a ceros (0)."
          },
          {
            "desde": 250,
            "hasta": 250,
            "texto": "«≥ 65%. Por entero»: Se indicará, en su caso, el número de los ascendientes anteriores (posición 249) que han sido computados por entero a efectos de determinar el tipo de retención. En cualquier otro caso este campo se rellenará a ceros (0)."
          }
        ],
        "lon": 6
      },
      {
        "desde": 251,
        "hasta": 253,
        "tipo": "Numérico",
        "nombre": "CÓMPUTO DE LOS 3 PRIMEROS HIJOS",
        "descripcion": "Solo para percepciones correspondientes a las claves A, B.01, B.03, B.04, B.99 y C.\nDatos referidos a la proporción en la que ha sido computado a efectos de determinar el tipo de retención cada uno de los tres primeros hijos o descendientes del perceptor, ordenados de mayor a menor según su edad, de los previamente incluidos en los campos «< 3 años. N.º Total» (posición 223) y «Resto. N.º Total» (posiciones 225- 226).\nEste campo se subdivide en tres:\n1: Computado por entero.\n2: Computado por mitad.\n1: Computado por entero.\n2: Computado por mitad.\n1: Computado por entero.\n2: Computado por mitad.\nEn cualquier otro caso estos campos se rellenaran a ceros (0).",
        "partes": [
          {
            "desde": 251,
            "hasta": 251,
            "texto": "«Hijo 1.º»: Se indicará si el primer hijo ha sido computado por entero o por mitad a efectos de determinar el tipo de retención, de acuerdo a los siguientes valores:"
          },
          {
            "desde": 252,
            "hasta": 252,
            "texto": "«Hijo 2.º»: Se indicará si el segundo hijo ha sido computado por entero o por mitad a efectos de determinar el tipo de retención, de acuerdo a los siguientes valores:"
          },
          {
            "desde": 253,
            "hasta": 253,
            "texto": "«Hijo 3.º»: Se indicará si el tercer hijo ha sido computado por entero o por mitad a efectos de determinar el tipo de retención, de acuerdo a los siguientes valores:"
          }
        ],
        "lon": 3
      },
      {
        "desde": 254,
        "hasta": 254,
        "tipo": "Numérico",
        "nombre": "COMUNICACIÓN PRÉSTAMOS VIVIENDA HABITUAL",
        "descripcion": "Solo para percepciones correspondientes a las claves A, B.01, B.03, B.04, B.99 y C.\nEn función de si en algún momento del ejercicio ha resultado de aplicación la reducción del tipo de retención prevista en el artículo 86.1, último párrafo, del Reglamento del Impuesto, por haber comunicado el perceptor que está destinando cantidades a la adquisición o rehabilitación de su vivienda habitual por las que vaya a tener derecho a la deducción por vivienda habitual regulada en la disposición transitoria decimoctava de la Ley del Impuesto y por cumplirse los demás requisitos establecidos al efecto, se consignará en este campo la clave que en cada caso proceda de las dos siguientes:\n0: Si en ningún momento del ejercicio ha resultado de aplicación la reducción del tipo de retención.1: Si en algún momento del ejercicio ha resultado de aplicación la reducción del tipo de retención.",
        "partes": [],
        "lon": 1
      },
      {
        "desde": 255,
        "hasta": 281,
        "tipo": "Alfanumérico",
        "nombre": "PERCEPCIONES DINERARIAS DERIVADAS DE INCAPACIDAD LABORAL",
        "descripcion": "Solo para percepciones correspondientes a las claves A y B.01.\nEste campo se subdivide en tres:\nCuando la prestación dineraria por incapacidad laboral sea satisfecha por el empleador en virtud del respectivo acuerdo de colaboración con la Seguridad Social (ya sea esta colaboración de carácter voluntario u obligatorio), se hará constar en el campo «Clave de percepción» la clave «A». En otro caso, estas percepciones se reflejarán en la\nClave «B», subclave 01.\nLos importes deben consignarse en euros. Este campo se subdivide en dos:\nSi algún perceptor no ha sufrido retención, este campo se consignará relleno a ceros.\nLos importes deben consignarse en euros.\nEste campo se subdivide en dos:",
        "partes": [
          {
            "desde": 255,
            "hasta": 255,
            "texto": "SIGNO DE LA PERCEPCIÓN ÍNTEGRA DERIVADADE INCAPACIDAD LABORAL: Se cumplimentará este campo cuando las percepciones correspondan a cantidades reintegradas por el perceptor en el ejercicio, como consecuencia de haber sido indebida o excesivamente percibidas en ejercicios anteriores. En este caso se consignará una «N», en cualquier otro caso el contenido de este campo será un espacio."
          },
          {
            "desde": 256,
            "hasta": 268,
            "texto": "PERCEPCIÓN ÍNTEGRA (Dineraria) DERIVADADE INCAPACIDAD LABORAL: Campo numérico de 13 posiciones. Se hará constar, sin signo y sin coma decimal, el importe íntegro anual de las percepciones dinerarias en concepto de incapacidad laboral abonadas directamente por el pagador al trabajador."
          },
          {
            "desde": 256,
            "hasta": 266,
            "texto": "Parte entera del importe de la percepción íntegra. Si no tiene contenido se consignará a ceros.267-268 Parte decimal del importe de la percepción íntegra. Si no tiene contenido se consignará a ceros."
          },
          {
            "desde": 269,
            "hasta": 281,
            "texto": "RETENCIONES PRACTICADAS SOBRE PRESTACIONES DERIVADAS DE INCAPACIDAD LABORAL: Campo numérico de 13 posiciones. Se consignará, sin signo y sin coma decimal, el importe anual efectivamente retenido a cuenta del Impuesto sobre la Renta de las Personas Físicas en relación con las percepciones dinerarias derivadas de incapacidad laboral consignadas en el campo anterior."
          },
          {
            "desde": 269,
            "hasta": 279,
            "texto": "Parte entera del importe de las retenciones practicadas. Si no tiene contenido se consignará a ceros. 280-281 Parte decimal del importe de las retenciones practicadas. Si no tiene contenido se consignará a ceros."
          }
        ],
        "lon": 27
      },
      {
        "desde": 282,
        "hasta": 321,
        "tipo": "Alfanumérico",
        "nombre": "PERCEPCIONES EN ESPECIE DERIVADAS DE INCAPACIDAD LABORAL",
        "descripcion": "Solo para percepciones correspondientes a la clave A. Este campo se subdivide en cuatro:\nEn este caso se consignará una «N»; en cualquier otro caso el contenido de este campo será un espacio.\nCampo numérico de 13 posiciones.\nCuando, en virtud del respectivo acuerdo de colaboración con la Seguridad Social (ya sea esta colaboración de carácter voluntario u obligatorio), el empleador satisfaga prestaciones por incapacidad laboral en forma excepcional de prestaciones en especie, se harán constar en este campo, sin signo y sin coma decimal, la suma de las valoraciones correspondientes a dichas percepciones en especie derivadas de incapacidad laboral efectivamente satisfechas en el ejercicio al perceptor de que se trate,\ndeterminadas con arreglo a lo establecido en el artículo 43 de la Ley del Impuesto y sin incluir en ningún caso el importe del ingreso a cuenta, haciendo constar en el campo «Clave de percepción» la clave «A».\nLos importes deben consignarse en euros. Este campo se subdivide en dos:\nLos importes deben consignarse en euros. Este campo se subdivide en dos:\nLos importes deben consignarse en euros. Este campo se subdivide en dos:",
        "partes": [
          {
            "desde": 282,
            "hasta": 282,
            "texto": "SIGNO DE LA PERCEPCIÓN EN ESPECIE DERIVADA DE INCAPACIDAD LABORAL: Se cumplimentará este campo cuando el perceptor reintegre en este ejercicio percepciones en especie derivadas de incapacidad laboral, como consecuencia de haber sido indebida o excesivamente percibidas en ejercicios anteriores."
          },
          {
            "desde": 283,
            "hasta": 295,
            "texto": "VALORACIÓN DE LA PERCEPCIÓN EN ESPECIE DERIVADA DE INCAPACIDAD LABORAL:"
          },
          {
            "desde": 283,
            "hasta": 293,
            "texto": "Parte entera del importe de la valoración; si no tiene contenido, se consignará a ceros."
          },
          {
            "desde": 294,
            "hasta": 295,
            "texto": "Parte decimal del importe de la valoración; si no tiene contenido, se consignará a ceros."
          },
          {
            "desde": 296,
            "hasta": 308,
            "texto": "INGRESOS A CUENTA EFECTUADOS POR PRESTACIONES EN ESPECIE DERIVADAS DE INCAPACIDAD LABORAL: Campo numérico de 13 posiciones. Se consignará, sin signo y sin coma decimal, el importe anual efectivamente ingresado a cuenta por el pagador en relación con las percepciones en especie derivadas de incapacidad laboral consignadas en el campo anterior."
          },
          {
            "desde": 296,
            "hasta": 306,
            "texto": "Parte entera del importe de los ingresos a cuenta efectuados; si no tiene contenido se consignará a ceros."
          },
          {
            "desde": 307,
            "hasta": 308,
            "texto": "Parte decimal del importe de los ingresos a cuenta efectuados; si no tiene contenido se consignará a ceros."
          },
          {
            "desde": 309,
            "hasta": 321,
            "texto": "INGRESOS A CUENTA REPERCUTIDOS POR PRESTACIONES EN ESPECIE DERIVADAS DE INCAPACIDAD LABORAL: Campo numérico de 13 posiciones. Se consignará, sin signo y sin coma decimal, el importe anual de los ingresos a cuenta efectuados que, en su caso, el pagador de las retribuciones en especie derivadas de incapacidad laboral hubiera repercutido al perceptor."
          },
          {
            "desde": 309,
            "hasta": 319,
            "texto": "Parte entera del importe de los ingresos a cuenta repercutidos; si no tiene contenido se consignará a ceros."
          },
          {
            "desde": 320,
            "hasta": 321,
            "texto": "Parte decimal del importe de los ingresos a cuenta repercutidos; si no tiene contenido se consignará a ceros."
          }
        ],
        "lon": 40
      },
      {
        "desde": 322,
        "hasta": 322,
        "tipo": "Numérico",
        "nombre": "COMPLEMENTO AYUDA PARA LA INFANCIA",
        "descripcion": "Dato adicional, exclusivamente para percepciones correspondientes a la clave L.29.\nSe hará constar obligatoriamente en este campo el código numérico indicativo, de acuerdo con la siguiente relación:\n1. Si la prestación incluye, en cualquiera de las mensualidades satisfechas en el ejercicio, cuantías correspondientes al complemento de ayuda para la infancia previsto en la Ley 19/2021, de 20 de diciembre, por la que se establece el ingreso mínimo vital.\n2. Si la prestación no incluye, en cualquiera de las mensualidades satisfechas en el ejercicio, cuantías correspondientes al complemento de ayuda para la infancia previsto en la Ley 19/2021, de 20 de diciembre, por la que se establece el ingreso mínimo vital.",
        "partes": [],
        "lon": 1
      },
      {
        "desde": 388,
        "hasta": 388,
        "tipo": "Numérico",
        "nombre": "EXCESOS ENTREGA ACCIONES EMPRESAS EMERGENTES",
        "descripcion": "Excesos entrega acciones empresas emergentes.\nSolo para percepciones correspondientes a la clave “A”.\nEste campo solamente se deberá cumplimentar en caso de que el campo “Percepciones en especie no derivadas de incapacidad laboral” (posiciones 108-147) tenga contenido. En este caso se hará constar en este campo el código numérico que corresponda de acuerdo con la siguiente relación:\n1. Si la cuantía total de la valoración de la percepción en especie incluye, aunque sea de forma parcial, retribuciones en especie consistentes en la entrega de acciones o participaciones a los trabajadores de una empresa emergente a las que se refiere la Ley 28/2022, de 21 de diciembre, de fomento del ecosistema de las empresas emergentes, que superen el importe exento al que se refiere el párrafo segundo de la letra f) del artículo 42.3 de la Ley del Impuesto; y\n0. En el resto de supuestos de retribuciones en especie.",
        "partes": [],
        "lon": 1
      },
      {
        "desde": 389,
        "hasta": 389,
        "tipo": "Numérico",
        "nombre": "Solo para percepciones correspondientes a la clave \"A\"",
        "descripcion": "Este campo solamente se deberá cumplimentar en caso de que el campo «Percepciones dinerarias no derivadas de incapacidad laboral» (posiciones 81 – 107) y/o en el campo \"Percepciones en especie no derivadas de incapacidad laboral\" (posiciones 108 – 147) incluyan, aunque sea de forma parcial, rendimientos del trabajo derivados directa o indirectamente de participaciones, acciones u otros derechos, incluidas comisiones de éxito, que otorguen derechos económicos especiales a los que se haya aplicado lo dispuesto en el apartado 3 de la disposición adicional quincuagésima tercera de la Ley 35/2006, de 28 de noviembre.\nEn este caso se hará constar en este campo el código numérico que corresponda de acuerdo con la siguiente relación:\n1. Si la cuantía total de la percepción dineraria o la cuantía total de la valoración de la percepción en especie incluye, aunque sea de forma parcial, rendimientos del trabajo derivados directa o indirectamente de participaciones, acciones u otros derechos, incluidas comisiones de éxito, que otorguen derechos económicos especiales a los que se haya aplicado lo dispuesto en el apartado 3 de la disposición adicional quincuagésima tercera a las que se refiere la Ley 35/2006, de 28 de noviembre, y\n0. En el resto de supuestos.",
        "partes": [],
        "lon": 1
      },
      {
        "desde": 390,
        "hasta": 394,
        "tipo": "Numérico",
        "nombre": "Solo para percepciones correspondientes a la clave B, subclave 01",
        "descripcion": "Dato adicional, obligatorio para percepciones correspondientes a la clave B.01.\nCuando se satisfagan prestaciones de la clave B, subclave 01, la entidad pagadora deberá identificar con el indicativo \"1\" los distintos tipos de prestación satisfechos al perceptor a lo largo del ejercicio, aunque tales prestaciones hayan sido satisfechas únicamente durante una parte del mismo. Se consignará \"0\", respecto de aquellos tipos de prestaciones no satisfechas. Es decir, se consignará obligatoriamente \"1\" ó \"0\" en cada una de las posiciones (389 – 393), de acuerdo con la siguiente relación:\nEste campo se divide en cinco:",
        "partes": [],
        "lon": 5
      },
      {
        "desde": 395,
        "hasta": 500,
        "tipo": "Blancos",
        "nombre": "BLANCOS",
        "descripcion": "* Todos los importes serán positivos.\n* Los campos numéricos que no tengan contenido se rellenarán a ceros.\n* Los campos alfanuméricos/alfabéticos que no tengan contenido se rellenarán a blancos.\n* Todos los campos numéricos ajustados a la derecha y rellenos de ceros por la izquierda.\n* Todos los campos alfanuméricos/alfabéticos ajustados a la izquierda y rellenos de blancos por la derecha, en mayúsculas, sin caracteres especiales y sin vocales acentuadas, excepto que se especifique lo contrario en la descripción del campo.\nSe modifica y pasa a denominarse Anexo por el art. 2.2 a 9 de la Orden HAC/1431/2025, de 3 de diciembre. Ref. BOE-A-2025-25390\nSu anterior denominación era Anexo II.\nEsta modificación será aplicable por primera vez para la presentación del modelo 190 correspondiente al ejercicio 2025 y siguientes.\n",
        "partes": [],
        "lon": 106
      }
    ]
  },
  "sinDescribir": {
    "1": [],
    "2": [
      {
        "desde": 323,
        "hasta": 387
      }
    ]
  },
  "provincias": [
    {
      "codigo": "01",
      "nombre": "ÁLAVA/ARABA",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "02",
      "nombre": "ALBACETE",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "03",
      "nombre": "ALICANTE/ALACANT",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "04",
      "nombre": "ALMERÍA",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "05",
      "nombre": "ÁVILA",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "06",
      "nombre": "BADAJOZ",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "07",
      "nombre": "ILLES BALEARS",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "08",
      "nombre": "BARCELONA",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "09",
      "nombre": "BURGOS",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "10",
      "nombre": "CÁCERES",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "11",
      "nombre": "CÁDIZ",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "12",
      "nombre": "CASTELLÓN/CASTELLÓ",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "13",
      "nombre": "CIUDAD REAL",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "14",
      "nombre": "CÓRDOBA",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "15",
      "nombre": "CORUÑA, A",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "16",
      "nombre": "CUENCA",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "17",
      "nombre": "GIRONA",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "18",
      "nombre": "GRANADA",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "19",
      "nombre": "GUADALAJARA",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "20",
      "nombre": "GUIPÚZCOA/GIPUZKOA",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "21",
      "nombre": "HUELVA",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "22",
      "nombre": "HUESCA",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "23",
      "nombre": "JAÉN",
      "fuente": "versión · vigente desde 2022-12-20 · BOE-A-2022-21459 (anexo II anterior: falta en la tabla vigente)"
    },
    {
      "codigo": "24",
      "nombre": "LEÓN",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "25",
      "nombre": "LLEIDA",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "26",
      "nombre": "RIOJA, LA",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "27",
      "nombre": "LUGO",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "28",
      "nombre": "MADRID",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "29",
      "nombre": "MÁLAGA",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "30",
      "nombre": "MURCIA",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "31",
      "nombre": "NAVARRA",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "32",
      "nombre": "OURENSE",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "33",
      "nombre": "ASTURIAS",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "34",
      "nombre": "PALENCIA",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "35",
      "nombre": "PALMAS, LAS",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "36",
      "nombre": "PONTEVEDRA",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "37",
      "nombre": "SALAMANCA",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "38",
      "nombre": "S.C. DE TENERIFE (a excepción de isla de la Palma)",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "39",
      "nombre": "CANTABRIA",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "40",
      "nombre": "SEGOVIA",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "41",
      "nombre": "SEVILLA",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "42",
      "nombre": "SORIA",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "43",
      "nombre": "TARRAGONA",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "44",
      "nombre": "TERUEL",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "45",
      "nombre": "TOLEDO",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "46",
      "nombre": "VALENCIA",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "47",
      "nombre": "VALLADOLID",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "48",
      "nombre": "VIZCAYA/BIZKAIA",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "49",
      "nombre": "ZAMORA",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "50",
      "nombre": "ZARAGOZA",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "51",
      "nombre": "CEUTA",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "52",
      "nombre": "MELILLA",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "53",
      "nombre": "ISLA DE LA PALMA",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    },
    {
      "codigo": "98",
      "nombre": "RESIDENTES EN EL EXTRANJERO (artículos 8.2 y 10 de la Ley)",
      "fuente": "versión · vigente desde 2025-12-13 · BOE-A-2025-25390"
    }
  ]
} as const satisfies {
  boe: string; vigenteDesde: string; sha256: string; longitud: number
  registros: Record<'1' | '2', readonly CampoDr190[]>; sinDescribir: Record<'1' | '2', readonly { desde: number; hasta: number }[]>
  provincias: readonly ProvinciaDr190[]
}
