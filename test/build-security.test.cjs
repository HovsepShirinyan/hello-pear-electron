const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const validateDmgBackground = require('../build/dmg-background.cjs')

test('DMG background accepts the checked-in PNG asset', () => {
  const icon = path.join(__dirname, '..', 'build', 'icon', 'icon-512x512.png')
  assert.equal(validateDmgBackground(icon), icon)
})

test('DMG background rejects ICNS bytes even when the filename ends in .png', (t) => {
  const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'autopass-background-'))
  t.after(() => {
    for (const name of ['disguised.png', 'truncated.png']) fs.unlinkSync(path.join(fixtures, name))
    fs.rmdirSync(fixtures)
  })
  for (const [name, bytes] of [
    ['disguised.png', Buffer.from('69636e7300000008', 'hex')],
    ['truncated.png', Buffer.from('89504e47', 'hex')]
  ]) {
    const filename = path.join(fixtures, name)
    fs.writeFileSync(filename, bytes)
    assert.throws(() => validateDmgBackground(filename), /trusted PNG assets/)
  }
})
