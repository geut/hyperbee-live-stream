/**
 * @typedef {Object} Hyperbee
 */

const { Readable } = require('streamx')
const ltgt = require('ltgt')

const SEP = Buffer.alloc(1)
const MAX = Buffer.from([255])

function encRange (e, opts) {
  if (!e) return opts
  if (opts.gt !== undefined) opts.gt = enc(e, opts.gt)
  if (opts.gte !== undefined) opts.gte = enc(e, opts.gte)
  if (opts.lt !== undefined) opts.lt = enc(e, opts.lt)
  if (opts.lte !== undefined) opts.lte = enc(e, opts.lte)
  if (opts.sub && !opts.gt && !opts.gte) opts.gt = enc(e, SEP)
  if (opts.sub && !opts.lt && !opts.lte) opts.lt = enc(e, MAX)
  return opts
}

function enc (e, v) {
  if (v === undefined || v === null) return null
  if (e !== null) return e.encode(v)
  if (typeof v === 'string') return Buffer.from(v)
  return v
}

class HyperbeeLiveStream extends Readable {
  /**
   *
   * @param {Hyperbee} db
   * @param {Object} [opts]
   * @param {boolean} [opts.old=true] Iterate over the old items before start to watching
   * @param {Buffer|String} [opts.gt] Only return keys > than this
   * @param {Buffer|String} [opts.gte] Only return keys >= than this
   * @param {Buffer|String} [opts.lt] Only return keys < than this
   * @param {Buffer|String} [opts.lte] Only return keys <= than this
   * @param {boolean} [opts.reverse=false] Set to true to get them in reverse order
   * @param {number} [opts.limit=-1] Set to the max number of entries you want
   *
   */
  constructor (db, opts = {}) {
    super()

    const { old = true, ...hyperbeeStreamOptions } = opts
    this._db = db
    this._old = old
    this._opts = hyperbeeStreamOptions
    this._range = encRange(this._db.keyEncoding, { ...this._opts, sub: this._db._sub })
    this._pushOldValue = this._pushOldValue.bind(this)
    this._pushNextValue = this._pushNextValue.bind(this)
    this._startVersion = 0
    this._version = 0
  }

  /**
   * Returns the top version readed
   * @type {number}
   */
  get version () {
    return this._version
  }

  _open (cb) {
    this._db.ready()
      .then(() => {
        this._startVersion = this._db.version
        if (this._old) this._oldIterator = this._db.createReadStream(this._opts)[Symbol.asyncIterator]()
        cb(null)
      })
      .catch(err => cb(err))
  }

  _read (cb) {
    if (this._oldIterator) {
      return this._oldIterator.next()
        .then(this._pushOldValue)
        .then(done => {
          if (done) {
            this._read(cb)
          } else {
            cb(null, null)
          }
        })
        .catch(cb)
    }

    if (!this._nextIterator) {
      this.emit('synced')
      this._nextIterator = this._db.createHistoryStream({ live: true, gte: this._startVersion })[Symbol.asyncIterator]()
    }

    return this._nextIterator.next()
      .then(this._pushNextValue)
      .then(readMore => {
        if (readMore) {
          this._read(cb)
        } else {
          cb(null, null)
        }
      })
      .catch(cb)
  }

  _pushOldValue (data) {
    if (data.done) {
      this._oldIterator = null
    } else {
      if (data.value.seq >= this._startVersion) {
        this._version = this._startVersion = data.value.seq
      }
      this.push(data.value)
    }

    return data.done
  }

  _pushNextValue (data) {
    if (data.done) {
      this.push(null)
      return false
    }

    if (data.value.seq === this._version) {
      return true
    }

    this._version = data.value.seq

    if (ltgt.contains(this._range, data.value.key)) {
      this.push(data.value)
      return false
    }

    return true
  }

  _predestroy () {
    const iterator = this._oldIterator || this._nextIterator
    if (iterator) {
      this._iteratorToDestroy = iterator.return()
    }
  }

  _destroy (cb) {
    if (this._iteratorToDestroy) {
      this._iteratorToDestroy.then(cb.bind(null, null)).catch(cb)
      return
    }

    cb(null)
  }
}

module.exports = { HyperbeeLiveStream }

/**
 * Emitted when the stream is synced with the last version in the database
 * @event HyperbeeLiveStream#synced
 */
