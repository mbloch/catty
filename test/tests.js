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

  describe('#cat()', function () {
    it('no closure if "global" option is set', function (done) {
      var a = 'test/test_data/a.js';
      api({global: true}).cat(a, function(err, str) {
        assert.equal(str, '"a"\n');
        done();
      })
    })

    it('concatenates two files', function (done) {
      var b = 'test/test_data/b.js';
      api({global: true})
        .addLibrary('test/test_data').cat(b, function(err, str) {
        assert.equal(str, '"a"\n\n\n\n"b"\n');
        done();
      })
    })

    it('removes BOM from source file', function (done) {
      var c = 'test/test_data/c_bom.js';
      api({global: true})
        .addLibrary('test/test_data').cat(c, function(err, str) {
        assert.equal(str, '"a"\n\n\n\n"b"\n\n\n\n"c"\n');
        done();
      })
    })

    it('use closure by default', function (done) {
      var a = 'test/test_data/a.js';
      api.cat(a, function(err, str) {
        assert.equal(str, '(function(){\n"a"\n\n}());\n');
        done();
      })
    })

    it('#prepend() adds JS at top of file, after closure', function (done) {
      var a = 'test/test_data/a.js';
      var targ = "(function(){\nvar VERSION = '0.1';\n\"a\"\n\n}());\n";
      api
        .prepend("var VERSION = '0.1';")
        .cat(a, function(err, str) {
          assert.equal(str, targ);
          done();
        })
    })

  })

  describe('stripBOM()', function () {
    it('should remove Unicode BOM from beginning of a string', function() {
      var stripped = internal.stripBOM('\uFEFFfoo')
      assert.equal(stripped, 'foo');
    })

  })

})
