/**
 * Vectorizes the original Squarespace logo bitmap into a crisp SVG.
 *
 * The source (`rahlwes_mobile.png`, 196x45) is the only master that ever existed —
 * Squarespace held nothing larger — so the mark looks soft above ~200px wide.
 * The artwork is monochrome (#7c6d60 on transparent), which makes tracing exact:
 * the alpha channel is thresholded, upsampled with smoothing so Potrace has
 * sub-pixel edges to fit against, then traced into optimised Bézier curves.
 * Without the upsample step the trace keeps the source's pixel staircase.
 *
 *   node scripts/trace-logo.mjs [input.png] [output.svg]
 */
import { readFile, writeFile } from 'node:fs/promises'
import { inflateSync } from 'node:zlib'
import { Potrace } from 'potrace'
import { PNG } from 'pngjs'

const [input = 'src/assets/logo-source.png', output = 'src/assets/logo.svg'] = process.argv.slice(2)

const ALPHA_THRESHOLD = 110
/**
 * Potrace fits curves on the upsampled grid. 4x is the knee of the curve here:
 * visually identical to 8x at every size the logo is rendered, for half the bytes
 * (the tiny "Historical Research Service" line dominates the contour count).
 */
const SCALE = 4

function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')

  let offset = 8
  let width = 0
  let height = 0
  let colorType = 0
  const idat = []

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)

    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      colorType = data[9]
      if (data[8] !== 8) throw new Error(`unsupported bit depth ${data[8]}`)
      if (data[12] !== 0) throw new Error('interlaced PNG is not supported')
    } else if (type === 'IDAT') {
      idat.push(data)
    }

    offset += 12 + length
  }

  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]
  if (!channels) throw new Error(`unsupported colour type ${colorType}`)

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const pixels = Buffer.alloc(height * stride)

  // Undo the per-scanline filters (PNG spec 9.2).
  let pos = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++]
    const line = raw.subarray(pos, pos + stride)
    pos += stride
    const row = pixels.subarray(y * stride, (y + 1) * stride)
    const prior = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null

    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0
      const up = prior ? prior[x] : 0
      const upLeft = prior && x >= channels ? prior[x - channels] : 0
      let value = line[x]

      if (filter === 1) value += left
      else if (filter === 2) value += up
      else if (filter === 3) value += (left + up) >> 1
      else if (filter === 4) {
        const p = left + up - upLeft
        const dl = Math.abs(p - left)
        const du = Math.abs(p - up)
        const dul = Math.abs(p - upLeft)
        value += dl <= du && dl <= dul ? left : du <= dul ? up : upLeft
      } else if (filter !== 0) throw new Error(`unknown filter ${filter}`)

      row[x] = value & 0xff
    }
  }

  return { width, height, channels, pixels }
}

/**
 * Bilinear upsample of the alpha mask. Interpolating *before* Potrace thresholds
 * again is what turns hard pixel corners into fittable diagonals.
 */
function upsampleAlpha(alpha, width, height, scale) {
  const outWidth = width * scale
  const outHeight = height * scale
  const out = new Float32Array(outWidth * outHeight)
  const at = (x, y) => alpha[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))]

  for (let y = 0; y < outHeight; y++) {
    const sy = (y + 0.5) / scale - 0.5
    const y0 = Math.floor(sy)
    const fy = sy - y0

    for (let x = 0; x < outWidth; x++) {
      const sx = (x + 0.5) / scale - 0.5
      const x0 = Math.floor(sx)
      const fx = sx - x0

      const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx
      const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx
      out[y * outWidth + x] = top * (1 - fy) + bottom * fy
    }
  }

  return { data: out, width: outWidth, height: outHeight }
}

/** Traces one alpha mask region and returns path data in source-pixel coordinates. */
async function tracePaths(alpha, width, height) {
  const big = upsampleAlpha(alpha, width, height, SCALE)

  // Potrace reads luminance, so paint the mask as black-on-white.
  const png = new PNG({ width: big.width, height: big.height })
  for (let i = 0; i < big.width * big.height; i++) {
    const value = big.data[i] > ALPHA_THRESHOLD ? 0 : 255
    png.data[i * 4] = value
    png.data[i * 4 + 1] = value
    png.data[i * 4 + 2] = value
    png.data[i * 4 + 3] = 255
  }

  const trace = new Potrace({
    threshold: 128,
    turdSize: SCALE, // discard specks smaller than one source pixel
    alphaMax: 1,
    optCurve: true,
    optTolerance: 1.5,
  })

  const traced = await new Promise((resolve, reject) => {
    trace.loadImage(PNG.sync.write(png), (error) => {
      if (error) reject(error)
      else resolve(trace.getPathTag())
    })
  })

  const pathData = traced.match(/ d="([^"]+)"/)?.[1]
  if (!pathData) throw new Error('Potrace returned no path data')

  // Back to the original canvas. One decimal is ~0.1 source px — finer than the
  // eye at any render size, and roughly half the bytes of two decimals.
  return pathData.replace(/-?\d+(?:\.\d+)?/g, (n) => String(Math.round((Number(n) / SCALE) * 10) / 10))
}

const { width, height, channels, pixels } = decodePng(await readFile(input))
const alphaOffset = channels === 4 ? 3 : channels === 2 ? 1 : -1
if (alphaOffset < 0) throw new Error('source has no alpha channel to trace')

const alpha = new Float32Array(width * height)
for (let i = 0; i < width * height; i++) alpha[i] = pixels[i * channels + alphaOffset]

/**
 * Column 40-41 is a full-height rule at ~24% opacity separating the monogram from
 * the wordmark. Splitting there lets the two halves be coloured independently and
 * lets the monogram stand alone as an icon.
 */
const DIVIDER_X = 40
const WORDMARK_X = 42

const region = (fromX, toX) => {
  const out = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = fromX; x < toX; x++) out[y * width + x] = alpha[y * width + x]
  }
  return out
}

const markPath = await tracePaths(region(0, DIVIDER_X), width, height)
const wordPath = await tracePaths(region(WORDMARK_X, width), width, height)

// Tracing drops the rule itself (its alpha is below the glyph threshold);
// lowering the threshold would fatten every letter, so emit it as the rect it is.
const divider = `<rect class="logo-rule" x="${DIVIDER_X}" y="0" width="2" height="${height}" opacity=".24"/>`

const full = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" fill="currentColor" fill-rule="evenodd"><path class="logo-mark" d="${markPath}"/>${divider}<path class="logo-word" d="${wordPath}"/></svg>\n`
await writeFile(output, full)
console.log(`✓ ${output} — ${(full.length / 1024).toFixed(1)} kB`)

// Square-ish crop of just the monogram, for the favicon and any avatar use.
const markOnly = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${DIVIDER_X} ${height}" fill="currentColor" fill-rule="evenodd"><path d="${markPath}"/></svg>\n`
const markOutput = output.replace(/\.svg$/, '-mark.svg')
await writeFile(markOutput, markOnly)
console.log(`✓ ${markOutput} — ${(markOnly.length / 1024).toFixed(1)} kB`)
