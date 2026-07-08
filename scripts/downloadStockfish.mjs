#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdirSync, chmodSync, existsSync, rmSync, renameSync, copyFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const STOCKFISH_RELEASE_TAG = 'sf_18'
const VENDOR_DIR = join(fileURLToPath(new URL('..', import.meta.url)), 'vendor', 'stockfish')

const PLATFORM_ASSETS = {
  'linux-x64': {
    asset: 'stockfish-ubuntu-x86-64.tar',
    binaryInArchive: 'stockfish/stockfish-ubuntu-x86-64'
  },
  'darwin-x64': {
    asset: 'stockfish-macos-x86-64.tar',
    binaryInArchive: 'stockfish/stockfish-macos-x86-64'
  },
  'darwin-arm64': {
    asset: 'stockfish-macos-m1-apple-silicon.tar',
    binaryInArchive: 'stockfish/stockfish-macos-m1-apple-silicon'
  },
  'win32-x64': {
    asset: 'stockfish-windows-x86-64.zip',
    binaryInArchive: 'stockfish/stockfish-windows-x86-64.exe'
  }
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
  const platformKey = resolvePlatformKey()
  const { asset, binaryInArchive } = PLATFORM_ASSETS[platformKey]
  const finalBinaryName = process.platform === 'win32' ? 'stockfish.exe' : 'stockfish'
  const finalBinaryPath = join(VENDOR_DIR, finalBinaryName)

  if (existsSync(finalBinaryPath)) {
    console.log(`Stockfish already present at ${finalBinaryPath}`)
    return
  }

  mkdirSync(VENDOR_DIR, { recursive: true })
  const archivePath = join(VENDOR_DIR, asset)
  const downloadUrl = `https://github.com/official-stockfish/Stockfish/releases/download/${STOCKFISH_RELEASE_TAG}/${asset}`

  console.log(`Downloading ${downloadUrl} ...`)
  await downloadFile(downloadUrl, archivePath)

  console.log('Extracting...')
  extractArchive(archivePath, VENDOR_DIR, binaryInArchive)

  const extractedPath = join(VENDOR_DIR, binaryInArchive)
  const stockfishDirPath = join(VENDOR_DIR, 'stockfish')
  const tempBinaryPath = join(VENDOR_DIR, '.stockfish-temp')
  copyFileSync(extractedPath, tempBinaryPath)
  rmSync(stockfishDirPath, { recursive: true, force: true })
  renameSync(tempBinaryPath, finalBinaryPath)
  rmSync(archivePath, { force: true })

  if (process.platform !== 'win32') {
    chmodSync(finalBinaryPath, 0o755)
  }

  console.log(`Stockfish installed at ${finalBinaryPath}`)
}

main().catch((err) => {
  console.error(err.message)
  process.exitCode = 1
})
