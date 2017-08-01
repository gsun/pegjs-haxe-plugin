
exports.use = function(config, options){
    config.passes.generate = [
      require("./passes/generate-bytecode-hx"),
      require("./passes/generate-hx")
    ];
    options.output = "source";
    if (!options.hxpegjs) options.hxpegjs = {};
    if (options.hxpegjs.parserClassName === undefined) options.hxpegjs.parserClassName = 'PegParser';
};