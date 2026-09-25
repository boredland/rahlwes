import type { ImageMetadata } from 'astro'

const uploads = import.meta.glob<{ default: ImageMetadata }>('/src/assets/uploads/*.{jpg,jpeg,png,webp,avif}', {
  eager: true,
})

/**
 * Resolves a Keystatic image reference to the asset Astro can optimise.
 *
 * Keystatic stores a public-style path (`/uploads/foo.jpg`), but nothing is served
 * from there: the files live in `src/assets/uploads` so they go through the asset
 * pipeline. A reference that resolves to nothing is a broken upload, so it fails
 * the build rather than shipping a 404.
 */
export function resolveUpload(src: string): ImageMetadata {
  const asset = uploads[`/src/assets/uploads/${src.replace(/^\/uploads\//, '')}`]?.default
  if (!asset) throw new Error(`Image "${src}" is missing from src/assets/uploads — upload it through Keystatic.`)
  return asset
}
