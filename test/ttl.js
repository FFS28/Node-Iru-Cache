if (typeof performance === 'undefined') {
  global.performance = require('perf_hooks').performance
}

const t = require('tap')

const clock = {
  now: () => clock._now,
  _now: 1,
  advance: n => {
    const start = clock._now
    clock._now += n
    for (const [w, fns] of Object.entries(clock.timers)) {
      if (w <= clock._now) {
        delete clock.timers[w]
        fns.forEach(f => f())
      }
    }
  },
  timers: {},
  setTimeout: (fn, n = 0) => {
    const w = n + clock._now
    clock.timers[w] = clock.timers[w] || []
    clock.timers[w].push(fn)
    return {
      unref: () => {},
      clear: () =>
        clock.timers[w] = (clock.timers[w] || []).filter(f => f !== fn),
    }
  },
  clearTimeout: k => k && k.clear && k.clear(),
}

const runTests = (LRU, t) => {
  const { setTimeout, clearTimeout } = global
  t.teardown(() => Object.assign(global, { setTimeout, clearTimeout }))
  global.setTimeout = clock.setTimeout
  global.clearTimeout = clock.clearTimeout

  t.test('ttl tests defaults', t => {
    const c = new LRU({ max: 5, ttl: 10, ttlResolution: 0 })
    c.set(1, 1)
    t.equal(c.get(1), 1, '1 get not stale', { now: clock._now })
    clock.advance(5)
    t.equal(c.get(1), 1, '1 get not stale', { now: clock._now })
    clock.advance(5)
    t.equal(c.get(1), 1, '1 get not stale', { now: clock._now })
    clock.advance(1)
    t.equal(c.has(1), false, '1 has stale', {
      now: clock._now,
      ttls: c.ttls,
      starts: c.starts,
      index: c.keyMap.get(1),
      stale: c.isStale(c.keyMap.get(1)),
    })
    t.equal(c.get(1), undefined)
    t.equal(c.size, 0)

    c.set(2, 2, { ttl: 100 })
    clock.advance(50)
    t.equal(c.has(2), true)
    t.equal(c.get(2), 2)
    clock.advance(51)
    t.equal(c.has(2), false)
    t.equal(c.get(2), undefined)

    c.clear()
    for (let i = 0; i < 9; i++) {
      c.set(i, i)
    }
    // now we have 9 items
    // get an expired item from old set
    clock.advance(11)
    t.equal(c.peek(4), undefined)
    t.equal(c.has(4), false)
    t.equal(c.get(4), undefined)

    // set an item WITHOUT a ttl on it
    c.set('immortal', true, { ttl: 0 })
    clock.advance(100)
    t.equal(c.get('immortal'), true)
    c.get('immortal', { updateAgeOnGet: true })
    clock.advance(100)
    t.equal(c.get('immortal'), true)
    t.end()
  })

  t.test('ttl tests with ttlResolution=100', t => {
    const c = new LRU({ max: 5, ttl: 10, ttlResolution: 100 })
    c.set(1, 1)
    t.equal(c.get(1), 1, '1 get not stale', { now: clock._now })
    clock.advance(5)
    t.equal(c.get(1), 1, '1 get not stale', { now: clock._now })
    clock.advance(5)
    t.equal(c.get(1), 1, '1 get not stale', { now: clock._now })
    clock.advance(1)
    t.equal(c.has(1), true, '1 has stale', {
      now: clock._now,
      ttls: c.ttls,
      starts: c.starts,
      index: c.keyMap.get(1),
      stale: c.isStale(c.keyMap.get(1)),
    })
    t.equal(c.get(1), 1)
    clock.advance(100)
    t.equal(c.has(1), false, '1 has stale', {
      now: clock._now,
      ttls: c.ttls,
      starts: c.starts,
      index: c.keyMap.get(1),
      stale: c.isStale(c.keyMap.get(1)),
    })
    t.equal(c.get(1), undefined)
    t.equal(c.size, 0)
    t.end()
  })

  t.test('ttlResolution only respected if non-negative integer', t => {
    const invalids = [ -1, null, undefined, 'banana', {} ]
    for (const i of invalids) {
      const c = new LRU({ max: 5, ttlResolution: i })
      t.not(c.ttlResolution, i)
      t.equal(c.ttlResolution, Math.floor(c.ttlResolution))
      t.ok(c.ttlResolution >= 0)
    }
    t.end()
  })

  t.test('ttlAutopurge', t => {
    const c = new LRU({ max: 2, ttl: 10, ttlAutopurge: true, ttlResolution: 0 })
    c.set(1, 1)
    c.set(2, 2)
    t.equal(c.size, 2)
    c.set(2, 3, { ttl: 11 })
    clock.advance(11)
    t.equal(c.size, 1)
    clock.advance(1)
    t.equal(c.size, 0)
    t.end()
  })

  t.test('ttl on set, not on cache', t => {
    const c = new LRU({ max: 5, ttlResolution: 0 })
    c.set(1, 1, { ttl: 10 })
    t.equal(c.get(1), 1)
    clock.advance(5)
    t.equal(c.get(1), 1)
    clock.advance(5)
    t.equal(c.get(1), 1)
    clock.advance(1)
    t.equal(c.has(1), false)
    t.equal(c.get(1), undefined)
    t.equal(c.size, 0)

    c.set(2, 2, { ttl: 100 })
    clock.advance(50)
    t.equal(c.has(2), true)
    t.equal(c.get(2), 2)
    clock.advance(51)
    t.equal(c.has(2), false)
    t.equal(c.get(2), undefined)

    c.clear()
    for (let i = 0; i < 9; i++) {
      c.set(i, i, { ttl: 10 })
    }
    // now we have 9 items
    // get an expired item from old set
    clock.advance(11)
    t.equal(c.has(4), false)
    t.equal(c.get(4), undefined)

    t.end()
  })

  t.test('ttl with allowStale', t => {
    const c = new LRU({ max: 5, ttl: 10, allowStale: true, ttlResolution: 0 })
    c.set(1, 1)
    t.equal(c.get(1), 1)
    clock.advance(5)
    t.equal(c.get(1), 1)
    clock.advance(5)
    t.equal(c.get(1), 1)
    clock.advance(1)
    t.equal(c.has(1), false)
    t.equal(c.get(1), 1)
    t.equal(c.get(1), undefined)
    t.equal(c.size, 0)

    c.set(2, 2, { ttl: 100 })
    clock.advance(50)
    t.equal(c.has(2), true)
    t.equal(c.get(2), 2)
    clock.advance(51)
    t.equal(c.has(2), false)
    t.equal(c.get(2), 2)
    t.equal(c.get(2), undefined)

    c.clear()
    for (let i = 0; i < 9; i++) {
      c.set(i, i)
    }
    // now we have 9 items
    // get an expired item from old set
    clock.advance(11)
    t.equal(c.has(4), false)
    t.equal(c.get(4), 4)
    t.equal(c.get(4), undefined)

    t.end()
  })

  t.test('ttl with updateAgeOnGet', t => {
    const c = new LRU({ max: 5, ttl: 10, updateAgeOnGet: true, ttlResolution: 0 })
    c.set(1, 1)
    t.equal(c.get(1), 1)
    clock.advance(5)
    t.equal(c.get(1), 1)
    clock.advance(5)
    t.equal(c.get(1), 1)
    clock.advance(1)
    t.equal(c.has(1), true)
    t.equal(c.get(1), 1)
    t.equal(c.size, 1)
    c.clear()

    c.set(2, 2, { ttl: 100 })
    for (let i = 0; i < 10; i++) {
      clock.advance(50)
      t.equal(c.has(2), true)
      t.equal(c.get(2), 2)
    }
    clock.advance(101)
    t.equal(c.has(2), false)
    t.equal(c.get(2), undefined)

    c.clear()
    for (let i = 0; i < 9; i++) {
      c.set(i, i)
    }
    // now we have 9 items
    // get an expired item
    t.equal(c.has(3), false)
    t.equal(c.get(3), undefined)
    clock.advance(11)
    t.equal(c.has(4), false)
    t.equal(c.get(4), undefined)

    t.end()
  })

  t.test('purge stale items', t => {
    const c = new LRU({ max: 10, ttlResolution: 0 })
    for (let i = 0; i < 10; i++) {
      c.set(i, i, { ttl: i + 1 })
    }
    clock.advance(3)
    t.equal(c.size, 10)
    t.equal(c.purgeStale(), true)
    t.equal(c.size, 8)
    t.equal(c.purgeStale(), false)

    clock.advance(100)
    t.equal(c.size, 8)
    t.equal(c.purgeStale(), true)
    t.equal(c.size, 0)
    t.equal(c.purgeStale(), false)
    t.equal(c.size, 0)
    t.end()
  })

  t.end()
}

t.test('tests with perf_hooks.performance.now()', t => {
  const { performance } = global
  t.teardown(() => global.performance = performance)
  global.performance = clock
  const LRU = t.mock('../')
  runTests(LRU, t)
})

t.test('tests using Date.now()', t => {
  const { now } = Date
  const { performance } = global
  t.teardown(() => global.performance = performance)
  t.teardown(() => Date.now = now)
  Date.now = () => clock.now()
  global.performance = null
  const LRU = t.mock('../')
  runTests(LRU, t)
})
