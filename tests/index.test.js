const hypercore = require('hypercore')
const Hyperbee = require('hyperbee')
const ram = require('random-access-memory')

const HyperbeeLiveStream = require('..')

const createDB = (opts = {}) => new Hyperbee(hypercore(ram), opts)

const getResult = async (db, opts, end) => {
  const result = []
  const stream = new HyperbeeLiveStream(db, opts)
  for await (const data of stream) {
    result.push(data)
    if (end(data, result)) {
      break
    }
  }
  return result
}

test('HyperbeeLiveStream opts = {}', async () => {
  const db = createDB({ keyEncoding: 'utf-8', valueEncoding: 'utf-8' })
  const seed = [0, 1, 4, 3, 2].map(v => v.toString())

  await Promise.all(seed.map(key => db.put(key)))

  let result = getResult(db, undefined, (_, result) => {
    if (result.length === seed.length + 2) return true
  })

  db.put('5')
  db.put('0')

  result = (await result).map(data => data.key)
  await expect(result).toEqual([...seed.sort(), '5', '0'])
})

test('HyperbeeLiveStream opts = { gte: "b", lte: "c" }', async () => {
  const db = createDB({ keyEncoding: 'utf-8', valueEncoding: 'utf-8' })
  const seed = ['a', 'c', 'd', 'f', 'b', 'e'
  ]
  await Promise.all(seed.map(key => db.put(key)))

  let result = getResult(db, { gte: Buffer.from('b'), lte: Buffer.from('d') }, (_, result) => {
    if (result.length === 4) return true
  })

  await Promise.all([
    db.put('a'),
    db.put('b')
  ])

  result = (await result).map(data => data.key)
  await expect(result).toEqual([...seed.sort().filter(w => w >= 'b' && w <= 'd'), 'b'])
})

test('HyperbeeLiveStream opts = { old: false }', async () => {
  const db = createDB({ keyEncoding: 'utf-8', valueEncoding: 'utf-8' })
  const seed = [0, 1, 2].map(v => v.toString())

  await Promise.all(seed.map(key => db.put(key)))

  let result = getResult(db, { old: false }, (_, result) => {
    if (result.length === 2) return true
  })

  await Promise.all([
    db.put('3'),
    db.put('4')
  ])

  result = (await result).map(data => data.key)
  await expect(result).toEqual(['3', '4'])
})
