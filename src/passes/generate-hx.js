"use strict";

var arrays  = require("pegjs/lib/utils/arrays"),
    objects = require("pegjs/lib/utils/objects"),
    asts    = require("pegjs/lib/compiler/asts"),
    op      = require("pegjs/lib/compiler/opcodes"),
    js      = require("pegjs/lib/compiler/js");

/* Generates parser Haxe code. */
function generateHx(ast, options) {
  /* These only indent non-empty lines to avoid trailing whitespace. */
  function indent2(code)  { return code.replace(/^(.+)$/gm, '  $1');         }
  function indent4(code)  { return code.replace(/^(.+)$/gm, '    $1');     }
  function indent6(code)  { return code.replace(/^(.+)$/gm, '      $1');     }
  function indent10(code) { return code.replace(/^(.+)$/gm, '          $1'); }

  function generateTables() {
      return arrays.map(
        ast.consts,
        function(c, i) { return 'var c' + i + ':Dynamic;'; }
      ).join('\n');
  }
  
  function generateTableValues() {
      return arrays.map(
        ast.consts,
        function(c, i) { return 'c' + i + ' = ' + c + ';'; }
      ).join('\n');
  }

  function generateRuleHeader(ruleNameCode, ruleIndexCode) {
    var parts = [];

    parts.push('');

    if (options.trace) {
      parts.push([
        'tracer.trace({',
        '  type:     "rule.enter",',
        '  rule:     ' + ruleNameCode + ',',
        '  location: computeLocation(startPos, startPos)',
        '});',
        ''
      ].join('\n'));
    }

    return parts.join('\n');
  }

  function generateRuleFooter(ruleNameCode, resultCode) {
    var parts = [];

    if (options.trace) {
      parts.push([
          '',
          'if (' + resultCode + ' != FAILED) {',
          '  tracer.trace({',
          '    type:   "rule.match",',
          '    rule:   ' + ruleNameCode + ',',
          '    result: ' + resultCode + ',',
          '    location: computeLocation(startPos, currPos)',
          '  });',
          '} else {',
          '  tracer.trace({',
          '    type: "rule.fail",',
          '    rule: ' + ruleNameCode + ',',
          '    location: computeLocation(startPos, startPos)',
          '  });',
          '}'
      ].join('\n'));
    }

    parts.push([
      '',
      'return ' + resultCode + ';'
    ].join('\n'));

    return parts.join('\n');
  }

  function generateRuleFunction(rule) {
    var parts = [], code;

    function c(i) { return "c" + i; } // |consts[i]| of the abstract machine
    function s(i) { return "s"     + i; } // |stack[i]| of the abstract machine

    var stack = {
          sp:    -1,
          maxSp: -1,

          push: function(exprCode) {
            var code = s(++this.sp) + ' = ' + exprCode + ';';

            if (this.sp > this.maxSp) { this.maxSp = this.sp; }

            return code;
          },

          pop: function(n) {
            var values;

            if (n === void 0) {
              return s(this.sp--);
            } else {
              values = arrays.map(arrays.range(this.sp - n + 1, this.sp + 1), s);
              this.sp -= n;

              return values;
            }
          },

          top: function() {
            return s(this.sp);
          },

          index: function(i) {
            return s(this.sp - i);
          }
        };

    function compile(bc) {
      var ip    = 0,
          end   = bc.length,
          parts = [],
          value;

      function compileCondition(cond, argCount) {
        var baseLength = argCount + 3,
            thenLength = bc[ip + baseLength - 2],
            elseLength = bc[ip + baseLength - 1],
            baseSp     = stack.sp,
            thenCode, elseCode, thenSp, elseSp;

        ip += baseLength;
        thenCode = compile(bc.slice(ip, ip + thenLength));
        thenSp = stack.sp;
        ip += thenLength;

        if (elseLength > 0) {
          stack.sp = baseSp;
          elseCode = compile(bc.slice(ip, ip + elseLength));
          elseSp = stack.sp;
          ip += elseLength;

          if (thenSp !== elseSp) {
            throw new Error(
              "Branches of a condition must move the stack pointer in the same way."
            );
          }
        }

        parts.push('if (' + cond + ') {');
        parts.push(indent2(thenCode));
        if (elseLength > 0) {
          parts.push('} else {');
          parts.push(indent2(elseCode));
        }
        parts.push('}');
      }

      function compileLoop(cond) {
        var baseLength = 2,
            bodyLength = bc[ip + baseLength - 1],
            baseSp     = stack.sp,
            bodyCode, bodySp;

        ip += baseLength;
        bodyCode = compile(bc.slice(ip, ip + bodyLength));
        bodySp = stack.sp;
        ip += bodyLength;

        if (bodySp !== baseSp) {
          throw new Error("Body of a loop can't move the stack pointer.");
        }

        parts.push('while (' + cond + ') {');
        parts.push(indent2(bodyCode));
        parts.push('}');
      }

      function compileCall() {
        var baseLength   = 4,
            paramsLength = bc[ip + baseLength - 1];

        var value = c(bc[ip + 1]) + '('
              + arrays.map(
                  bc.slice(ip + baseLength, ip + baseLength + paramsLength),
                  function(p) { return stack.index(p); }
                ).join(', ')
              + ')';
        stack.pop(bc[ip + 2]);
        parts.push(stack.push(value));
        ip += baseLength + paramsLength;
      }

      while (ip < end) {
        switch (bc[ip]) {
          case op.PUSH:               // PUSH c
            parts.push(stack.push(c(bc[ip + 1])));
            ip += 2;
            break;

          case op.PUSH_CURR_POS:      // PUSH_CURR_POS
            parts.push(stack.push('currPos'));
            ip++;
            break;

          case op.PUSH_UNDEFINED:      // PUSH_UNDEFINED
            parts.push(stack.push('null'));
            ip++;
            break;

          case op.PUSH_NULL:          // PUSH_NULL
            parts.push(stack.push('null'));
            ip++;
            break;

          case op.PUSH_FAILED:        // PUSH_FAILED
            parts.push(stack.push('FAILED'));
            ip++;
            break;

          case op.PUSH_EMPTY_ARRAY:   // PUSH_EMPTY_ARRAY
            parts.push(stack.push('[]'));
            ip++;
            break;

          case op.POP:                // POP
            stack.pop();
            ip++;
            break;

          case op.POP_CURR_POS:       // POP_CURR_POS
            parts.push('currPos = ' + stack.pop() + ';');
            ip++;
            break;

          case op.POP_N:              // POP_N n
            stack.pop(bc[ip + 1]);
            ip += 2;
            break;

          case op.NIP:                // NIP
            value = stack.pop();
            stack.pop();
            parts.push(stack.push(value));
            ip++;
            break;

          case op.APPEND:             // APPEND
            value = stack.pop();
            parts.push(stack.top() + '.push(' + value + ');');
            ip++;
            break;

          case op.WRAP:               // WRAP n
            parts.push(
              stack.push('[' + stack.pop(bc[ip + 1]).join(', ') + ']')
            );
            ip += 2;
            break;

          case op.TEXT:               // TEXT
            parts.push(
              stack.push('input.substring(' + stack.pop() + ', currPos)')
            );
            ip++;
            break;

          case op.IF:                 // IF t, f
            compileCondition(stack.top(), 0);
            break;

          case op.IF_ERROR:           // IF_ERROR t, f
            compileCondition(stack.top() + ' == FAILED', 0);
            break;

          case op.IF_NOT_ERROR:       // IF_NOT_ERROR t, f
            compileCondition(stack.top() + ' != FAILED', 0);
            break;

          case op.WHILE_NOT_ERROR:    // WHILE_NOT_ERROR b
            compileLoop(stack.top() + ' != FAILED', 0);
            break;

          case op.MATCH_ANY:          // MATCH_ANY a, f, ...
            compileCondition('input.length > currPos', 0);
            break;

          case op.MATCH_STRING:       // MATCH_STRING s, a, f, ...
            compileCondition(
              eval(ast.consts[bc[ip + 1]]).length > 1
                ? 'input.substr(currPos, '
                    + eval(ast.consts[bc[ip + 1]]).length
                    + ') == '
                    + c(bc[ip + 1])
                : 'input.charCodeAt(currPos) == '
                    + eval(ast.consts[bc[ip + 1]]).charCodeAt(0),
              1
            );
            break;

          case op.MATCH_STRING_IC:    // MATCH_STRING_IC s, a, f, ...
            compileCondition(
              'input.substr(currPos, '
                + eval(ast.consts[bc[ip + 1]]).length
                + ').toLowerCase() == '
                + c(bc[ip + 1]),
              1
            );
            break;

          case op.MATCH_REGEXP:       // MATCH_REGEXP r, a, f, ...
            compileCondition(
              c(bc[ip + 1]) + '.match(input.charAt(currPos))',
              1
            );
            break;

          case op.ACCEPT_N:           // ACCEPT_N n
            parts.push(stack.push(
              bc[ip + 1] > 1
                ? 'input.substr(currPos, ' + bc[ip + 1] + ')'
                : 'input.charAt(currPos)'
            ));
            parts.push(
              bc[ip + 1] > 1
                ? 'currPos += ' + bc[ip + 1] + ';'
                : 'currPos++;'
            );
            ip += 2;
            break;

          case op.ACCEPT_STRING:      // ACCEPT_STRING s
            parts.push(stack.push(c(bc[ip + 1])));
            parts.push(
              eval(ast.consts[bc[ip + 1]]).length > 1
                ? 'currPos += ' + eval(ast.consts[bc[ip + 1]]).length + ';'
                : 'currPos++;'
            );
            ip += 2;
            break;

          case op.FAIL:               // FAIL e
            parts.push(stack.push('FAILED'));
            parts.push('if (silentFails == 0) { fail(' + c(bc[ip + 1]) + '); }');
            ip += 2;
            break;

          case op.LOAD_SAVED_POS:     // LOAD_SAVED_POS p
            parts.push('savedPos = ' + stack.index(bc[ip + 1]) + ';');
            ip += 2;
            break;

          case op.UPDATE_SAVED_POS:   // UPDATE_SAVED_POS
            parts.push('savedPos = currPos;');
            ip++;
            break;

          case op.CALL:               // CALL f, n, pc, p1, p2, ..., pN
            compileCall();
            break;

          case op.RULE:               // RULE r
            parts.push(stack.push("parse" + ast.rules[bc[ip + 1]].name + "()"));
            ip += 2;
            break;

          case op.SILENT_FAILS_ON:    // SILENT_FAILS_ON
            parts.push('silentFails++;');
            ip++;
            break;

          case op.SILENT_FAILS_OFF:   // SILENT_FAILS_OFF
            parts.push('silentFails--;');
            ip++;
            break;

          default:
            throw new Error("Invalid opcode: " + bc[ip] + ".");
        }
      }

      return parts.join('\n');
    }

    code = compile(rule.bytecode);

    parts.push('function parse' + rule.name + '() {');

    if (options.trace) {
      parts.push([
        '  var ' + arrays.map(arrays.range(0, stack.maxSp + 1), s).join(', ') + ',',
        '      startPos = currPos;'
      ].join('\n'));
    } else {
      parts.push(
        '  var ' + arrays.map(arrays.range(0, stack.maxSp + 1), s).join(':Dynamic, ') + ':Dynamic;'
      );
    }

    parts.push(indent2(generateRuleHeader(
      '"' + js.stringEscape(rule.name) + '"',
      asts.indexOfRule(ast, rule.name)
    )));
    parts.push(indent2(code));
    parts.push(indent2(generateRuleFooter(
      '"' + js.stringEscape(rule.name) + '"',
      s(0)
    )));

    parts.push('}');

    return parts.join('\n');
  }

  function generateToplevel() {
    var parts = [],
        startRuleIndices,   startRuleIndex,
        startRuleFunctions, startRuleFunction,
        ruleNames;

    parts.push([
      'typedef Position = {',
      '    line:Int,',
      '    column:Int,',
      '    ?offset:Int,',
      '}',
      'typedef Location = {',
      '    start:Position,',
      '    end:Position,',
      '}',
      'typedef FailedType = {',
      '    fail:Bool,',
      '}',
      'enum Expected {',
      '    literal(text:String, ignoreCase:Bool);',
      '    cls(parts:Array<String>, inverted:Bool, ignoreCase:Bool);',
      '    any;',
      '    end;',
      '    other(description:String);',
      '}',
      ''
    ].join('\n'));
    
    parts.push([
      'class SyntaxError {',
      '  var message:String;',
      '  var expected:Array<Expected>;',
      '  var found:String;',
      '  var location:Location;',
      '',
      '  public function new(message, expected, found, location) {',
      '    this.message  = message;',
      '    this.expected = expected;',
      '    this.found    = found;',
      '    this.location = location;',
      '  }',
      '',
      '  static function describeExpected(expected:Array<Expected>) {',
      '    return Std.string(expected);',
      '  }',
      '',
      '  static function describeFound(?found) {',
      '    return found != null ? found : "end of input";',
      '  }',
      '',
      '  static public function buildMessage (expected, found) {',
      '    return "Expected " + describeExpected(expected) + " but " + describeFound(found) + " found.";',
      '  }',
      '}',
      ''
    ].join('\n'));

    if (options.trace) {
      parts.push([
        'function DefaultTracer() {',
        '  this.indentLevel = 0;',
        '}',
        '',
        'DefaultTracer.prototype.trace = function(event) {',
        '  var that = this;',
        '',
        '  function log(event) {',
        '    function repeat(string, n) {',
        '       var result = "", i;',
        '',
        '       for (i = 0; i < n; i++) {',
        '         result += string;',
        '       }',
        '',
        '       return result;',
        '    }',
        '',
        '    function pad(string, length) {',
        '      return string + repeat(" ", length - string.length);',
        '    }',
        '',
        '    if (typeof console === "object") {',   // IE 8-10
        '      console.log(',
        '        event.location.start.line + ":" + event.location.start.column + "-"',
        '          + event.location.end.line + ":" + event.location.end.column + " "',
        '          + pad(event.type, 10) + " "',
        '          + repeat("  ", that.indentLevel) + event.rule',
        '      );',
        '    }',
        '  }',
        '',
        '  switch (event.type) {',
        '    case "rule.enter":',
        '      log(event);',
        '      this.indentLevel++;',
        '      break;',
        '',
        '    case "rule.match":',
        '      this.indentLevel--;',
        '      log(event);',
        '      break;',
        '',
        '    case "rule.fail":',
        '      this.indentLevel--;',
        '      log(event);',
        '      break;',
        '',
        '    default:',
        '      throw new Error("Invalid event type: " + event.type + ".");',
        '  }',
        '};',
        ''
      ].join('\n'));
    }

    parts.push([
      'class PegParser {',
      ''
    ].join('\n'));
    
    parts.push(indent2(generateTables()));

    parts.push(indent2([
      '',
      'var input:String;',
      'var startRuleFunctions:Map<String, Void->Dynamic>;',
      'var startRuleFunction:Void->Dynamic;',
      'var currPos:Int;',
      'var savedPos:Int;',
      'var posDetailsCache:Array<Position>;',
      'var maxFailPos:Int;',
      'var maxFailExpected:Array<Expected>;',
      'var silentFails:Int;',
      'var FAILED:FailedType;',
      ''
    ].join('\n')));
    
    parts.push(indent2([
      '',
      'public function new(input, ?options:Map<String, String>) {',
      '  var options = (options != null) ? options : new Map<String, String>();',
      '',
      '  FAILED = {fail:true,};',
      '  this.input = input;',
      ''
    ].join('\n')));
    

      startRuleFunctions = '[ '
                       + arrays.map(
                           options.allowedStartRules,
                           function(r) { return '"' + r + '"' + '=> parse' + r; }
                         ).join(', ')
                       + ' ]';
      startRuleFunction = 'parse' + options.allowedStartRules[0];

      parts.push([
        '    startRuleFunctions = ' + startRuleFunctions + ';',
        '    startRuleFunction  = ' + startRuleFunction + ';'
      ].join('\n'));
    
    parts.push(indent4(generateTableValues()));

    parts.push([
      '',
      '    currPos          = 0;',
      '    savedPos         = 0;',
      '    posDetailsCache  = [{ line: 1, column: 1 }];',
      '    maxFailPos       = 0;',
      '    maxFailExpected  = [];',
      '    silentFails      = 0;',   // 0 = report failures, > 0 = silence failures
      ''
    ].join('\n'));

    if (options.trace) {
      parts.push([
        '      tracer = "tracer" in options ? options.tracer : new DefaultTracer();',
        ''
      ].join('\n'));
    }


      parts.push(indent4([
        'if (options.exists("startRule")) {',
        '  if (!(startRuleFunctions.exists(options["startRule"]))) {',
        '    throw "Can\'t start parsing from rule \\"" + options["startRule"] + "\\".";',
        '  }',
        '',
        '  startRuleFunction = startRuleFunctions[options["startRule"]];',
        '}'
      ].join('\n')));
    
    
    parts.push('  }');

    parts.push([
      '',
      '  function text() {',
      '    return input.substring(savedPos, currPos);',
      '  }',
      '',
      '  function location() {',
      '    return computeLocation(savedPos, currPos);',
      '  }',
      '',
      '  function expected(description, ?location) {',
      '    var location = (location != null) ? location : computeLocation(savedPos, currPos);',
      '',
      '    throw buildStructuredError(',
      '      [otherExpectation(description)],',
      '      input.substring(savedPos, currPos),',
      '      location',
      '    );',
      '  }',
      '',
      '  function error(message, ?location) {',
      '    var location = (location != null) ? location : computeLocation(savedPos, currPos);',
      '',
      '    throw buildSimpleError(message, location);',
      '  }',
      '',
      '  static function literalExpectation(text, ignoreCase):Expected {',
      '    return literal(text, ignoreCase);',
      '  }',
      '',
      '  static function classExpectation(parts, inverted, ignoreCase):Expected {',
      '    return cls(parts, inverted, ignoreCase);',
      '  }',
      '',
      '  static function anyExpectation():Expected {',
      '    return any;',
      '  }',
      '',
      '  static function endExpectation():Expected {',
      '    return end;',
      '  }',
      '',
      '  static function otherExpectation(description):Expected {',
      '    return other(description);',
      '  }',
      '',
      '  function computePosDetails(pos) {',
      '    var details = posDetailsCache[pos], p;',
      '',
      '    if (details != null) {',
      '      return details;',
      '    } else {',
      '      p = pos - 1;',
      '      while (posDetailsCache[p] == null) {',
      '        p--;',
      '      }',
      '',
      '      details = posDetailsCache[p];',
      '      details = {',
      '        line:   details.line,',
      '        column: details.column',
      '      };',
      '',
      '      while (p < pos) {',
      '        if (input.charCodeAt(p) == 10) {',
      '          details.line++;',
      '          details.column = 1;',
      '        } else {',
      '          details.column++;',
      '        }',
      '',
      '        p++;',
      '      }',
      '',
      '      posDetailsCache[pos] = details;',
      '      return details;',
      '    }',
      '  }',
      '',
      '  function computeLocation(startPos, endPos) {',
      '    var startPosDetails = computePosDetails(startPos),',
      '        endPosDetails   = computePosDetails(endPos);',
      '',
      '    return {',
      '      start: {',
      '        offset: startPos,',
      '        line:   startPosDetails.line,',
      '        column: startPosDetails.column',
      '      },',
      '      end: {',
      '        offset: endPos,',
      '        line:   endPosDetails.line,',
      '        column: endPosDetails.column',
      '      }',
      '    };',
      '  }',
      '',
      '  function fail(expected) {',
      '    if (currPos < maxFailPos) { return; }',
      '',
      '    if (currPos > maxFailPos) {',
      '      maxFailPos = currPos;',
      '      maxFailExpected = [];',
      '    }',
      '',
      '    maxFailExpected.push(expected);',
      '  }',
      '',
      '  function buildSimpleError(message, location) {',
      '    return new SyntaxError(message, null, null, location);',
      '  }',
      '',
      '  function buildStructuredError(expected, found, location) {',
      '    return new SyntaxError(',
      '      SyntaxError.buildMessage(expected, found),',
      '      expected,',
      '      found,',
      '      location',
      '    );',
      '  }',
      ''
    ].join('\n'));

    
      arrays.each(ast.rules, function(rule) {
        parts.push(indent2(generateRuleFunction(rule)));
        parts.push('');
      });
    

    if (ast.initializer) {
      parts.push(indent2(ast.initializer.code));
      parts.push('');
    }

    parts.push(indent2([
      'public function parse() {',
      '  var result = startRuleFunction();',
      '',
      '  if (result != FAILED && currPos == input.length) {',
      '    return result;',
      '  } else {',
      '    if (result != FAILED && currPos < input.length) {',
      '      fail(endExpectation());',
      '    }',
      '',
      '    throw buildStructuredError(',
      '      maxFailExpected,',
      '      maxFailPos < input.length ? input.charAt(maxFailPos) : null,',
      '      maxFailPos < input.length',
      '        ? computeLocation(maxFailPos, maxFailPos + 1)',
      '        : computeLocation(maxFailPos, maxFailPos)',
      '    );',
      '  }',
      '}'
    ].join('\n')));
    
    parts.push("}");

    return parts.join('\n');
  }

  function generateWrapper(toplevelCode) {
    function generateGeneratedByComment() {
      return [
        '/*',
        ' * Generated by PEG.js 0.10.0. haxe plugin',
        ' *',
        ' * http://pegjs.org/',
        ' */'
      ].join('\n');
    }
    
    function generateGeneratedByImport() {
      return [
        'import Lambda;',
      ].join('\n');
    }

    return [
          generateGeneratedByComment(),
          generateGeneratedByImport(),
          toplevelCode,
        ].join('\n');
  }

  ast.code = generateWrapper(generateToplevel());
}

module.exports = generateHx;
