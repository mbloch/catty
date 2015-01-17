## Catty ##

Catty is Mapshaper's build tool. Better

### Command line tool ###

Options:
- `-f` Monitor source files, re-cat when something changes.
- `-g` Don't wrap source files in an immediate function.
- `-d` Comma-separated list of directories to monitor
- `-h` Print help message

Usage: `$ catty [options] input output`

Example: `$ catty -g -d src,lib src/input.js dist/output.js`

### Node module ###

```
require('catty')({global: true})
	.addLibrary('src')
	.addLibrary('lib')
	.cat('src/input.js', 'dist/output.js');
```
