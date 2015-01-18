## Catty ##

Catty is the source file concatenator for [Mapshaper](https://github.com/mbloch/mapshaper).

Some features:

* Each source file lists its dependencies in a formatted comment (see below). There is no manifest, unlike some other tools.
* Concatenated files are (optionally) wrapped in a self-executing function, to protect the global namespace.
* Catty can monitor source files and regenerate output files when a required source file changes.

### Command line tool ###

Usage: `$ catty [options] input output`

Options:
- `-f` Monitor source files, re-cat when something changes.
- `-g` Don't wrap source files in an immediate function.
- `-d` Comma-separated list of directories to monitor
- `-h` Print help message

Example: `$ catty -g -d src,lib src/input.js dist/output.js`

### Node module ###

```
require('catty')({global: true})
	.addLibrary('src')
	.addLibrary('lib')
	.cat('src/input.js', 'dist/output.js');
```

### Comment format ###

Some examples showing how dependencies can be listed:

```
/* @requires
mapshaper-innerlines
mapshaper-endpoints
mapshaper-dataset-utils
*/
```

```
/* @requires mapshaper-shapes, mapshaper-shape-geom */
```
