/**
 * Generates the fictional demo regulation PDFs in examples/demo-monomarca/.
 *
 * Usage: node scripts/make-demo-pdfs.ts
 *
 * The text is original and fictional. The output is deterministic (no dates or
 * random identifiers), so regenerating produces byte-identical files.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface PageSpec {
  heading: string;
  lines: string[];
}

interface DocumentSpec {
  file: string;
  title: string;
  pages: PageSpec[];
}

const NOTICE = 'Documento ficticio de demostración de SpecGarage. No es un reglamento real.';

const technical: DocumentSpec = {
  file: 'demo-reglamento-tecnico.pdf',
  title: 'REGLAMENTO TÉCNICO - COPA DEMO MONOMARCA 2026',
  pages: [
    {
      heading: 'Disposiciones generales',
      lines: [
        'A: Concurrentes y mecánicos deben conocer este reglamento y el reglamento deportivo.',
        'B: Todo elemento no mencionado expresamente como autorizado se considera prohibido.',
        'C: Este reglamento rige del 1-01-2026 al 31-12-2026. Los cambios se comunican',
        '   mediante anexos oficiales de la categoría.',
        'D: La categoría es monomarca: todos los autos comparten modelo y componentes base.',
        '',
        'Contenido: 2-Chasis  3-Trocha delantera  4-Trocha trasera  5-Peso  7-Neumáticos',
        '8-Adquisición de datos  9-Verificación previa  10-Numeración  11-Frenos',
        '12-Combustible  13-Seguridad  14-Señalización electrónica  15-Interpretación',
      ],
    },
    {
      heading: 'Chasis y dimensiones',
      lines: [
        '2- CHASIS: La distancia entre ejes debe estar entre 2495 y 2505 mm, ambos incluidos.',
        'La medición se realiza con el auto en reposo sobre una superficie plana.',
        '',
        '3- TROCHA DELANTERA: 1660 mm como máximo.',
        '',
        '4- TROCHA TRASERA: 1648 mm como máximo.',
        '',
        'Las trochas se miden con el auto en reposo sobre una superficie plana.',
      ],
    },
    {
      heading: 'Peso y neumáticos',
      lines: [
        '5- PESO: El peso mínimo del auto con el piloto a bordo, equipado y en posición de',
        'carrera, es de 1090 kg. El pesaje se realiza en una balanza sobre superficie plana',
        'y nivelada.',
        '',
        '7- NEUMÁTICOS',
        '7-A: Se usan únicamente los neumáticos de la especificación provista por la categoría.',
        '7-B: La profundidad mínima de dibujo en la banda central es de 2,0 mm.',
      ],
    },
    {
      heading: 'Datos, verificación previa y precintos',
      lines: [
        '8- ADQUISICIÓN DE DATOS: Solo se permite el sistema de adquisición de datos',
        'autorizado por la categoría. Cualquier otro GPS o sistema de telemetría está prohibido.',
        '',
        '9- VERIFICACIÓN TÉCNICA PREVIA: Antes de la clasificación cada auto se presenta en la',
        'verificación técnica. Sin este trámite el auto no está habilitado para competir.',
        'Se precinta el motor; el precinto debe estar íntegro y con su numeración registrada.',
      ],
    },
    {
      heading: 'Numeración, frenos y combustible',
      lines: [
        '10- NUMERACIÓN: Las cifras del número de competición son amarillas sobre un rectángulo',
        'negro. La altura mínima de las cifras es de 20 cm.',
        '',
        '11- FRENOS: Los discos y las pastillas deben ser originales del modelo. El espesor',
        'mínimo de la pastilla es de 3,5 mm.',
        '',
        '12- COMBUSTIBLE: Es provisto por la categoría. La densidad de la muestra, medida a',
        '15 °C, debe estar entre 725 y 770 g/l, ambos incluidos.',
      ],
    },
    {
      heading: 'Seguridad, señalización e interpretación',
      lines: [
        '13- SEGURIDAD: El extintor debe estar cargado, fijado al auto y con la carga vigente.',
        'Los cinturones de seguridad deben estar dentro de su fecha de vencimiento.',
        '',
        '14- SEÑALIZACIÓN ELECTRÓNICA: Es obligatorio el dispositivo electrónico de señalización',
        'de la categoría, instalado de forma segura y visible para el piloto.',
        '',
        '15- INTERPRETACIÓN: Los casos no previstos los resuelve la comisión técnica.',
      ],
    },
  ],
};

const sporting: DocumentSpec = {
  file: 'demo-reglamento-deportivo.pdf',
  title: 'REGLAMENTO DEPORTIVO - COPA DEMO MONOMARCA 2026',
  pages: [
    {
      heading: 'Alcance y calendario',
      lines: [
        '1. La Copa Demo Monomarca es un torneo ficticio usado para demostrar SpecGarage.',
        '2. Vigencia: 1-01-2026 al 31-12-2026.',
        '3. Calendario: Fecha 1 (15-03), Fecha 2 (19-04), Fecha 3 (24-05).',
      ],
    },
    {
      heading: 'Números de competición',
      lines: [
        '5. Cada auto lleva el número que le asigna la categoría, en los lugares establecidos.',
        'Los números no se modifican durante el torneo.',
      ],
    },
    {
      heading: 'Dispositivos obligatorios',
      lines: [
        '7-A: El dispositivo electrónico de señalización debe estar instalado de forma segura',
        'y a la vista del piloto, sin elementos que obstruyan la señal.',
        '7-B: Es obligatoria la cámara de a bordo oficial, que queda a disposición de los',
        'comisarios deportivos.',
      ],
    },
    {
      heading: 'Parque cerrado y reclamos',
      lines: [
        '9. Finalizada la clasificación los autos pasan al régimen de parque cerrado.',
        '10. Los reclamos se presentan por escrito dentro de los plazos que fije la categoría.',
      ],
    },
  ],
};

/** Escapes text for a PDF literal string and rejects characters WinAnsi cannot hold. */
function pdfString(text: string): string {
  for (const char of text) {
    if (char.charCodeAt(0) > 255) throw new Error(`Unsupported character in demo text: ${char}`);
  }
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function pageStream(doc: DocumentSpec, page: PageSpec, number: number): Buffer {
  const parts: string[] = [];
  parts.push(`BT /F1 15 Tf 56 790 Td (${pdfString(doc.title)}) Tj ET`);
  parts.push(`BT /F1 13 Tf 56 760 Td (${pdfString(page.heading)}) Tj ET`);
  const body = page.lines
    .map((line, index) => `${index === 0 ? '' : 'T* '}(${pdfString(line)}) Tj`)
    .join('\n');
  parts.push(`BT /F1 10.5 Tf 56 730 Td 17 TL\n${body}\nET`);
  const footer = `${NOTICE}  Página ${number} de ${doc.pages.length}`;
  parts.push(`BT /F1 8 Tf 56 36 Td (${pdfString(footer)}) Tj ET`);
  return Buffer.from(parts.join('\n'), 'latin1');
}

function buildPdf(doc: DocumentSpec): Buffer {
  const pageCount = doc.pages.length;
  const bodies: Buffer[] = [];
  const text = (value: string) => Buffer.from(value, 'latin1');

  // Object numbering: 1 catalog, 2 page tree, 3 font, then a page and a content stream per page.
  const kids = doc.pages.map((_, index) => `${4 + index * 2} 0 R`).join(' ');
  bodies.push(text('<< /Type /Catalog /Pages 2 0 R >>'));
  bodies.push(text(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`));
  bodies.push(
    text('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
  );
  doc.pages.forEach((page, index) => {
    const contentObject = 5 + index * 2;
    bodies.push(
      text(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`,
      ),
    );
    const stream = pageStream(doc, page, index + 1);
    bodies.push(
      Buffer.concat([
        text(`<< /Length ${stream.length} >>\nstream\n`),
        stream,
        text('\nendstream'),
      ]),
    );
  });

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  let offset = chunks[0]?.length ?? 0;
  const offsets: number[] = [];
  bodies.forEach((body, index) => {
    offsets.push(offset);
    const object = Buffer.concat([text(`${index + 1} 0 obj\n`), body, text('\nendobj\n')]);
    chunks.push(object);
    offset += object.length;
  });

  const entries = offsets.map((value) => `${String(value).padStart(10, '0')} 00000 n \n`).join('');
  const xref = `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n${entries}`;
  const trailer = `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
  chunks.push(text(xref), text(trailer));
  return Buffer.concat(chunks);
}

const outputDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'examples',
  'demo-monomarca',
);
mkdirSync(outputDirectory, { recursive: true });
for (const doc of [technical, sporting]) {
  const target = join(outputDirectory, doc.file);
  writeFileSync(target, buildPdf(doc));
  console.log(`wrote ${target}`);
}
