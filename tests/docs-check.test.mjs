import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'

const repositoryRoot = resolve(import.meta.dirname, '..')
const checker = join(repositoryRoot, 'scripts', 'check-docs.mjs')

function write(root, relativePath, content = '') {
  const target = join(root, relativePath)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content, 'utf8')
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'manga-docs-check-'))
  write(
    root,
    'docs/public-boundary.json',
    JSON.stringify({
      allowedGalaxyIds: ['11743-9102'],
      requiredPages: ['index.md', 'methods/data-and-selection.md'],
      forbiddenExtensions: ['.tex', '.bib'],
      forbiddenPhrases: ['620 out of 1234'],
      forbiddenPatterns: ['\\b\\d+ galaxies\\b'],
      mcmcManifest: 'public/meta/mcmc-migration.json',
      minimumMcmcHeadings: 2,
      provenanceManifest: 'public/meta/case-study-provenance.json',
      additionalPublicAssets: ['assets/home/declared-hero.png'],
    }),
  )
  write(root, 'docs/index.md', '# Home\n\n[Method](/methods/data-and-selection)\n')
  write(root, 'docs/methods/data-and-selection.md', '# Data and selection\n')
  write(
    root,
    'docs/public/meta/mcmc-migration.json',
    JSON.stringify({ headings: [{ source: 'A', destination: '/a' }, { source: 'B', destination: '/b' }] }),
  )
  write(
    root,
    'docs/public/meta/case-study-provenance.json',
    JSON.stringify({
      artifacts: [
        {
          galaxyId: '11743-9102',
          publicPath: 'downloads/posteriors/11743-9102.nc',
          sha256: createHash('sha256').update('data').digest('hex'),
          bytes: 4,
        },
      ],
    }),
  )
  write(root, 'docs/public/downloads/posteriors/11743-9102.nc', 'data')
  write(root, 'docs/public/assets/home/declared-hero.png', 'hero')
  return root
}

function runCheck(root) {
  return spawnSync(process.execPath, [checker, '--root', root], { encoding: 'utf8' })
}

