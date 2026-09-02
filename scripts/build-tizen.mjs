import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import autoprefixer from 'autoprefixer'
import { build, transform } from 'esbuild'
import postcss from 'postcss'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(project, 'dist')
const require = createRequire(import.meta.url)
const { transformAsync: babelTransform } = require('@babel/core')
const presetEnvModule = require('@babel/preset-env')
const presetEnv = presetEnvModule.default ?? presetEnvModule

async function loadLegacyCssPlugin() {
  const source = await readFile(resolve(project, 'scripts/legacy-css.ts'), 'utf8')
  const compiled = await transform(source, {
    format: 'esm',
    loader: 'ts',
    target: 'es2020',
  })
  const encoded = Buffer.from(compiled.code).toString('base64')
  return import(`data:text/javascript;base64,${encoded}`)
}

function escapeInlineScript(source) {
  return source.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--')
}

function escapeInlineStyle(source) {
  return source.replace(/<\/style/gi, '<\\/style')
}

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await cp(resolve(project, 'public'), output, { recursive: true })
await mkdir(resolve(output, 'brand/png'), { recursive: true })
await mkdir(resolve(output, 'brand/svg'), { recursive: true })
await Promise.all([
  cp(resolve(project, 'brand/png/izumi-favicon-transparent-512.png'), resolve(output, 'brand/png/izumi-favicon-transparent-512.png')),
  cp(resolve(project, 'brand/svg/izumi-wordmark-white.svg'), resolve(output, 'brand/svg/izumi-wordmark-white.svg')),
])

const result = await build({
  absWorkingDir: project,
  assetNames: 'assets/[name]-[hash]',
  bundle: true,
  define: {
    'import.meta.env.DEV': 'false',
    'import.meta.env.PROD': 'true',
    'process.env.NODE_ENV': '"production"',
  },
  entryNames: 'izumi-companion',
  format: 'iife',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  legalComments: 'none',
  loader: {
    '.png': 'file',
    '.svg': 'file',
    '.woff': 'file',
    '.woff2': 'file',
  },
  // CSS must remain unminified here. esbuild rewrites rgba() colors to 8-digit hex and folds
  // physical offsets into inset; both forms are ignored by the Chromium 56 TV engine.
  minify: false,
  outdir: output,
  platform: 'browser',
  stdin: {
    contents: "import 'core-js/stable'; import './src/main.tsx';",
    loader: 'js',
    resolveDir: project,
    sourcefile: 'tizen-entry.js',
  },
  target: ['es2015'],
  write: false,
})

const javascript = result.outputFiles.find((file) => extname(file.path) === '.js')
const stylesheet = result.outputFiles.find((file) => extname(file.path) === '.css')
if (!javascript || !stylesheet) {
  throw new Error('The Tizen build did not produce both JavaScript and CSS output.')
}

const minifiedJavascript = await transform(javascript.text, {
  loader: 'js',
  minify: true,
  target: 'es2015',
})
const compatibleJavascript = await babelTransform(minifiedJavascript.code, {
  babelrc: false,
  comments: false,
  compact: true,
  configFile: false,
  presets: [[presetEnv, {
    bugfixes: true,
    modules: false,
    targets: { chrome: '47', safari: '8' },
    useBuiltIns: false,
  }]],
  sourceType: 'script',
})
if (!compatibleJavascript?.code) {
  throw new Error('Babel did not produce a classic Tizen JavaScript bundle.')
}

const { legacyTvCss } = await loadLegacyCssPlugin()
const compatibleCss = await postcss([
  legacyTvCss(),
  autoprefixer({ overrideBrowserslist: ['Safari >= 8', 'Chrome >= 47'] }),
]).process(stylesheet.text, { from: undefined })

for (const file of result.outputFiles) {
  if (file === javascript || file === stylesheet) continue
  const destination = resolve(output, relative(output, file.path))
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, file.contents)
}

const templatePath = resolve(project, 'index.html')
const template = await readFile(templatePath, 'utf8')
const entryPattern = /\s*<script\s+type=(['"])module\1\s+src=(['"])\/src\/main\.tsx\2><\/script>/i
if (!entryPattern.test(template)) {
  throw new Error('Could not find the development entry script in index.html.')
}

const html = template.replace(
  entryPattern,
  // esbuild's CSS minifier folds top/right/bottom/left into the newer `inset` shorthand even
  // when targeting Chrome 47. Chromium 56 ignores that shorthand, which silently defeats the
  // explicit legacy declarations emitted above and changes physical-TV geometry. Keep the
  // PostCSS output intact; the widget-size cost is small and the compatibility rules remain real.
  () => `\n    <style data-izumi-bundle>${escapeInlineStyle(compatibleCss.css)}</style>\n    <script data-izumi-bundle>${escapeInlineScript(compatibleJavascript.code)}</script>`,
)

if (/\b(?:type=(['"])module\1|nomodule)\b/i.test(html)) {
  throw new Error('The packaged Tizen HTML still contains a module or nomodule entry.')
}
if (!/<script\s+data-izumi-bundle>/i.test(html) || !/<style\s+data-izumi-bundle>/i.test(html)) {
  throw new Error('The packaged Tizen HTML is missing its inline classic bundle.')
}

await writeFile(resolve(output, 'index.html'), html)
