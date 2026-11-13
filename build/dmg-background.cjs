const fs = require('node:fs')

const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex')

module.exports = function validateDmgBackground(filename) {
  const header = Buffer.alloc(pngSignature.length)
  const file = fs.openSync(filename, 'r')
  try {
    const bytes = fs.readSync(file, header, 0, header.length, 0)
    if (bytes !== header.length || !header.equals(pngSignature)) {
      throw new Error('DMG backgrounds must use trusted PNG assets; other formats are rejected.')
    }
  } finally {
    fs.closeSync(file)
  }
  return filename
}
