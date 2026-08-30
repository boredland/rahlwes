import type { APIRoute } from 'astro'
import { selectableSources } from '@ankai/providers'

export const prerender = false

/**
 * The source toggles the search UI renders.
 *
 * Served from the provider catalog rather than duplicated in the page, so the filters
 * cannot drift from the adapters the fan-out actually queries.
 */
export const GET: APIRoute = async () => Response.json({ sources: selectableSources })
