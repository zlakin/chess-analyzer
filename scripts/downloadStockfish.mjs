#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  chmodSync,
  existsSync,
  rmSync,
  renameSync,
  copyFileSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const STOCKFISH_RELEASE_TAG = 'sf_18'
// Everything resolves from the repo root rather than from process.cwd(), so that
// `node scripts/downloadStockfish.mjs` writes to the same place no matter which
// directory it was invoked from -- an npm script always runs at the root, but a
// hand-run one does not have to.
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const VENDOR_DIR = join(REPO_ROOT, 'vendor', 'stockfish')

// A null suffix is the generic baseline build, which every x86-64 CPU runs.
function suffixToLinux(suffix) {
  const base = suffix ? `stockfish-ubuntu-x86-64-${suffix}` : 'stockfish-ubuntu-x86-64'
  return { asset: `${base}.tar`, binaryInArchive: `stockfish/${base}` }
}
function suffixToMacos(suffix) {
  const base = suffix ? `stockfish-macos-x86-64-${suffix}` : 'stockfish-macos-x86-64'
  return { asset: `${base}.tar`, binaryInArchive: `stockfish/${base}` }
}
function suffixToWindows(suffix) {
  const base = suffix ? `stockfish-windows-x86-64-${suffix}` : 'stockfish-windows-x86-64'
  return { asset: `${base}.zip`, binaryInArchive: `stockfish/${base}.exe` }
}

// Ordered best-first; the last entry of each list is the generic build and is
// relied on elsewhere as the guaranteed fallback.
const PLATFORM_ASSETS = {
  'linux-x64': ['vnni512', 'avx512', 'bmi2', 'avx2', 'sse41-popcnt', null].map(suffixToLinux),
  'darwin-x64': ['bmi2', 'avx2', 'sse41-popcnt', null].map(suffixToMacos),
  'darwin-arm64': [
    { asset: 'stockfish-macos-m1-apple-silicon.tar', binaryInArchive: 'stockfish/stockfish-macos-m1-apple-silicon' }
  ],
  'win32-x64': ['vnni512', 'avx512', 'bmi2', 'avx2', 'sse41-popcnt', null].map(suffixToWindows)
}

function resolvePlatformKey() {
  const key = `${process.platform}-${process.arch}`
  if (!(key in PLATFORM_ASSETS)) {
    throw new Error(
      `Unsupported platform/arch: ${key}. Supported: ${Object.keys(PLATFORM_ASSETS).join(', ')}`
    )
  }
  return key
}

// Detection only picks where to START in the candidate list. It is an
// optimisation, not the guarantee -- runSmokeTest below is what actually
// keeps us from installing a binary this CPU cannot execute.
function detectCpuFeatures() {
  try {
    if (process.platform === 'linux') {
      const flags = readFileSync('/proc/cpuinfo', 'utf-8').match(/^flags\s*:(.*)$/m)
      return new Set((flags?.[1] ?? '').trim().split(/\s+/))
    }
    if (process.platform === 'darwin') {
      const out = execFileSync('sysctl', ['-n', 'machdep.cpu.features', 'machdep.cpu.leaf7_features'], {
        encoding: 'utf-8'
      })
      return new Set(out.toLowerCase().split(/\s+/))
    }
  } catch {
    // Fall through: with no detection we simply start at the top of the
    // list and let the smoke test walk down it.
  }
  return null
}

const REQUIRED_FEATURES = {
  vnni512: ['avx512_vnni', 'avx512vnni'],
  avx512: ['avx512f'],
  bmi2: ['bmi2'],
  avx2: ['avx2'],
  'sse41-popcnt': ['sse4_1', 'sse4.1']
}

function candidateIsPlausible(asset, features) {
  if (features === null) return true
  const suffix = Object.keys(REQUIRED_FEATURES).find((key) => asset.includes(`-${key}.`))
  if (!suffix) return true // the generic build always runs
  return REQUIRED_FEATURES[suffix].some((flag) => features.has(flag))
}

