var assert = require('assert'),
    api = require("../"),
    internal = api.internal;

describe('catty.js', function () {

  describe('parseDeps()', function() {
    it('no deps', function() {
      var js = '';
      assert.deepEqual(internal.parseDeps(js), [])
    })

    it ('deps on one line', function() {
      var js = '/* @requires mapshaper-core, mapshaper-geom */';
      assert.deepEqual(internal.parseDeps(js), ['mapshaper-core', 'mapshaper-geom'])
    })

    it ('deps on several lines', function() {
      var js = '/* \n@requires\nmapshaper-core \n mapshaper-geom\n */';
      assert.deepEqual(internal.parseDeps(js), ['mapshaper-core', 'mapshaper-geom'])
    })

  })
})
