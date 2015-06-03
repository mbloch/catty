var fs = require('fs');
var path = require('path');
var _ = require('underscore');
var catty = new Catty();

// regex for comments like:
// /* @requires name1, name2, name3 */
// (Comments may span multiple lines, commas are optional)
var REQUIRES_RXP = /\/\*+\s*@requires?\b([\s,;_0-9A-Za-z.-]+)\s*\*+\//g,
    REQUIRES_RXP_COFFEE = /#+\s*@requires?\b([\s,;_0-9A-Za-z.-]+)\s*(?:\n|###)/g;

function Catty(opts) {
  opts = _.extend({
    global: false,
    follow: false
  }, opts || {});

  var knownFileIndex = {},   // paths of known js files indexed by basename
      watchedFiles = {},  // SourceFile objects indexed by basename
      jobs = [],
      coffee = false;

  this.internal = { // expose internal functions for unit testing
    parseDeps: parseDeps
  };

  // enable/disable coffeescript mode
  this.coffee = function(_coffee) {
    coffee = _coffee;
  };

  // @path A directory containing JavaScript source files
  //   (subdirectories are also indexed)
  this.addLibrary = function(path) {
    if (!dirExists(path)) {
      die("Not a valid directory: " + path);
    }
    findSourceFiles(path, coffee).forEach(indexFile);
    return this;
  };

  // Compile JS source files
  this.cat = function(src, dest) {
    var job;
    try {
      job = new CattyJob(src, dest);
    } catch(e) {
      die(e.message);
    }
    job.run();
    jobs.push(job); // save job so it can be run again, if monitoring files
    return this;
  };

  function runJobs() {
    jobs.forEach(function(job) {
      job.run();
    });
  }

  function getNode(key) {
    var node = watchedFiles[key];
    if (!node) {
      throw new Error("Missing dependency: " + key);
    }
    return node;
  }

  function sortNodes(nodes) {
    var startId = 0,
        len = nodes.length,
        sorted = {},
        nodeName, i, startNode, reqId;

    while (startId < len-1) {
      startNode = nodes[startId];
      reqId = -1;
      if (startNode.name() in sorted === false) {
        for (i=startId+1; i<len; i++) {
          nodeName = nodes[i].name();
          if (nodeName in sorted === false && startNode.requiresFile(nodeName)) {
            reqId = i;
          }
        }
      }
      if (reqId > 0) {
        nodes.splice(startId, 1);
        nodes.splice(reqId, 0, startNode);
      } else {
        startId++;
      }
      sorted[startNode.name()] = true;
    }
  }

  // Add file to index of known files;
  // Assumes @path exists.
  //
  function indexFile(path) {
    var name = getFileInfo(path).basename;
    if (!name) {
      die("Invalid path: " + path);
    } else if (name in knownFileIndex === false) {
      knownFileIndex[name] = path;
    } else if (knownFileIndex[name] !== path) {
      console.log("File name collision.");
      console.log("Using:", knownFileIndex[name]);
      console.log("Ignoring:", path);
    }
    return name;
  }

  function SourceFile(path) {
    var info = getFileInfo(path),
        _deps = [],
        _js = "";

    if (!info.is_file || (info.ext != '.js' && info.ext != '.coffee')) {
      die("Invalid source file: " + path);
    }
    watchedFiles[info.basename] = this;
    if (opts.follow) {
      startMonitoring();
    }
    updateDeps();

    this.name = function() { return info.basename; };
    this.getContent = function() { return _js; };
    this.getDeps = function() { return _deps; };

    this.requiresFile = function(targName, visited) {
      visited = visited || {};
      visited[this.name()] = true;
      var reqs = this.getDeps();
      if (_.contains(reqs, targName)) {
        return true;
      }

      for (var i=0; i<reqs.length; i++) {
        var reqName = reqs[i];
        if (reqName in visited === false) {
          var reqNode = watchedFiles[reqName];
          if (reqNode.requiresFile(targName, visited)) {
            return true;
          }
        }
      }
      return false;
    };

    function updateDeps() {
      var js = fs.readFileSync(path, {encoding:"utf8"});
      // (os x) When editor opens file to write, file may
      // appear to be empty -- ignoring change if len is 0
      var changed = js.length > 0 && js !== _js;
      if (changed) {
        _js = js;
        _deps = parseDeps(js, coffee);
        _deps.forEach(addDependency);
      }
      return changed;
    }

    function addDependency(key) {
      if (key in knownFileIndex === false) {
        throw new Error("Unknown dependency in " + path + " -- " + key);
      }
      if (key in watchedFiles === false) {
        new SourceFile(knownFileIndex[key]);
      }
    }

    function onChange(err) {
      if (err) {
        console.error(err.message);
      } else {
        console.log("Re-catting -- change in " + path);
        runJobs(); // TODO: only run jobs that use this the changed source file
      }
    }

    function startMonitoring() {
      var timeout = null;
      fs.watch(path, function(evt) {
        if (evt == "change" || evt == "rename") {
          // Use a timeout to make sure file has actually changed
          // (Had problems in os x)
          timeout && clearTimeout(timeout);
          timeout = setTimeout(function() {
            try {
              if (updateDeps()) {
                onChange();
              }
            } catch(e) {
              onChange(e);
            }
          }, 150);
        }
      });
    }

  } // SourceFile

  function CattyJob(src, dest) {
    var rootKeys = [];
    var inFiles, outFile;
    if (_.isString(src)) {
      inFiles = [src];
    } else if (_.isArray(src)) {
      inFiles = src;
    } else {
      die("Invalid input file(s): " + src);
    }

    if (_.isString(dest)) {
      outFile = dest;
    } else {
      die("Invalid output file: " + dest);
    }

    rootKeys = inFiles.map(function(ifile) {
      if (ifile == outFile) die("Tried to overwrite a source file: " + ifile);
      if (!fileExists(ifile)) die("Source file not found: " + ifile);
      var name = indexFile(ifile);
      var node = new SourceFile(ifile);
      return node.name();
    });

    // return list of all deps reached by list of deps
    function findDeps(newDeps, foundDeps) {
      return newDeps.reduce(function(memo, key) {
        if (memo.indexOf(key) == -1) {
          memo.push(key);
          findDeps(getNode(key).getDeps(), memo);
        }
        return memo;
      }, foundDeps || []);
    }

    function concatenate() {
      var nodes = findDeps(rootKeys).map(getNode);
      sortNodes(nodes);
      return nodes.map(function(node) { return node.getContent(); }).join('\n\n');
    }

    function stripComments(js) {
      return js.replace(coffee ? REQUIRES_RXP_COFFEE : REQUIRES_RXP, '');
    }

    function addClosure(js) {
      return coffee ? js : "(function(){\n" + js + "\n}());\n";
    }

    function bundle() {
      var js = concatenate();
      js = stripComments(js);
      if (!opts.global) {
        js = addClosure(js);
      }
      return js;
    }

    this.run = function() {
      var js;
      // check that dir (still) exists
      var dirname = path.dirname(outFile);
      if (!dirExists(dirname)) {
        die("Destination directory not found: " + dirname);
      }
      try {
        js = bundle();
        fs.writeFileSync(outFile, js);
        console.log("Wrote " + outFile);
      } catch(e) {
        // Print message, don't exit (let user correct dependency problems
        // when monitoring files).
        console.error(e.message);
      }
    };

  } // CattyJob

} // Catty


