#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, posix, relative, resolve, sep } from 'node:path'

const rootFlag = process.argv.indexOf('--root')
const root = resolve(rootFlag >= 0 ? process.argv[rootFlag + 1] : process.cwd())
const docsRoot = resolve(root, 'docs')
const policyPath = resolve(docsRoot, 'public-boundary.json')

if (!existsSync(policyPath)) {
  console.error(`Documentation policy is missing: ${policyPath}`)
  process.exit(1)
}

const errors = []
const policy = JSON.parse(readFileSync(policyPath, 'utf8'))

function walk(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'cache') return []
    const target = join(directory, entry.name)
    return entry.isDirectory() ? walk(target) : [target]
  })
}

function relativeToDocs(file) {
  return relative(docsRoot, file).split(sep).join('/')
}

function readJson(relativePath, label) {
  const target = resolve(docsRoot, relativePath)
  if (!existsSync(target)) {
    errors.push(`${label} is missing: ${relativePath}`)
    return null
  }
  try {
    return JSON.parse(readFileSync(target, 'utf8'))
  } catch (error) {
    errors.push(`${label} is invalid JSON: ${relativePath} (${error.message})`)
    return null
  }
}

function checkForbiddenContent(file) {
  const relativeFile = relativeToDocs(file)
  const content = readFileSync(file, 'utf8')
  for (const phrase of policy.forbiddenPhrases ?? []) {
    if (content.toLowerCase().includes(String(phrase).toLowerCase())) {
      errors.push(`forbidden phrase in ${relativeFile}: ${phrase}`)
    }
  }
  for (const pattern of policy.forbiddenPatterns ?? []) {
    try {
      if (new RegExp(pattern, 'iu').test(content)) {
        errors.push(`forbidden content pattern in ${relativeFile}: ${pattern}`)
      }
    } catch (error) {
      errors.push(`invalid forbidden content pattern ${pattern}: ${error.message}`)
    }
  }
}

function stripFencedCode(content) {
  let fence = null
  return content
    .split(/\r?\n/)
    .map((line) => {
      if (!fence) {
        const opening = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/)
        if (!opening) return line
        fence = { marker: opening[1][0], length: opening[1].length }
        return ''
      }

      const closing = new RegExp(`^[ \\t]{0,3}${fence.marker}{${fence.length},}[ \\t]*$`)
      if (closing.test(line)) fence = null
      return ''
    })
    .join('\n')
}

function checkInlineMathDelimiters(file) {
  const content = stripFencedCode(readFileSync(file, 'utf8'))
  if (/\\[()]/.test(content)) {
    errors.push(`raw inline LaTeX delimiter in ${relativeToDocs(file)}; use $...$ outside fenced code`)
  }
}

function publicRelativePath(rawPath) {
  const normalized = String(rawPath ?? '').replaceAll('\\', '/')
  if (normalized.startsWith('docs/public/')) return normalized.slice('docs/public/'.length)
  if (normalized.startsWith('public/')) return normalized.slice('public/'.length)
  return normalized
}

