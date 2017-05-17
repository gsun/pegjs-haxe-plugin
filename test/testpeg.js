let fs = require("fs");

var peg = require("pegjs");
var hxpegjs = require('../src/hxpegjs.js');

var parser = peg.generate("start = ('a' / 'b')+", {plugins: [hxpegjs]});
outputStream = fs.createWriteStream("Peg.hx");
outputStream.write(parser);
  if (outputStream !== process.stdout) {
    outputStream.end();
}