function parseDeps(js, coffee) {
  var fileRxp = /\*?[_0-9a-z](?:[.-]?[_0-9a-z])*/ig,
      deps = [], match, match2;
  while (match = (coffee ? REQUIRES_RXP_COFFEE : REQUIRES_RXP).exec(js)) {
    while (match2 = fileRxp.exec(match[1])) {
      deps.push(match2[0]);
    }
  }
  return deps;
}

function findSourceFiles(dirPath, coffee) {
  var results = walkSync(dirPath);
  return results.filter(function(filePath) {
    return (coffee ? /\.coffee$/ : /\.js$/).test(filePath);
  });
}

function dirExists(path) {
  return !!getFileInfo(path).is_dir;
}

function fileExists(path) {
  return !!getFileInfo(path).is_file;
}

function getFileInfo(p) {
  var info = {}, stat;
  try {
    stat = fs.statSync(p);
    info.exists = true;
    info.is_file = stat.isFile();
    info.is_dir = stat.isDirectory();
    info.directory = path.dirname(p);
  } catch(e) {};

  if (info.is_file) {
    info.ext = path.extname(p);
    info.filename = path.basename(p);
    info.basename = info.filename.substr(0, info.filename.length - info.ext.length);
  }
  return info;
}

function walkSync(dir, memo) {
  memo = memo || [];
  var list = fs.readdirSync(dir);
  list.forEach(function(file) {
    var filepath = path.join(dir, file);
    var stat = fs.statSync(filepath);
    if (stat && stat.isDirectory()) {
      walkSync(filepath, memo);
    }
    else {
      memo.push(filepath);
    }
  });
  return memo;
}

function die(msg) {
  if (msg) console.error(msg);
  process.exit(1);
}

module.exports = function(opts) {
  return new Catty(opts); // allow multiple instances with different options
};
_.extend(module.exports, catty);
