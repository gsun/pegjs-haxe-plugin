
exports.use = function(config, options){
    config.passes.generate = [
      require("./passes/generate-bytecode-hx"),
      require("./passes/generate-hx")
    ];
    options.output = "source";
};