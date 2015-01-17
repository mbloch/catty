var fs = require('fs');
var path = require('path');
var _ = require('underscore');
var catty = new Catty();

// Matches comments like:
// /* @requires name1, name2, name3 */
// (Comments may span multiple lines, commas are optional)
var REQUIRES_RXP = /\/\*+\s*@requires?\b([\s,;_0-9A-Za-z.-]+)\s*\*+\//g;

function Catty(opts) {
  opts = _.extend({
    global: false,
    follow: false
  }, opts || {});

  var filePathIndex = {},   // paths of known js files indexed by filename
      watchedFiles = {},  // SourceFile objects indexed by filename
      jobs = [];

  // @path A directory containing JavaScript source files
  //   (subdirectories are also indexed)
  this.addLibrary = function(path) {
    if (!dirExists(path)) {
      die("Not a valid directory: " + path);
    }
    findSourceFiles(path).forEach(indexFile);
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
    })
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
          if (nodeName in sorted == false && startNode.requiresFile(nodeName)) {
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
    } else if (name in filePathIndex === false) {
      filePathIndex[name] = path;
    } else if (filePathIndex[name] !== path) {
      console.log("File name collision.");
      console.log("Using:", filePathIndex[name]);
      console.log("Ignoring:", path);
    }
    return name;
  }

  function addDependency(key) {
    var node;
    if (key in filePathIndex === false) {
      throw new Error("Unknown dependency -- " + key);
    }
    if (key in watchedFiles === false) {
      node = new SourceFile(filePathIndex[key]);
      node.getDeps().forEach(addDependency);
      if (opts.follow) {
        node.startMonitoring(function(err) {
          if (err) {
            console.error(err.message);
          } else {
            console.log("Re-catting -- change in " + node.filename());
            runJobs(); // TODO: only run jobs that use this the changed source file
          }
        });
      }
    }
  }

  function SourceFile(path) {
    var info = getFileInfo(path),
        _self = this,
        _id = SourceFile.count ? ++SourceFile.count : (SourceFile.count = 1),
        _deps = [],
        _js = "";

    if (!info.is_file || info.ext != '.js') {
      die("Invalid source file: " + path);
    }
    watchedFiles[info.basename] = this;

    this.name = getName;
    this.filename = function() {
      return info.filename;
    };
    this.content = function() { return _js; };
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
        if (reqName in visited == false) {
          var reqNode = watchedFiles[reqName];
          if (reqNode.requiresFile(targName, visited)) {
            return true;
          }
        }
      }
      return false;
    };

    function getName() {
      return info.basename;
    }

    function checkFileChange() {
      var js = fs.readFileSync(path, {encoding:"utf8"});
      // (os x) When editor opens file to write, file may
      // appear to be empty -- ignoring change if len is 0
      var changed = js.length > 0 && js !== _js;
      if (changed) {
        _js = js;
        _deps = parseDeps(js);
        _deps.forEach(addDependency);
      }
      return changed;
    }

    function parseDeps(js) {
      var fileRxp = /\*?[_0-9a-z](?:[.-]?[_0-9a-z])*/ig,  // careful, don't match "*/"
          deps = [], match, match2;
      while (match = REQUIRES_RXP.exec(js)) {
        while (match2 = fileRxp.exec(match[1])) {
          deps.push(match2[0]);
        }
      }
      return deps;
    }

    this.startMonitoring = function(onChange) {
      var timeout = null;
      fs.watch(path, function(evt) {
        if (evt == "change" || evt == "rename") {
          // Use a timeout to make sure file has actually changed
          // (Had problems in os x)
          timeout && clearTimeout(timeout);
          timeout = setTimeout(function() {
            try {
              if (checkFileChange()) {
                onChange();
              }
            } catch(e) {
              onChange(e);
            }
          }, 150);
        } else {
          console.log("Unknown watch event:", evt);
        }
      });
    };

    checkFileChange();

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

    inFiles.forEach(function(ifile) {
      if (ifile == outFile) die("Tried to overwrite a source file: " + ifile);
      if (!fileExists(ifile)) die("Source file not found: " + ifile);
      var name = indexFile(ifile);
      addDependency(name);
      rootKeys.push(name);
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
      return nodes.map(function(node) { return node.content(); }).join('\n\n');
    };

    function stripComments(js) {
      return js.replace(REQUIRES_RXP, '');
    }

    function addClosure(js) {
      return "(function(){\n" + js + "\n}());\n";
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

function findSourceFiles(dirPath) {
  var results = walkSync(dirPath);
  return results.filter(function(filePath) {
    return /\.js$/.test(filePath);
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

function walkSync(dir, results) {
  results = results || [];
  var list = fs.readdirSync(dir);
  list.forEach(function(file) {
    var path = dir + "/" + file;
    var stat = fs.statSync(path);
    if (stat && stat.isDirectory()) {
      walkSync(path, results);
    }
    else {
      results.push(path);
    }
  });
  return results;
}

function die(msg) {
  if (msg) console.error(msg);
  process.exit(1);
}

module.exports = function(opts) {
  return new Catty(opts); // allow multiple instances with different options
};
_.extend(module.exports, catty);
