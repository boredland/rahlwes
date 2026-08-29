/**
 * Checks the CfP topic + type filters against real announcements.
 *
 *   node scripts/test-cfp-filter.mjs
 *
 * Two decisions are under test and they are independent:
 *
 *   IS_PAPER_CALL  is this an academic paper solicitation? Those are excluded —
 *                  she is a practitioner, and a call for papers asks for an
 *                  unpaid submission to somebody else's proceedings.
 *   isRelevant     is the subject hers (research / curation / remembrance)?
 *
 * Every case here is a real announcement that was once classified wrong. The
 * filter decides what she sees, and it is one regex away from either hiding her
 * field or refilling the digest with conference papers.
 */
import { readFile } from 'node:fs/promises'

const src = await readFile('scripts/scrape-cfps.mjs', 'utf8')

// Lift the classifiers out of the script without running its top-level scrape.
const start = src.indexOf('/**\n * What counts as an opportunity')
const end = src.indexOf('async function fetchText')
const module = await import(
  `data:text/javascript,${encodeURIComponent(
    `${src.slice(start, end)}\nexport { isRelevant, subjectFields, CFP_PATTERN, IS_PAPER_CALL, IS_RETROSPECTIVE }`,
  )}`
)

/** [label, title, abstract, expectPaperCall, expectRelevant, expectRetrospective?] */
const cases = [
  // — Paper solicitations: excluded whatever their subject —
  [
    'CFP session at RSA',
    'CFP: 1 Session at RSA (Philadelphia, 11-13 Mar 27)',
    'Call for Papers for a session on art and patronage in early modern Rome.',
    true,
    true,
  ],
  [
    'Call for Abstracts (Kulturfinanzierung)',
    'Call for Abstracts - Kultur Management Network Magazin Nr. 192: Kulturfinanzierung',
    'Für die 192. Ausgabe unseres KMN Magazins suchen wir Beiträge, die Kulturfinanzierung als strategische Gestaltungsaufgabe beleuchten.',
    true,
    true,
  ],
  [
    'Call for Contributions',
    'Call for Contributions - Special Issue, Policy and Society',
    'Announcement Subject Fields Political Science, Public Policy Call for contributions on governance.',
    true,
    false,
  ],
  [
    'German history workshop CFP',
    'Call For Papers: Nineteenth Southeast German Studies Workshop',
    'Subject Fields Cultural History / Studies, German History / Studies, Modern European History / Studies',
    true,
    true,
  ],

  // — Real opportunities: kept —
  [
    'Stipendium (Köln)',
    'Ausschreibung Dr. Dormagen-Guffanti-Stipendium 2027',
    'Die Stadt Köln vergibt das Stipendium für Bildende Kunst. Das Stipendium ist mit 10.000 Euro dotiert. Die Bewerbungsfrist endet am 31. August 2026.',
    false,
    true,
  ],
  [
    'EVZ remembrance funding call',
    'Shared Civic Futures - German-Israeli Cooperation on Remembrance, Antisemitism and Democratic Resilience',
    'Das Programm unterstützt deutsch-israelische Partnerschaften zu demokratischer Resilienz und Antisemitismus. Gefördert werden Projekte in den Handlungsfeldern Bilden und Handeln.',
    false,
    true,
  ],
  [
    'Gedenkstätte commission',
    'Ausschreibung: Vermittlungskonzept für die KZ-Gedenkstätte',
    'Die Gedenkstätte sucht ein Konzept für die Vermittlung der NS-Geschichte des Ortes. Grundlage sind die Biografien der Zwangsarbeiterinnen und Zwangsarbeiter.',
    false,
    true,
  ],
  [
    'Fellowship (arthist STIP)',
    'National Humanities Center Residential Fellowships 2027–28',
    'The Center offers residential fellowships for advanced study in the humanities, including art history and material culture.',
    false,
    true,
  ],
  [
    'Residency',
    'Residenz-Stipendien für das "Atelier Galata" in Istanbul',
    'Das Atelier Galata ist ein von der Kunststiftung NRW und uns gemeinsam getragenes Residenzprogramm für Künstler*innen.',
    false,
    true,
  ],
  [
    'freelance commission (remote)',
    'Ensemblemanager*in CONTINUUM',
    'Region: Bundesweit Anstellungsart: Honorarbasis Bewerbungsende: 15.09.2026. Auftrag für die Organisation eines Ensembles im Bereich Kulturvermittlung.',
    false,
    true,
  ],
  [
    'Zeitzeugen documentation project',
    'Projektaufruf Erinnerungskultur: Zeitzeug:innen-Interviews digital erschließen',
    'Gesucht werden Projekte, die Interviews mit Überlebenden erschließen und für die Bildungsarbeit zugänglich machen.',
    false,
    true,
  ],

  // — Already decided: reports about a closed call —
  [
    'prize winners announced',
    'Gewinner ZukunftsGut Preis für institutionelle Kulturvermittlung 2026',
    'Am 24. Juni 2026 wurde zum fünften Mal der ZukunftsGut-Preis verliehen. Preisträger der Kategorie urbaner Raum ist das Theater Magdeburg.',
    false,
    true,
    true,
  ],
  [
    'residency write-up',
    'Connections in practice: diaspora, mobility, and cultural exchange in Switzerland',
    "Supported by Pro Helvetia's residency programme, three cultural practitioners explored Switzerland through research and exchange. Their experiences are documented here.",
    false,
    true,
    true,
  ],

  // — Off-topic, regardless of type —
  [
    'clinical education (H-Net taxonomy)',
    'Learning to Care Together: Teams, Patients and Clinical Education',
    'Subject Fields Disability Studies, Health and Health Care, Psychology, Public Health, Social Work',
    false,
    false,
  ],
  [
    'design pedagogy (H-Net taxonomy)',
    'DESIGN LEARNING AND COMMUNITIES',
    'Subject Fields Architecture and Architectural History , Teaching and Learning , Urban Design and Planning',
    false,
    false,
  ],
]

let failed = 0
for (const [label, title, abstract, wantPaper, wantRelevant, wantOld = false] of cases) {
  const isPaper = module.IS_PAPER_CALL.test(`${title} ${abstract}`)
  const relevant = module.isRelevant(title, abstract)
  const old = module.IS_RETROSPECTIVE.test(`${title} ${abstract}`)
  const ok = isPaper === wantPaper && relevant === wantRelevant && old === wantOld
  if (!ok) failed++

  const verdict = isPaper
    ? 'EXCLUDED (paper call)'
    : old
      ? 'EXCLUDED (already closed)'
      : relevant
        ? 'kept'
        : 'EXCLUDED (off-topic)'
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${verdict.padEnd(26)} ${label}`)
  if (!ok) {
    console.log(
      `        paper=${isPaper} (want ${wantPaper})  relevant=${relevant} (want ${wantRelevant})  closed=${old} (want ${wantOld})`,
    )
  }
}

console.log(`\n${cases.length - failed}/${cases.length} passed`)
process.exit(failed ? 1 : 0)
