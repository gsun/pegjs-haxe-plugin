let fs = require("fs");

var peg = require("pegjs");
var parser = peg.generate("start = ('a' / 'b')+", {output: "source"});
outputStream = fs.createWriteStream("Peg.hx");
outputStream.write(parser);
  if (outputStream !== process.stdout) {
    outputStream.end();
}