// The real guarantee: run the thing and see whether it answers. A build that
// uses instructions this CPU lacks dies with SIGILL here rather than in the
// middle of a user's game analysis.
function runSmokeTest(binaryPath) {
  try {
    const out = execFileSync(binaryPath, [], {
      input: 'uci\nquit\n',
      encoding: 'utf-8',
      timeout: 30000
    })
    return out.includes('uciok')
  } catch {
    return false
  }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

async function downloadFile(url, destPath) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`)
  }
  const arrayBuffer = await response.arrayBuffer()
  await writeFile(destPath, Buffer.from(arrayBuffer))
}

function extractArchive(archivePath, destDir, memberPath) {
  if (archivePath.endsWith('.zip')) {
    execFileSync('powershell', [
      '-Command',
      `Expand-Archive -Path "${archivePath}" -DestinationPath "${destDir}" -Force`
    ])
  } else {
    execFileSync('tar', ['xf', archivePath, '-C', destDir, memberPath])
  }
}

async function main() {
  const targetDir = process.env.STOCKFISH_TARGET_DIR
    ? resolve(REPO_ROOT, process.env.STOCKFISH_TARGET_DIR)
    : VENDOR_DIR
  const forceGeneric = process.env.STOCKFISH_GENERIC === '1'

  const platformKey = resolvePlatformKey()
  const finalBinaryName = process.platform === 'win32' ? 'stockfish.exe' : 'stockfish'
  const finalBinaryPath = join(targetDir, finalBinaryName)
  const stampPath = join(targetDir, 'version.json')

  let candidates = PLATFORM_ASSETS[platformKey]
  if (forceGeneric) candidates = [candidates[candidates.length - 1]]
  else {
    const features = detectCpuFeatures()
    const plausible = candidates.filter((c) => candidateIsPlausible(c.asset, features))
    // Always keep the generic build as the final fallback.
    candidates = plausible.length > 0 ? plausible : [candidates[candidates.length - 1]]
  }

  if (existsSync(stampPath) && existsSync(finalBinaryPath)) {
    try {
      const stamp = JSON.parse(readFileSync(stampPath, 'utf-8'))
      // Match the stamp against the whole candidate list, not just its head. The
      // stamp records whichever build the smoke test actually accepted, and that
      // can legitimately be a lower candidate than the head when detection
      // over-predicts -- a CPU that advertises a feature but still cannot run the
      // top build. Comparing against candidates[0] alone would mean the installed
      // binary never matches its own stamp on such a machine, so every run would
      // re-download. Anything still on this list is a build we would be happy to
      // install today, so keeping it is correct.
      if (
        stamp.releaseTag === STOCKFISH_RELEASE_TAG &&
        candidates.some((c) => c.asset === stamp.asset) &&
        stamp.sha256 === sha256(finalBinaryPath)
      ) {
        console.log(`Stockfish ${stamp.asset} already installed at ${finalBinaryPath}`)
        return
      }
      console.log('Stockfish stamp does not match; reinstalling.')
    } catch {
      console.log('Stockfish stamp unreadable; reinstalling.')
    }
  }

  mkdirSync(targetDir, { recursive: true })

  // Every archive holds its binary under a `stockfish/` directory, and on Linux
  // and macOS the installed binary is itself the file `<targetDir>/stockfish`.
  // Extracting straight into targetDir therefore asks tar to create a directory
  // over that file, which fails outright on any reinstall -- exactly the case the
  // stamp above exists to enable. Unpacking into a scratch directory keeps the two
  // names apart, and leaves the working binary untouched until the replacement has
  // passed its smoke test, so a run where every candidate fails is not destructive.
  const extractDir = join(targetDir, '.stockfish-extract')
  const tempBinaryPath = join(targetDir, '.stockfish-temp')

  for (const { asset, binaryInArchive } of candidates) {
    console.log(`Trying ${asset} ...`)
    const archivePath = join(targetDir, asset)
    const downloadUrl = `https://github.com/official-stockfish/Stockfish/releases/download/${STOCKFISH_RELEASE_TAG}/${asset}`

    try {
      await downloadFile(downloadUrl, archivePath)
      rmSync(extractDir, { recursive: true, force: true })
      mkdirSync(extractDir, { recursive: true })
      extractArchive(archivePath, extractDir, binaryInArchive)

      const extractedPath = join(extractDir, binaryInArchive)
      copyFileSync(extractedPath, tempBinaryPath)
      rmSync(extractDir, { recursive: true, force: true })
      if (process.platform !== 'win32') chmodSync(tempBinaryPath, 0o755)

      if (!runSmokeTest(tempBinaryPath)) {
        console.log(`  ${asset} does not run on this CPU; trying the next build.`)
        rmSync(tempBinaryPath, { force: true })
        rmSync(archivePath, { force: true })
        continue
      }

      renameSync(tempBinaryPath, finalBinaryPath)
      rmSync(archivePath, { force: true })
      writeFileSync(
        stampPath,
        JSON.stringify(
          { releaseTag: STOCKFISH_RELEASE_TAG, asset, sha256: sha256(finalBinaryPath) },
          null,
          2
        )
      )
      console.log(`Stockfish ${asset} installed at ${finalBinaryPath}`)
      return
    } catch (err) {
      console.log(`  ${asset} failed: ${err.message}`)
      rmSync(archivePath, { force: true })
      rmSync(extractDir, { recursive: true, force: true })
      rmSync(tempBinaryPath, { force: true })
    }
  }

  throw new Error('No Stockfish build could be installed for this platform.')
}

main().catch((err) => {
  console.error(err.message)
  process.exitCode = 1
})