function routeCandidates(sourceRelative, rawTarget) {
  let target = rawTarget.trim().replace(/^<|>$/g, '').split(/\s+["']/)[0]
  try {
    target = decodeURIComponent(target)
  } catch {
    errors.push(`invalid encoded link in ${sourceRelative}: ${rawTarget}`)
  }
  target = target.split('#')[0].split('?')[0]
  if (!target) return []

  const base = '/manga-dm/'
  if (target.startsWith(base)) target = `/${target.slice(base.length)}`

  let route
  if (target.startsWith('/')) {
    route = target.slice(1)
  } else {
    route = posix.normalize(posix.join(posix.dirname(sourceRelative), target))
  }

  if (route.startsWith('assets/') || route.startsWith('downloads/') || route.startsWith('meta/')) {
    route = `public/${route}`
  }

  const candidates = [route]
  if (route.endsWith('/')) candidates.push(`${route}index.md`)
  if (!extname(route)) {
    candidates.push(`${route}.md`, `${route}/index.md`)
  }
  return [...new Set(candidates.map((candidate) => resolve(docsRoot, candidate)))]
}

function checkInternalLinks(file) {
  const sourceRelative = relativeToDocs(file)
  const markdown = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '')
  const links = markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)
  for (const match of links) {
    const target = match[1].trim()
    if (/^(?:https?:|mailto:|tel:|#|javascript:)/i.test(target)) continue
    const candidates = routeCandidates(sourceRelative, target)
    if (candidates.length && !candidates.some((candidate) => existsSync(candidate))) {
      errors.push(`broken internal link in ${sourceRelative}: ${target}`)
    }
  }
}

const files = walk(docsRoot)
const relativeFiles = files.map(relativeToDocs)

for (const requiredPage of policy.requiredPages ?? []) {
  if (!existsSync(resolve(docsRoot, requiredPage))) errors.push(`required page is missing: ${requiredPage}`)
}

if (existsSync(resolve(docsRoot, '_config.yml'))) errors.push('obsolete Jekyll _config.yml must be removed')
if (existsSync(resolve(docsRoot, 'mcmc'))) errors.push('obsolete docs/mcmc directory must be migrated and removed')
if (existsSync(resolve(root, '.openai', 'hosting.json'))) errors.push('Sites hosting configuration is forbidden')

const forbiddenExtensions = new Set((policy.forbiddenExtensions ?? []).map((item) => item.toLowerCase()))
const allowedPdfPaths = new Set(
  (policy.additionalPublicAssets ?? [])
    .map(publicRelativePath)
    .filter((path) => extname(path).toLowerCase() === '.pdf')
    .map((path) => `public/${path}`),
)
for (const file of files) {
  const relativeFile = relativeToDocs(file)
  if (forbiddenExtensions.has(extname(file).toLowerCase()) && !allowedPdfPaths.has(relativeFile)) {
    errors.push(`forbidden extension in public documentation: ${relativeFile}`)
  }
  const extension = extname(file).toLowerCase()
  const isRenderableSource = extension === '.md' || extension === '.vue'
  const isPublicText = relativeFile.startsWith('public/') && ['.json', '.txt', '.html'].includes(extension)
  if (isRenderableSource || isPublicText) checkForbiddenContent(file)
  if (extension === '.md') {
    checkInlineMathDelimiters(file)
    checkInternalLinks(file)
  }
}

const allowedIds = new Set(policy.allowedGalaxyIds ?? [])
const posteriorRoot = resolve(docsRoot, 'public', 'downloads', 'posteriors')
const posteriorFiles = walk(posteriorRoot).filter((file) => extname(file).toLowerCase() === '.nc')
for (const file of posteriorFiles) {
  const id = [...allowedIds].find((candidate) => file.includes(candidate))
  if (!id) errors.push(`non-allowlisted posterior asset: ${relativeToDocs(file)}`)
}

const mcmc = readJson(policy.mcmcManifest, 'MCMC migration manifest')
if (mcmc) {
  const headings = Array.isArray(mcmc.headings)
    ? mcmc.headings
    : (mcmc.items ?? []).filter((item) => item.type === 'heading')
  const assets = Array.isArray(mcmc.assets)
    ? mcmc.assets
    : (mcmc.items ?? []).filter((item) => item.type === 'figure')
  const headingCount = headings.length
  if (headingCount < (policy.minimumMcmcHeadings ?? 0)) {
    errors.push(`MCMC heading coverage is ${headingCount}; expected at least ${policy.minimumMcmcHeadings}`)
  }
  for (const [index, heading] of headings.entries()) {
    const source = typeof heading.source === 'string' ? heading.source : heading.source?.heading
    const destination =
      typeof heading.destination === 'string' ? heading.destination : heading.destination?.path
    if (!source || !destination) {
      errors.push(`MCMC heading mapping ${index + 1} needs source and destination`)
    }
  }
  if ((policy.minimumMcmcAssets ?? 0) > assets.length) {
    errors.push(`MCMC asset coverage is ${assets.length}; expected at least ${policy.minimumMcmcAssets}`)
  }
}

const provenance = readJson(policy.provenanceManifest, 'Case-study provenance manifest')
const documentedPublicPaths = new Set()
if (provenance) {
  if (provenance.sourceRepository?.commit && !/^[a-f\d]{40}$/i.test(provenance.sourceRepository.commit)) {
    errors.push('case-study source repository commit is invalid')
  }
  for (const field of ['sourceArchiveSha256', 'sourceThesisSha256']) {
    if (provenance[field] && !/^[a-f\d]{64}$/i.test(provenance[field])) {
      errors.push(`case-study ${field} is invalid`)
    }
  }
  for (const [index, artifact] of (provenance.artifacts ?? []).entries()) {
    const label = `provenance artifact ${index + 1}`
    if (!allowedIds.has(artifact.galaxyId)) errors.push(`${label} uses non-allowlisted galaxy: ${artifact.galaxyId}`)
    if (!/^[a-f\d]{64}$/i.test(artifact.sha256 ?? '')) errors.push(`${label} has invalid SHA-256`)
    if (!Number.isInteger(artifact.bytes) || artifact.bytes <= 0) errors.push(`${label} has invalid byte size`)
    if (!artifact.publicPath) {
      errors.push(`${label} has no publicPath`)
      continue
    }
    if (!artifact.publicPath.includes(artifact.galaxyId)) {
      errors.push(`${label} galaxy ID does not match public path: ${artifact.publicPath}`)
    }
    documentedPublicPaths.add(artifact.publicPath.replaceAll('\\', '/'))
    const publicFile = resolve(docsRoot, 'public', artifact.publicPath)
    if (!existsSync(publicFile)) {
      errors.push(`${label} points to a missing public file: ${artifact.publicPath}`)
      continue
    }
    const actualBytes = statSync(publicFile).size
    if (actualBytes !== artifact.bytes) errors.push(`${label} byte size differs: ${artifact.publicPath}`)
    const actualHash = createHash('sha256').update(readFileSync(publicFile)).digest('hex')
    if (/^[a-f\d]{64}$/i.test(artifact.sha256 ?? '') && actualHash !== artifact.sha256.toLowerCase()) {
      errors.push(`${label} SHA-256 differs: ${artifact.publicPath}`)
    }
  }
}

const posteriorIds = new Set()
for (const file of posteriorFiles) {
  const id = [...allowedIds].find((candidate) => file.includes(candidate))
  if (id) posteriorIds.add(id)
}
if (posteriorFiles.length !== allowedIds.size || posteriorIds.size !== allowedIds.size) {
  errors.push(`expected exactly ${allowedIds.size} allowlisted posterior assets; found ${posteriorFiles.length}`)
}

for (const file of posteriorFiles) {
  const publicPath = relative(resolve(docsRoot, 'public'), file).split(sep).join('/')
  if (!documentedPublicPaths.has(publicPath)) errors.push(`posterior asset is missing provenance: ${publicPath}`)
}

const caseAssetRoot = resolve(docsRoot, 'public', 'assets', 'case-studies')
for (const file of walk(caseAssetRoot)) {
  const publicPath = relative(resolve(docsRoot, 'public'), file).split(sep).join('/')
  if (!documentedPublicPaths.has(publicPath)) {
    errors.push(`case-study asset is missing provenance: ${publicPath}`)
  }
}

const expectedPublicPaths = new Set(documentedPublicPaths)
for (const manifestPath of [policy.mcmcManifest, policy.provenanceManifest, policy.summaryManifest]) {
  if (manifestPath) expectedPublicPaths.add(publicRelativePath(manifestPath))
}
if (mcmc) {
  for (const item of mcmc.items ?? []) {
    if (item.type === 'figure' && item.destination?.path) {
      expectedPublicPaths.add(publicRelativePath(item.destination.path))
    }
  }
  for (const asset of mcmc.assets ?? []) {
    const destination = typeof asset.destination === 'string' ? asset.destination : asset.destination?.path
    if (destination) expectedPublicPaths.add(publicRelativePath(destination))
  }
}

const publicRoot = resolve(docsRoot, 'public')
for (const rawPath of policy.additionalPublicAssets ?? []) {
  const publicPath = publicRelativePath(rawPath)
  const target = resolve(publicRoot, publicPath)
  if (!publicPath || target === publicRoot || !target.startsWith(`${publicRoot}${sep}`)) {
    errors.push(`invalid additional public asset path: ${rawPath}`)
    continue
  }
  expectedPublicPaths.add(publicPath)
  if (!existsSync(target)) errors.push(`declared public asset is missing: ${publicPath}`)
}

for (const file of walk(publicRoot)) {
  const publicPath = relative(publicRoot, file).split(sep).join('/')
  if (!expectedPublicPaths.has(publicPath)) errors.push(`unexpected public file: ${publicPath}`)
}

if (errors.length) {
  console.error(`Documentation checks failed (${errors.length}):`)
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log(
  `Documentation checks passed (${relativeFiles.length} files, ${posteriorFiles.length} posterior assets)`,
)
