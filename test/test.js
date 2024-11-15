const config = require('config')
const processing = require('../')
const { describe, it } = require('node:test')

describe('Hello world processing', () => {
  it('should import mdi in a datasets', async function () {
    const testUtils = await import('@data-fair/lib-processing-dev/tests-utils.js')

    const context = testUtils.context({
      pluginConfig: {},
      processingConfig: {},
      tmpDir: './data'
    }, config, true)

    await processing.run(context)
  })
})
