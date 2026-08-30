import { arcinsysAdapter } from './adapters/arcinsys'
import { arolsenAdapter } from './adapters/arolsen'
import { ddbAdapter } from './adapters/ddb'
import { ehriAdapter } from './adapters/ehri'
import { jmfCollectionAdapter } from './adapters/jmf-collection'
import { kalliopeAdapter } from './adapters/kalliope'
import { shoahFrankfurtAdapter } from './adapters/shoah-frankfurt'
import { yadVashemAdapter } from './adapters/yad-vashem'
import { linkOutBuilders } from './adapters/linkouts'
import { createD1Adapter } from './adapters/local-d1'
import type { LinkOutBuilder } from './lib/gateway'
import type { ArchiveAdapter, ProviderInfo } from './types'

/**
 * The single provider catalog — the one place a data source is registered.
 *
 * To add a provider: implement an `ArchiveAdapter` in `adapters/` (or a `LinkOutBuilder`
 * for a deep-link-only source), then list it below. The fan-out, the search endpoint, the
 * sources endpoint and the search UI all read from here, so nothing else needs touching
 * and the UI cannot drift from what the server queries.
 *
 * Order is the display and interleave order.
 */
export const recordProviders: ArchiveAdapter[] = [
  ehriAdapter,
  ddbAdapter,
  arcinsysAdapter,
  createD1Adapter('gedenkbuch', 'Bundesarchiv Gedenkbuch'),
  shoahFrankfurtAdapter,
  yadVashemAdapter,
  jmfCollectionAdapter,
  kalliopeAdapter,
  arolsenAdapter,
]

export const linkOutProviders: LinkOutBuilder[] = linkOutBuilders

/** Catalog metadata, safe to hand to the client island as props. */
export const providerCatalog: ProviderInfo[] = [
  ...recordProviders.map((a) => ({ id: a.id, label: a.label, kind: a.role })),
  ...linkOutProviders.map((b) => ({ id: b.id, label: b.label, kind: 'linkout' as const })),
]

/** Record/authority sources the user can toggle in the search UI. */
export const selectableSources: ProviderInfo[] = providerCatalog.filter((p) => p.kind !== 'linkout')
