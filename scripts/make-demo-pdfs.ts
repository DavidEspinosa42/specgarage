/**
 * Generates the fictional demo regulation PDFs in examples/demo-cup/.
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

const NOTICE = 'Fictional SpecGarage demonstration document. Not a real regulation.';

const technical: DocumentSpec = {
  file: 'demo-technical-regulations.pdf',
  title: 'TECHNICAL REGULATIONS - DEMO SINGLE-MAKE CUP 2026',
  pages: [
    {
      heading: 'General provisions',
      lines: [
        'A: Entrants and mechanics must know these regulations and the sporting regulations.',
        'B: Anything not expressly mentioned as authorized is considered prohibited.',
        'C: These regulations apply from 1-01-2026 to 31-12-2026. Changes are announced',
        '   through official category annexes.',
        'D: The category is single-make: all cars share the same model and base components.',
        '',
        'Contents: 2-Chassis  3-Front track  4-Rear track  5-Weight  7-Tires',
        '8-Data acquisition  9-Pre-event check  10-Numbering  11-Brakes',
        '12-Fuel  13-Safety  14-Electronic flag device  15-Interpretation',
      ],
    },
    {
      heading: 'Chassis and dimensions',
      lines: [
        '2- CHASSIS: The wheelbase must be between 2495 and 2505 mm, both included.',
        'It is measured with the car at rest on a flat surface.',
        '',
        '3- FRONT TRACK: 1660 mm maximum.',
        '',
        '4- REAR TRACK: 1648 mm maximum.',
        '',
        'Track widths are measured with the car at rest on a flat surface.',
      ],
    },
    {
      heading: 'Weight and tires',
      lines: [
        '5- WEIGHT: The minimum weight of the car with the driver aboard, equipped and in',
        'racing position, is 1090 kg. Weighing is done on a scale on a flat, level surface.',
        '',
        '7- TIRES',
        '7-A: Only tires of the specification supplied by the category are used.',
        '7-B: The minimum tread depth in the center band is 2.0 mm.',
      ],
    },
    {
      heading: 'Data, pre-event check and seals',
      lines: [
        '8- DATA ACQUISITION: Only the data acquisition system authorized by the category is',
        'allowed. Any other GPS or telemetry system is prohibited.',
        '',
        '9- PRE-EVENT TECHNICAL CHECK: Before qualifying, each car reports to the technical',
        'check. Without this procedure the car is not cleared to compete.',
        'The engine is sealed; the seal must be intact and its number recorded.',
      ],
    },
    {
      heading: 'Numbering, brakes and fuel',
      lines: [
        '10- NUMBERING: The competition number digits are yellow on a black rectangle.',
        'The minimum digit height is 20 cm.',
        '',
        '11- BRAKES: Discs and pads must be original to the model. The minimum pad thickness',
        'is 3.5 mm.',
        '',
        '12- FUEL: It is supplied by the category. The density of the sample, measured at',
        '15 °C, must be between 725 and 770 g/l, both included.',
      ],
    },
    {
      heading: 'Safety, flag device and interpretation',
      lines: [
        '13- SAFETY: The extinguisher must be charged, fixed to the car, and within its',
        'charge date. Safety belts must be within their expiry date.',
        '',
        '14- ELECTRONIC FLAG DEVICE: The category flag device is mandatory, securely installed',
        'and visible to the driver.',
        '',
        '15- INTERPRETATION: Cases not covered are decided by the technical commission.',
      ],
    },
  ],
};

const sporting: DocumentSpec = {
  file: 'demo-sporting-regulations.pdf',
  title: 'SPORTING REGULATIONS - DEMO SINGLE-MAKE CUP 2026',
  pages: [
    {
      heading: 'Scope and calendar',
      lines: [
        '1. The Demo Single-Make Cup is a fictional championship used to demonstrate SpecGarage.',
        '2. Validity: 1-01-2026 to 31-12-2026.',
        '3. Calendar: Round 1 (15-03), Round 2 (19-04), Round 3 (24-05).',
      ],
    },
    {
      heading: 'Competition numbers',
      lines: [
        '5. Each car carries the number assigned by the category, in the places established.',
        'Numbers are not changed during the championship.',
      ],
    },
    {
      heading: 'Mandatory devices',
      lines: [
        "7-A: The electronic flag device must be securely installed and in the driver's view,",
        'with nothing obstructing the signal.',
        '7-B: The official onboard camera is mandatory and is kept available to the stewards.',
      ],
    },
    {
      heading: 'Closed park and protests',
      lines: [
        '9. After qualifying, cars go into the closed-park regime.',
        '10. Protests are submitted in writing within the deadlines set by the category.',
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
  const footer = `${NOTICE}  Page ${number} of ${doc.pages.length}`;
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

const outputDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'demo-cup');
mkdirSync(outputDirectory, { recursive: true });
for (const doc of [technical, sporting]) {
  const target = join(outputDirectory, doc.file);
  writeFileSync(target, buildPdf(doc));
  console.log(`wrote ${target}`);
}
