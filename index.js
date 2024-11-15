const { execSync } = require('node:child_process')
const { createReadStream } = require('node:fs')
const { readFile, writeFile } = require('node:fs/promises')
const { Writable } = require('stream')
const { pipeline } = require('stream/promises')
const path = require('path')
const JSONStream = require('JSONStream')
const FormData = require('form-data')

function descriptionMdi (version) {
  return `
Icon set from the [Material Design Icons](https://materialdesignicons.com/) project version ${version}.

Contains icons from the standard pack from Google and contributions by the community.
`
}

const datasetSchema = [
  { key: 'path', type: 'string', 'x-refersTo': 'http://schema.org/DigitalDocument' },
  { key: 'name', type: 'string', 'x-refersTo': 'http://www.w3.org/2000/01/rdf-schema#label', 'x-capabilities': { insensitive: false, text: false } },
  { key: 'aliases', type: 'string', separator: ',', 'x-capabilities': { values: false, insensitive: false, text: false } },
  { key: 'tags', type: 'string', separator: ',', 'x-capabilities': { values: false, insensitive: false, text: false } },
  { key: 'author', type: 'string', 'x-capabilities': { values: false, insensitive: false, text: false } },
  { key: 'version', type: 'string' },
  { key: 'pack', type: 'string', 'x-capabilities': { insensitive: false, text: false } },
  { key: 'packVersion', type: 'string', 'x-capabilities': { textStandard: false, text: false, insensitive: false } },
  { key: 'svg', type: 'string', 'x-capabilities': { index: false, values: false, textStandard: false, text: false, insensitive: false } },
  { key: 'svgPath', type: 'string', 'x-capabilities': { index: false, values: false, textStandard: false, text: false, insensitive: false } }
]

const tmpPJson = {
  dependencies: {
    '@mdi/svg': '7'
  }
}

// a global variable to manage interruption
let stopped

exports.run = async ({ processingConfig, processingId, tmpDir, axios, log, ws }) => {
  await log.step('Install @mdi/svg in tmp dir')
  await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify(tmpPJson))
  const result = execSync('npm install --no-audit --no-funding', { cwd: tmpDir })
  await log.info(result)
  const mdiPath = path.join(tmpDir, 'node_modules/@mdi/svg')
  const mdiPJson = JSON.parse(await readFile(path.join(mdiPath, 'package.json')))
  log.info(`version = ${mdiPJson.version}`)

  await log.step('Create the dataset')
  const dataset = (await axios.post('api/v1/datasets', {
    title: `Icons - MDI - ${mdiPJson.version}`,
    description: descriptionMdi(mdiPJson.version),
    isRest: true,
    schema: datasetSchema,
    attachmentsAsImage: true,
    extras: { processingId }
  })).data
  await log.info(`dataset created, id="${dataset.id}", slug="${dataset.slug}"`)

  let nbIcons = 0
  await pipeline(
    createReadStream(path.join(mdiPath, 'meta.json')),
    JSONStream.parse('*'),
    new Writable({
      objectMode: true,
      async write (chunk, encoding, callback) {
        nbIcons += 1
        callback()
      }
    })
  )
  await log.info(`number of icons = ${nbIcons}`)

  await log.info('prepare archive with all attachments')
  execSync('zip svg.zip *', { cwd: path.join(mdiPath, 'svg') })

  await log.task('load attachments')
  const form = new FormData()
  form.append('actions', JSON.stringify([]), 'actions.json')
  form.append('attachments', createReadStream(path.join(mdiPath, 'svg/svg.zip')), 'attachments.zip')
  await axios({
    method: 'post',
    url: `api/v1/datasets/${dataset.id}/_bulk_lines`,
    data: form,
    headers: form.getHeaders(),
    onUploadProgress: async (progressEvent) => {
      await log.progress('load attachments', progressEvent.loaded, progressEvent.total)
    }
  })

  let lines = []
  await log.task('load lines')
  let i = 0
  const sendLines = async () => {
    await axios({
      method: 'post',
      url: `api/v1/datasets/${dataset.id}/_bulk_lines`,
      data: lines
    })
    i += lines.length
    await log.progress('load lines', i, nbIcons)
    lines = []
  }

  await pipeline(
    createReadStream(path.join(mdiPath, 'meta.json')),
    JSONStream.parse('*'),
    new Writable({
      objectMode: true,
      async write (chunk, encoding, callback) {
        if (stopped) return callback()
        try {
          const svgFilePath = path.join(tmpDir, `node_modules/@mdi/svg/svg/${chunk.name}.svg`)
          const svg = await readFile(svgFilePath, 'utf8')
          const svgPath = svg.match(/path d="(.*)"/)[1]
          lines.push({
            path: chunk.name + '.svg',
            name: chunk.name,
            version: chunk.version,
            pack: 'mdi',
            packVersion: mdiPJson.version,
            svg,
            svgPath,
            aliases: chunk.aliases.join(', '),
            tags: chunk.tags.join(', ')
          })
          if (lines.length === 100) await sendLines()
          callback()
        } catch (err) {
          callback(err)
        }
      },
      async final (callback) {
        try {
          if (lines.length) await sendLines()
          callback()
        } catch (err) {
          callback(err)
        }
      }
    })
  )
}

// used to manage interruption
// not required but it is a good practice to prevent incoherent state a smuch as possible
// the run method should finish shortly after calling stop, otherwise the process will be forcibly terminated
// the grace period before force termination is 20 seconds
exports.stop = async () => {
  stopped = true
}