test('accepts a complete allowlisted documentation fixture', () => {
  const root = createFixture()
  try {
    const result = runCheck(root)
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /Documentation checks passed/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('accepts an item-based MCMC migration manifest', () => {
  const root = createFixture()
  try {
    write(
      root,
      'docs/public/meta/mcmc-migration.json',
      JSON.stringify({
        items: [
          { type: 'heading', source: { heading: 'A' }, destination: { path: 'docs/a.md' } },
          { type: 'heading', source: { heading: 'B' }, destination: { path: 'docs/b.md' } },
        ],
      }),
    )
    const result = runCheck(root)
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects broken internal links', () => {
  const root = createFixture()
  try {
    write(root, 'docs/index.md', '# Home\n\n[Missing](/methods/not-present)\n')
    const result = runCheck(root)
    assert.notEqual(result.status, 0)
    assert.match(`${result.stdout}\n${result.stderr}`, /broken internal link/i)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects forbidden paper source and non-allowlisted posterior assets', () => {
  const root = createFixture()
  try {
    write(root, 'docs/paper.tex', '\\section{Private}')
    write(root, 'docs/public/downloads/posteriors/9999-9999.nc', 'data')
    const result = runCheck(root)
    assert.notEqual(result.status, 0)
    assert.match(`${result.stdout}\n${result.stderr}`, /forbidden extension/i)
    assert.match(`${result.stdout}\n${result.stderr}`, /non-allowlisted posterior/i)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('publishes only explicitly allowlisted PDFs', () => {
  const root = createFixture()
  try {
    const policyPath = join(root, 'docs/public-boundary.json')
    const policy = JSON.parse(readFileSync(policyPath, 'utf8'))
    policy.forbiddenExtensions.push('.pdf')
    policy.additionalPublicAssets.push('paper/allowed.pdf')
    writeFileSync(policyPath, JSON.stringify(policy))
    write(root, 'docs/public/paper/allowed.pdf', 'allowed PDF')

    const allowed = runCheck(root)
    assert.equal(allowed.status, 0, `${allowed.stdout}\n${allowed.stderr}`)

    write(root, 'docs/public/paper/unlisted.pdf', 'unlisted PDF')
    const unlisted = runCheck(root)
    assert.notEqual(unlisted.status, 0)
    assert.match(`${unlisted.stdout}\n${unlisted.stderr}`, /forbidden extension.*unlisted\.pdf/i)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects case-study assets that are absent from provenance', () => {
  const root = createFixture()
  try {
    write(root, 'docs/public/assets/case-studies/11743-9102/untracked.png', 'image')
    const result = runCheck(root)
    assert.notEqual(result.status, 0)
    assert.match(`${result.stdout}\n${result.stderr}`, /case-study asset is missing provenance/i)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects every unexpected file under the public asset root', () => {
  const root = createFixture()
  try {
    write(root, 'docs/public/assets/aggregate-result.png', 'private aggregate figure')
    const result = runCheck(root)
    assert.notEqual(result.status, 0)
    assert.match(`${result.stdout}\n${result.stderr}`, /unexpected public file/i)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects forbidden result language in Vue-rendered content', () => {
  const root = createFixture()
  try {
    write(root, 'docs/.vitepress/theme/LeakingPanel.vue', '<template>620 out of 1234</template>')
    const result = runCheck(root)
    assert.notEqual(result.status, 0)
    assert.match(`${result.stdout}\n${result.stderr}`, /forbidden phrase/i)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects provenance whose galaxy ID does not match its public path', () => {
  const root = createFixture()
  try {
    write(
      root,
      'docs/public/meta/case-study-provenance.json',
      JSON.stringify({
        artifacts: [
          {
            galaxyId: '11743-9102',
            publicPath: 'downloads/posteriors/9999-9999.nc',
            sha256: createHash('sha256').update('data').digest('hex'),
            bytes: 4,
          },
        ],
      }),
    )
    write(root, 'docs/public/downloads/posteriors/9999-9999.nc', 'data')
    rmSync(join(root, 'docs/public/downloads/posteriors/11743-9102.nc'))
    const result = runCheck(root)
    assert.notEqual(result.status, 0)
    assert.match(`${result.stdout}\n${result.stderr}`, /galaxy ID does not match public path/i)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects unpublished aggregate-count patterns in Markdown', () => {
  const root = createFixture()
  try {
    write(root, 'docs/index.md', '# Home\n\nThe retained set contains 42 galaxies.\n')
    const result = runCheck(root)
    assert.notEqual(result.status, 0)
    assert.match(`${result.stdout}\n${result.stderr}`, /forbidden content pattern/i)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects raw inline LaTeX delimiters outside fenced code', () => {
  const root = createFixture()
  try {
    write(
      root,
      'docs/index.md',
      '# Home\n\nRaw inline math: \\(x + y\\).\n\n```text\nLiteral example: \\(x + y\\)\n```\n',
    )
    const rawResult = runCheck(root)
    assert.notEqual(rawResult.status, 0)
    assert.match(`${rawResult.stdout}\n${rawResult.stderr}`, /raw inline LaTeX delimiter/i)

    write(root, 'docs/index.md', '# Home\n\n```text\nLiteral example: \\(x + y\\)\n```\n')
    const fencedResult = runCheck(root)
    assert.equal(fencedResult.status, 0, `${fencedResult.stdout}\n${fencedResult.stderr}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects incomplete MCMC migration coverage and invalid provenance hashes', () => {
  const root = createFixture()
  try {
    write(
      root,
      'docs/public/meta/mcmc-migration.json',
      JSON.stringify({ headings: [{ source: 'A', destination: '/a' }] }),
    )
    write(
      root,
      'docs/public/meta/case-study-provenance.json',
      JSON.stringify({ artifacts: [{ galaxyId: '11743-9102', publicPath: 'x.nc', sha256: 'bad', bytes: 1 }] }),
    )
    const result = runCheck(root)
    assert.notEqual(result.status, 0)
    assert.match(`${result.stdout}\n${result.stderr}`, /MCMC heading coverage/i)
    assert.match(`${result.stdout}\n${result.stderr}`, /invalid SHA-256/i)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('mobile home hero reserves space below the fixed navigation for its eyebrow', () => {
  const styles = readFileSync(join(repositoryRoot, 'docs', '.vitepress', 'theme', 'style.css'), 'utf8')
  const mobileRules = styles.match(/@media \(max-width: 640px\) \{([\s\S]*?)\n\}/)?.[1] ?? ''

  assert.match(mobileRules, /\.VPHomeHero\s*\{[\s\S]*?min-height:\s*auto;/)
  assert.match(mobileRules, /\.VPHomeHero\s*\{[\s\S]*?padding-top:\s*118px\s*!important;/)
  assert.match(mobileRules, /\.VPHomeHero::before\s*\{[\s\S]*?top:\s*72px;/)
})

test('application homepage leads with researcher identity and review paths', () => {
  const homepage = readFileSync(join(repositoryRoot, 'docs', 'index.md'), 'utf8')
  const applicationHome = readFileSync(join(repositoryRoot, 'docs', '.vitepress', 'theme', 'components', 'ApplicationHome.vue'), 'utf8')
  const manuscriptPreview = readFileSync(join(repositoryRoot, 'docs', '.vitepress', 'theme', 'components', 'ManuscriptPreview.vue'), 'utf8')
  const themeLayout = readFileSync(join(repositoryRoot, 'docs', '.vitepress', 'theme', 'Layout.vue'), 'utf8')
  assert.match(homepage, /Inferring dark-matter halos/)
  assert.match(homepage, /Hongyi Xu/)
  assert.match(homepage, /Department of Physics/)
  assert.match(homepage, /Project overview/)
  assert.match(homepage, /Galaxy 11743-9102/)
  assert.match(homepage, /Galaxy sample/)
  assert.match(homepage, /Start with the research question/)
  assert.match(homepage, /Inspect the evidence/)
  assert.match(homepage, /Check implementation limits/)
  assert.doesNotMatch(homepage, /- title: Research question/)
  assert.doesNotMatch(homepage, /- title: My contribution/)
  assert.match(homepage, /8,070/)
  assert.match(homepage, /1,234/)
  assert.match(homepage, /620 \(final population-fit\)/)
  assert.match(homepage, /Sample-size milestones are public; aggregate scientific findings remain unpublished/)
  assert.match(homepage, /<ApplicationHome\s*\/>/)
  assert.doesNotMatch(applicationHome, /<WorkflowMap\s*\/>/)
  assert.doesNotMatch(applicationHome, /class="validation-ledger"/)
  assert.doesNotMatch(applicationHome, /class="researcher-band"/)
  assert.match(applicationHome, /Review implementation status/)
  assert.match(themeLayout, /#home-features-before/)
  assert.match(themeLayout, /<ManuscriptPreview v-if="frontmatter\.layout === 'home'"\s*\/>/)
  assert.match(manuscriptPreview, /Research paper · draft/)
  assert.match(manuscriptPreview, /manuscript-page-01\.webp/)
  assert.match(manuscriptPreview, /manuscript-page-02\.webp/)
  assert.match(manuscriptPreview, /manuscript-page-03\.webp/)
  assert.match(manuscriptPreview, /Open research paper/)
  assert.doesNotMatch(homepage, /Image credits\s*\n\s*link:/)
})

test('manuscript previews remain licensed and allowlisted', () => {
  const preview = readFileSync(join(repositoryRoot, 'docs', 'paper-preview', 'index.md'), 'utf8')
  const gallery = readFileSync(join(repositoryRoot, 'docs', '.vitepress', 'theme', 'components', 'ManuscriptPreviewGallery.vue'), 'utf8')
  const policy = readFileSync(join(repositoryRoot, 'docs', 'public-boundary.json'), 'utf8')

  assert.match(preview, /Draft · research paper in preparation/)
  assert.match(preview, /Research Content License/)
  assert.match(preview, /may not be copied, adapted, submitted, or published/)
  assert.match(preview, /All 14 pages are shown below/)
  assert.match(preview, /Pages 1 through 3 are complete previews/)
  assert.match(preview, /pages 4 through 14, the lower half of each page is irreversibly blurred/)
  assert.match(preview, /<ManuscriptPreviewGallery\s*\/>/)
  assert.match(gallery, /manuscript-page-\$\{number\}\.webp/)
  for (const page of Array.from({ length: 14 }, (_, index) => String(index + 1).padStart(2, '0'))) {
    assert.match(policy, new RegExp(`assets/manuscript-preview/manuscript-page-${page}\\.webp`))
  }
  assert.match(gallery, /The lower half is irreversibly blurred/)
  assert.match(gallery, /index < 3/)
  assert.doesNotMatch(gallery, /<figcaption>/)
})

test('wrapped manuscript preview heading keeps readable line spacing', () => {
  const styles = readFileSync(join(repositoryRoot, 'docs', '.vitepress', 'theme', 'style.css'), 'utf8')
  const headingRules = styles.match(/\.manuscript-preview h2\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''

  assert.match(headingRules, /line-height:\s*1\.12;/)
})

test('manuscript preview gallery displays one page per row', () => {
  const styles = readFileSync(join(repositoryRoot, 'docs', '.vitepress', 'theme', 'style.css'), 'utf8')
  const galleryRules = styles.match(/\.manuscript-page-gallery\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''

  assert.match(galleryRules, /grid-template-columns:\s*1fr;/)
})

test('licensing separates MIT software from protected research content', () => {
  const readme = readFileSync(join(repositoryRoot, 'README.md'), 'utf8')
  const about = readFileSync(join(repositoryRoot, 'docs', 'about', 'index.md'), 'utf8')
  const softwareLicense = readFileSync(join(repositoryRoot, 'LICENSE'), 'utf8')
  const contentLicense = readFileSync(join(repositoryRoot, 'LICENSE-CONTENT.md'), 'utf8')
  const publicContentLicense = readFileSync(join(repositoryRoot, 'docs', 'research-content-license.md'), 'utf8')
  const manuscriptPreview = readFileSync(join(repositoryRoot, 'docs', 'paper-preview', 'index.md'), 'utf8')
  const homePreview = readFileSync(join(repositoryRoot, 'docs', '.vitepress', 'theme', 'components', 'ManuscriptPreview.vue'), 'utf8')

  assert.match(softwareLicense, /MIT License for Software Source Code/)
  assert.match(softwareLicense, /LICENSE-CONTENT\.md/)
  assert.match(contentLicense, /All rights reserved/)
  assert.match(contentLicense, /may not copy,\s*redistribute, adapt, submit, or publish/)
  assert.equal(publicContentLicense, contentLicense)
  assert.match(readme, /Research Content License/)
  assert.match(readme, /software package only/)
  assert.match(about, /Copyright and publication notice/)
  assert.match(about, /research-content-license/)
  assert.match(about, /\[Research Content License\]\(\/research-content-license\)/)
  assert.match(manuscriptPreview, /\[Research Content License\]\(\/research-content-license\)/)
  assert.match(homePreview, /withBase\('\/research-content-license\.html'\)/)
  assert.doesNotMatch(`${about}\n${manuscriptPreview}\n${homePreview}`, /github\.com\/hyi03\/manga-dm\/blob\/main\/LICENSE-CONTENT\.md/)
})

test('deep case keeps the identifier together and limits the page outline to H2', () => {
  const page = readFileSync(join(repositoryRoot, 'docs', 'case-studies', '11743-9102.md'), 'utf8')
  const styles = readFileSync(join(repositoryRoot, 'docs', '.vitepress', 'theme', 'style.css'), 'utf8')
  const headingRules = styles.match(/\.vp-doc h1\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''

  assert.match(page, /outline:\s*\[2, 2\]/)
  assert.match(page, /MaNGA <span class="no-break">11743-9102<\/span>/)
  assert.match(headingRules, /line-height:\s*1\.07;/)
})

test('run entry page exposes a non-computational quick start', () => {
  const page = readFileSync(join(repositoryRoot, 'docs', 'run', 'index.md'), 'utf8')

  assert.match(page, /## Quick start/)
  assert.match(page, /pip install -e \./)
  assert.match(page, /manga --help/)
  assert.match(page, /manga stage1 --help/)
  assert.match(page, /without starting a scientific fit/)
})

test('researcher metadata is consistent across package and citation records', () => {
  const pyproject = readFileSync(join(repositoryRoot, 'pyproject.toml'), 'utf8')
  const citation = readFileSync(join(repositoryRoot, 'CITATION.cff'), 'utf8')
  const about = readFileSync(join(repositoryRoot, 'docs', 'about', 'index.md'), 'utf8')
  assert.match(pyproject, /name = "Hongyi Xu"/)
  assert.match(citation, /family-names: Xu/)
  assert.match(citation, /given-names: Hongyi/)
  assert.match(citation, /Department of Physics, University of Toronto/)
  assert.match(about, /Hongyi Xu/)
  assert.match(about, /University of Toronto/)
})

test('navigation follows the research-to-reproducibility reading path', () => {
  const config = readFileSync(join(repositoryRoot, 'docs', '.vitepress', 'config.mts'), 'utf8')
  const navStart = config.indexOf('nav: [')
  const navEnd = config.indexOf('\n    sidebar:', navStart)
  const nav = config.slice(navStart, navEnd)

  assert.match(config, /canonicalRoot = 'https:\/\/hyi03\.github\.io\/manga-dm\/'/)
  assert.notEqual(navStart, -1)
  assert.notEqual(navEnd, -1)

  const topLevelItems = [
    "{ text: 'Overview', link: '/' }",
    "{ text: 'Research Paper', link: '/paper-preview/' }",
    "text: 'Research'",
    "text: 'Reproducibility'",
    "{ text: 'About', link: '/about/' }",
  ]
  const topLevelPositions = topLevelItems.map((item) => nav.indexOf(item))
  assert.ok(topLevelPositions.every((position) => position >= 0))
  assert.deepEqual([...topLevelPositions].sort((left, right) => left - right), topLevelPositions)

  assert.match(nav, /text: 'Start here'[\s\S]*text: 'Two-minute overview'[\s\S]*text: 'Scientific methods'/)
  assert.match(nav, /text: 'Evidence and interpretation'[\s\S]*text: 'Worked example: 11743-9102'[\s\S]*text: 'Diagnostics and quality'[\s\S]*text: 'Limitations'/)
  assert.match(nav, /text: 'Background'[\s\S]*text: 'MCMC and Bayesian inference'/)
  assert.match(nav, /text: 'Run and inspect'[\s\S]*text: 'Run the pipeline'[\s\S]*text: 'Downloads and provenance'/)
  assert.match(nav, /text: 'Implementation'[\s\S]*text: 'Architecture'[\s\S]*text: 'Method-to-code map'[\s\S]*text: 'Implementation status'/)
  assert.match(nav, /text: 'Release record'[\s\S]*text: 'Application snapshot'/)
  assert.doesNotMatch(nav, /text: 'Worked Example'/)
  assert.doesNotMatch(nav, /text: 'MCMC appendix'/)
})

test('public posterior downloads are not ignored by Git', () => {
  const path = 'docs/public/downloads/posteriors/11743-9102_nfw_param_cm200_samples.nc'
  const result = spawnSync('git', ['check-ignore', '-q', path], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  })
  assert.equal(result.status, 1, `${path} is still ignored by Git`)
})

test('Pages build job grants configure-pages permission', () => {
  const workflow = readFileSync(join(repositoryRoot, '.github', 'workflows', 'deploy-docs.yml'), 'utf8')
  const buildJob = workflow.match(/\n  build:\n([\s\S]*?)\n  deploy:/)?.[1] ?? ''
  assert.match(buildJob, /permissions:\s*\n\s+contents:\s*read\s*\n\s+pages:\s*write/)
})

test('Pages workflow runs and watches Python documentation checks', () => {
  const workflow = readFileSync(join(repositoryRoot, '.github', 'workflows', 'deploy-docs.yml'), 'utf8')
  assert.match(workflow, /scripts\/docs\/\*\*/)
  assert.match(workflow, /tests\/test_\*\.py/)
  assert.match(workflow, /pip install[^\n]*h5py/)
  assert.match(workflow, /python -m unittest tests\.test_extract_case_summaries/)
  assert.match(workflow, /python -m unittest tests\.test_docs_mcmc_figures/)
})

test('postdeploy checks representative assets and exact posterior size', () => {
  const workflow = readFileSync(join(repositoryRoot, '.github', 'workflows', 'deploy-docs.yml'), 'utf8')
  const postdeploy = workflow.match(/\n  postdeploy:\n([\s\S]*)$/)?.[1] ?? ''
  assert.match(postdeploy, /\.css/)
  assert.match(postdeploy, /\.js/)
  assert.match(postdeploy, /assets\/case-studies\/11743-9102\/nfw-fit\.png/)
  assert.match(postdeploy, /88196/)
})

test('docs check runs both Node regression suites', () => {
  const packageJson = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'))
  assert.match(packageJson.scripts['docs:check'], /tests\/docs-check\.test\.mjs/)
  assert.match(packageJson.scripts['docs:check'], /tests\/built-docs-check\.test\.mjs/)
})

test('homepage workflow component uses direct-loadable HTML routes', () => {
  const component = readFileSync(
    join(repositoryRoot, 'docs', '.vitepress', 'theme', 'components', 'WorkflowMap.vue'),
    'utf8',
  )
  const hrefs = [...component.matchAll(/href:\s*'([^']+)'/g)].map((match) => match[1])
  assert.equal(hrefs.length, 4)
  for (const href of hrefs) assert.match(href, /\.html$/)
})

test('documentation toolchain ownership and Node runtime are recorded', () => {
  const agents = readFileSync(join(repositoryRoot, 'AGENTS.md'), 'utf8')
  const packageJson = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'))
  assert.match(agents, /VitePress public site/)
  assert.match(agents, /package\.json/)
  assert.equal(packageJson.engines?.node, '>=20')
  assert.equal(packageJson.scripts?.['docs:dev'], 'vitepress dev docs')
})

test('MCMC project-lessons link targets the existing priors anchor', () => {
  const page = readFileSync(join(repositoryRoot, 'docs', 'background', 'mcmc', 'project-lessons.md'), 'utf8')
  assert.match(page, /single-galaxy-nfw#priors\)/)
  assert.doesNotMatch(page, /single-galaxy-nfw#parameters-and-priors\)/)
})

test('deep case covers inputs, decomposition, and finalized posterior summary', () => {
  const page = readFileSync(join(repositoryRoot, 'docs', 'case-studies', '11743-9102.md'), 'utf8')
  assert.match(page, /## Input and velocity-field context/)
  assert.match(page, /## Rotation curve and component decomposition/)
  assert.match(page, /nfw-fit\.png/)
  assert.match(page, /## Finalized posterior artifact summary/)
  assert.match(page, /12\.4232/)
  assert.match(page, /-0\.6888/)
  assert.match(page, /## Legacy extended summary/)
})

test('case provenance pins the private scientific source inputs', () => {
  const provenance = JSON.parse(
    readFileSync(join(repositoryRoot, 'docs', 'public', 'meta', 'case-study-provenance.json'), 'utf8'),
  )
  assert.match(provenance.sourceRepository?.commit ?? '', /^[a-f\d]{40}$/)
  assert.equal(provenance.sourceRepository?.name, 'manga-dev')
  assert.equal(provenance.sourceRepository?.path, undefined)
  assert.match(provenance.sourceArchiveSha256 ?? '', /^[a-f\d]{64}$/)
  assert.match(provenance.sourceThesisSha256 ?? '', /^[a-f\d]{64}$/)

  const tracePreview = provenance.artifacts.find(
    (artifact) => artifact.publicPath === 'assets/case-studies/11743-9102/posterior-trace.webp',
  )
  assert.equal(tracePreview?.artifactType, 'posterior_trace_preview_webp_lossless')
  assert.ok(tracePreview?.bytes < 1_000_000)

  const casePage = readFileSync(join(repositoryRoot, 'docs', 'case-studies', '11743-9102.md'), 'utf8')
  assert.match(casePage, /posterior-trace\.webp/)
  assert.match(casePage, /Open the full-resolution PNG/)
})

test('paper and implementation status use explicit paired component states', () => {
  const component = readFileSync(
    join(repositoryRoot, 'docs', '.vitepress', 'theme', 'components', 'MethodStatus.vue'),
    'utf8',
  )
  assert.match(component, /status:\s*'paper'\s*\|\s*'implementation'/)
  assert.match(component, /Implementation status/)

  const pages = [
    'docs/methods/index.md',
    'docs/methods/data-and-selection.md',
    'docs/methods/empirical-rotation-curves.md',
    'docs/methods/single-galaxy-nfw.md',
    'docs/methods/population-model.md',
    'docs/methods/diagnostics-and-quality-gates.md',
    'docs/run/index.md',
    'docs/run/configuration.md',
    'docs/run/cli-workflow.md',
  ]
  for (const page of pages) {
    const content = readFileSync(join(repositoryRoot, page), 'utf8')
    assert.match(content, /<MethodStatus status="paper">/, `${page} needs a Paper method state`)
    assert.match(content, /<MethodStatus status="implementation">/, `${page} needs a Current implementation state`)
    for (const block of content.matchAll(/<MethodStatus[\s\S]*?<\/MethodStatus>/g)) {
      assert.doesNotMatch(block[0], /\\\(|\\\)/, `${page} status cards must not expose raw math delimiters`)
    }
  }
})

test('small workflow numerals use the accessible gold text token', () => {
  const styles = readFileSync(join(repositoryRoot, 'docs', '.vitepress', 'theme', 'style.css'), 'utf8')
  const rule = styles.match(/\.workflow-map__number\s*\{([\s\S]*?)\}/)?.[1] ?? ''
  assert.match(rule, /color:\s*var\(--ledger-gold-text\)/)
})

test('installation guide records the h5py documentation-tool dependency', () => {
  const installation = readFileSync(join(repositoryRoot, 'docs', 'run', 'installation.md'), 'utf8')
  assert.match(installation, /h5py/)
})

test('project architecture records legacy documentation route migration', () => {
  const page = readFileSync(join(repositoryRoot, 'docs', 'project', 'architecture.md'), 'utf8')
  assert.match(page, /Data-Processing-Pipeline\.md/)
  assert.match(page, /future\/manga-dm-rc-shapes\.md/)
})
