// Basic Lexer implemented using JavaScript regular expressions
// MIT Licensed

"use strict";

var lexParser = require('lex-parser');
var version = require('./package.json').version;


/*
@params rules
        rules: [
           ["x", "return 'X';" ],
           ["y", "return 'Y';" ],
           ["{digit}+", "return 'NAT';" ],
           ["$", "return 'EOF';" ]
       ]
@params macros
        macros: {
            "digit": "[0-9]"
        },
@params actions: List<string>
		code to be inserted into the final switch function
	
@params tokens
	terminals of Gramma Syntax
@params startConditions
	{
		[key: string]: {
			inclusive: boolean,
			rules: 
		}
	}
@params caseless
	if true, ignore case when matching
*/
// expand macros and convert matchers to RegExp's
function prepareRules(rules, macros, actions, tokens, startConditions, caseless) {
    var m,i,k,action,conditions,
        newRules = [];

    if (macros) {
        macros = prepareMacros(macros);
    }

    function tokenNumberReplacement (str, token) {
        return "return " + (tokens[token] || "'" + token + "'");
    }

    actions.push('switch($avoiding_name_collisions) {');

    for (i=0;i < rules.length; i++) {
		// result[i][0] is not Array
        if (Object.prototype.toString.apply(rules[i][0]) !== '[object Array]') {
            // implicit add to all inclusive start conditions
            for (k in startConditions) {
                if (startConditions[k].inclusive) {
                    startConditions[k].rules.push(i);
                }
            }
        } else if (rules[i][0][0] === '*') {
            // Add to ALL start conditions
            for (k in startConditions) {
                startConditions[k].rules.push(i);
            }
            rules[i].shift();
        } else {
			/*
			Rules: 
				[["TEST"], "x", "return 'T';" ],
				[["TEST"], "y", "this.begin('INITIAL'); return 'TY';" ],

			handle rules like above


			*/

            // Add to explicit start conditions
			// this return ['TEST']
            conditions = rules[i].shift();
            for (k=0;k<conditions.length;k++) {
				// push rule's index to its corresponding stack
                startConditions[conditions[k]].rules.push(i);
            }
        }

        m = rules[i][0];
        if (typeof m === 'string') {
            for (k in macros) {
                if (macros.hasOwnProperty(k)) {
                    m = m.split("{" + k + "}").join('(' + macros[k] + ')');
                }
            }
            m = new RegExp("^(?:" + m + ")", caseless ? 'i':'');
        }
        newRules.push(m);

		// process action, keep statements inside function body
        if (typeof rules[i][1] === 'function') {
            rules[i][1] = String(rules[i][1]).replace(/^\s*function \w+?\(\)\s?\{/, '').replace(/\}\s*$/, '');
        }
        action = rules[i][1];
        if (tokens && action.match(/return '[^']+'/)) {
            action = action.replace(/return '([^']+)'/g, tokenNumberReplacement);
        }
        actions.push('case ' + i + ':' + action + '\nbreak;');
    }
    actions.push("}");

    return newRules;
}

// expand macros within macros
// m: see test case `test nested macros`
// this is simple yet effective approach, but not for Circular Dependent case
function prepareMacros (macros) {
    var cont = true,
        m,i,k,mnew;
    while (cont) {
        cont = false;
        for (i in macros) if (macros.hasOwnProperty(i)) {
            m = macros[i];
            // i!= k, exclude same macro rule
            for (k in macros) if (macros.hasOwnProperty(k) && i !== k) {
				// t: split has some interesting effects
                mnew = m.split("{" + k + "}").join('(' + macros[k] + ')');
                if (mnew !== m) {
                    cont = true;
                    macros[i] = mnew;
                }
            }
        }
    }
    return macros;
}

function prepareStartConditions (conditions) {
    var sc,
        hash = {};
    for (sc in conditions) if (conditions.hasOwnProperty(sc)) {
		// not condtions[sc]
        hash[sc] = {rules:[],inclusive:!!!conditions[sc]};
    }
    return hash;
}

function buildActions (dict, tokens) {
    var actions = [dict.actionInclude || '', "var YYSTATE=YY_START;"];
    var tok;
    var toks = {};

	// invser key/value of tokens
    for (tok in tokens) {
        toks[tokens[tok]] = tok;
    }

    if (dict.options && dict.options.flex) {
        dict.rules.push([".", "console.log(yytext);"]);
    }

    this.rules = prepareRules(dict.rules, dict.macros, actions, tokens && toks, this.conditions, this.options["case-insensitive"]);
    var fun = actions.join("\n");

	/*
	yytext: current matching text
	yyleng: yytext.length
	yylineno: current line number
	yyloc: [start, ends]
	*/
    "yytext yyleng yylineno yylloc".split(' ').forEach(function (yy) {
		// add yy_. to all yy*<variables>
		// yy_ holds all the matching state
        fun = fun.replace(new RegExp("\\b(" + yy + ")\\b", "g"), "yy_.$1");
    });

	// $avoiding_name_collisions, currently matching rule
    return "function anonymous(yy,yy_,$avoiding_name_collisions,YY_START) {" + fun + "\n}";
}


/*

	tokens:
		var tokens = {"2":"X", "3":"Y", "4":"EOF"};
*/
function RegExpLexer (dict, input, tokens) {
    var opts = processGrammar(dict, tokens);
    var source = generateModuleBody(opts);
	// create object from js string
    var lexer = eval(source);

    lexer.yy = {};
    if (input) {
        lexer.setInput(input);
    }

    lexer.generate = function () { return generateFromOpts(opts); };
    lexer.generateModule = function () { return generateModule(opts); };
    lexer.generateCommonJSModule = function () { return generateCommonJSModule(opts); };
    lexer.generateAMDModule = function () { return generateAMDModule(opts); };

    return lexer;
}

RegExpLexer.prototype = {
    EOF: 1,
    parseError: function parseError(str, hash) {
        if (this.yy.parser) {
            this.yy.parser.parseError(str, hash);
        } else {
            throw new Error(str);
        }
    },

    // resets the lexer, sets new input
    setInput: function (input, yy) {
        this.yy = yy || this.yy || {};
        this._input = input;
        this._more = this._backtrack = this.done = false;
        this.yylineno = this.yyleng = 0;
        this.yytext = this.matched = this.match = '';
        this.conditionStack = ['INITIAL'];
        this.yylloc = {
            first_line: 1,
            first_column: 0,
            last_line: 1,
            last_column: 0
        };
        if (this.options.ranges) {
            this.yylloc.range = [0,0];
        }
        this.offset = 0;
        return this;
    },

    // consumes and returns one char from the input
    input: function () {
        var ch = this._input[0];
        this.yytext += ch;
        this.yyleng++;
        this.offset++;
        this.match += ch;
        this.matched += ch;
        var lines = ch.match(/(?:\r\n?|\n).*/g);
        if (lines) {
            this.yylineno++;
            this.yylloc.last_line++;
        } else {
            this.yylloc.last_column++;
        }
        if (this.options.ranges) {
            this.yylloc.range[1]++;
        }

        this._input = this._input.slice(1);
        return ch;
    },

    // unshifts one char (or a string) into the input
    unput: function (ch) {
        var len = ch.length;
        var lines = ch.split(/(?:\r\n?|\n)/g);

        this._input = ch + this._input;
        this.yytext = this.yytext.substr(0, this.yytext.length - len);
        //this.yyleng -= len;
        this.offset -= len;
        var oldLines = this.match.split(/(?:\r\n?|\n)/g);
		// m: match & yytext diverge from here
		// t:? why only remove last char from this.match ? 
        this.match = this.match.substr(0, this.match.length - 1);
        this.matched = this.matched.substr(0, this.matched.length - 1);

        if (lines.length - 1) {
            this.yylineno -= lines.length - 1;
        }
        var r = this.yylloc.range;

        this.yylloc = {
            first_line: this.yylloc.first_line,
            last_line: this.yylineno + 1,
            first_column: this.yylloc.first_column,
            last_column: lines ?
			// m: I dont think this line matters, it should always use the second line as formula to calc the last_column
                (lines.length === oldLines.length ? this.yylloc.first_column : 0)
                 + oldLines[oldLines.length - lines.length].length - lines[0].length :
				// no lines, could be empty ch?
              this.yylloc.first_column - len
        };

        if (this.options.ranges) {
            this.yylloc.range = [r[0], r[0] + this.yyleng - len];
        }
        this.yyleng = this.yytext.length;
        return this;
    },

    // When called from action, caches matched text and appends it on next action
    more: function () {
        this._more = true;
        return this;
    },

    // When called from action, signals the lexer that this rule fails to match the input, so the next matching rule (regex) should be tested instead.
    reject: function () {
        if (this.options.backtrack_lexer) {
            this._backtrack = true;
        } else {
            return this.parseError('Lexical error on line ' + (this.yylineno + 1) + '. You can only invoke reject() in the lexer when the lexer is of the backtracking persuasion (options.backtrack_lexer = true).\n' + this.showPosition(), {
                text: "",
                token: null,
                line: this.yylineno
            });

        }
        return this;
    },

    // retain first n characters of the match
    less: function (n) {
        this.unput(this.match.slice(n));
    },

    // displays already matched input, i.e. for error messages
    pastInput: function () {
        var past = this.matched.substr(0, this.matched.length - this.match.length);
        return (past.length > 20 ? '...':'') + past.substr(-20).replace(/\n/g, "");
    },

    // displays upcoming input, i.e. for error messages
    upcomingInput: function () {
        var next = this.match;
        if (next.length < 20) {
            next += this._input.substr(0, 20-next.length);
        }
        return (next.substr(0,20) + (next.length > 20 ? '...' : '')).replace(/\n/g, "");
    },

    // displays the character position where the lexing error occurred, i.e. for error messages
    showPosition: function () {
        var pre = this.pastInput();
        var c = new Array(pre.length + 1).join("-");
        return pre + this.upcomingInput() + "\n" + c + "^";
    },

    // test the lexed token: return FALSE when not a match, otherwise return token
    test_match: function(match, indexed_rule) {
        var token,
            lines,
            backup;

        if (this.options.backtrack_lexer) {
            // save context
            backup = {
				// line no.
                yylineno: this.yylineno,
                yylloc: {
					// prematched line
                    first_line: this.yylloc.first_line,
					// current matched line
                    last_line: this.last_line,
					// prematched column
                    first_column: this.yylloc.first_column,
					// current matched col
                    last_column: this.yylloc.last_column
                },
				// current match text
                yytext: this.yytext,
				// current match text
                match: this.match,
				// current regex match group
                matches: this.matches,
				// all previous matches
                matched: this.matched,
				// yytext.length
                yyleng: this.yyleng,
				// 
                offset: this.offset,
				// 
                _more: this._more,
				// remaining text
                _input: this._input,
				// 
                yy: this.yy,
				// 
                conditionStack: this.conditionStack.slice(0),
				//
                done: this.done
            };
            if (this.options.ranges) {
				// range [start, end]
                backup.yylloc.range = this.yylloc.range.slice(0);
            }
        }

        lines = match[0].match(/(?:\r\n?|\n).*/g);
        if (lines) {
            this.yylineno += lines.length;
        }
        this.yylloc = {
			// previous matched line, start from 1
            first_line: this.yylloc.last_line,
			// current matched line
            last_line: this.yylineno + 1,
			// previous matched column, start from 0
            first_column: this.yylloc.last_column,
			// current matched column
            last_column: lines ?
			// lines would be ['\n', '\n', '\n']
			// so when lines exits, this would reset last_column to 0
                         lines[lines.length - 1].length - lines[lines.length - 1].match(/\r?\n?/)[0].length :
                         this.yylloc.last_column + match[0].length
        };
        this.yytext += match[0];
        this.match += match[0];
        this.matches = match;
        this.yyleng = this.yytext.length;
        if (this.options.ranges) {
            this.yylloc.range = [this.offset, this.offset += this.yyleng];
        }
        this._more = false;
        this._backtrack = false;
        this._input = this._input.slice(match[0].length);
        this.matched += match[0];
		/*
			* this.yy: {}
			* indexed_rule: number
			* conditionStack: Array<string>,  eg. ['initial']
		*/
        token = this.performAction.call(this, this.yy, this, indexed_rule, this.conditionStack[this.conditionStack.length - 1]);
		// if has more input, reset this.done
        if (this.done && this._input) {
            this.done = false;
        }
        if (token) {
            return token;
        } else if (this._backtrack) {
			// unmatch, reset to previous state, and try next rule
            // recover context
            for (var k in backup) {
                this[k] = backup[k];
            }
            return false; // rule action called reject() implying the next rule should be tested instead.
        }
        return false;
    },

    // return next match in input
    next: function () {
        if (this.done) {
            return this.EOF;
        }
        if (!this._input) {
            this.done = true;
        }

        var token,
            match,
            tempMatch,
            index;

		// if has more, don't reset yytext and match
        if (!this._more) {
            this.yytext = '';
            this.match = '';
        }
		// rules: List<number>
		// eg.[0, 1, 2]
        var rules = this._currentRules();
        for (var i = 0; i < rules.length; i++) {
            tempMatch = this._input.match(this.rules[rules[i]]);
			// has a match and only the longest match
            if (tempMatch && (!match || tempMatch[0].length > match[0].length)) {
                match = tempMatch;
                index = i;
                if (this.options.backtrack_lexer) {
                    token = this.test_match(tempMatch, rules[i]);
                    if (token !== false) {
                        return token;
                    } else if (this._backtrack) {
                        match = false;
                        continue; // rule action called reject() implying a rule MISmatch.
                    } else {
                        // else: this is a lexer rule which consumes input without producing a token (e.g. whitespace)
                        return false;
                    }

				// flex option would make the `matching against rule loop` continue
				// since what flex essentially does it log unmatched chars
                } else if (!this.options.flex) {
                    break;
                }
            }
        }
        if (match) {
            token = this.test_match(match, rules[index]);
            if (token !== false) {
                return token;
            }
            // else: this is a lexer rule which consumes input without producing a token (e.g. whitespace)
            return false;
        }
        if (this._input === "") {
            return this.EOF;
        } else {
            return this.parseError('Lexical error on line ' + (this.yylineno + 1) + '. Unrecognized text.\n' + this.showPosition(), {
                text: "",
                token: null,
                line: this.yylineno
            });
        }
    },

    // return next match that has a token
    lex: function lex () {
        var r = this.next();
		// if returns false, continously trying to find next token.
        if (r) {
            return r;
        } else {
            return this.lex();
        }
    },

    // activates a new lexer condition state (pushes the new lexer condition state onto the condition stack)
    begin: function begin (condition) {
        this.conditionStack.push(condition);
    },

    // pop the previously active lexer condition state off the condition stack
    popState: function popState () {
        var n = this.conditionStack.length - 1;
        if (n > 0) {
            return this.conditionStack.pop();
        } else {
			// 0 index is never poped
            return this.conditionStack[0];
        }
    },

    // produce the lexer rule set which is active for the currently active lexer condition state
	/*
	
	interface condition {
		[stackName: string]: {
			rules: List<nubmer>,
			inclusive: boolean
		}
	}
	*/
    _currentRules: function _currentRules () {
        if (this.conditionStack.length && this.conditionStack[this.conditionStack.length - 1]) {
            return this.conditions[this.conditionStack[this.conditionStack.length - 1]].rules;
        } else {
            return this.conditions["INITIAL"].rules;
        }
    },

    // return the currently active lexer condition state; when an index argument is provided it produces the N-th previous condition state, if available
    topState: function topState (n) {
        n = this.conditionStack.length - 1 - Math.abs(n || 0);
        if (n >= 0) {
            return this.conditionStack[n];
        } else {
            return "INITIAL";
        }
    },

    // alias for begin(condition)
    pushState: function pushState (condition) {
        this.begin(condition);
    },

    // return the number of states pushed
    stateStackSize: function stateStackSize() {
        return this.conditionStack.length;
    }
};


// generate lexer source from a grammar
function generate (dict, tokens) {
    var opt = processGrammar(dict, tokens);

    return generateFromOpts(opt);
}

// process the grammar and build final data structures and functions
function processGrammar(dict, tokens) {
    var opts = {};
    if (typeof dict === 'string') {
        dict = lexParser.parse(dict);
    }
    dict = dict || {};

    opts.options = dict.options || {};
    opts.moduleType = opts.options.moduleType;
    opts.moduleName = opts.options.moduleName;

	// t:?
    opts.conditions = prepareStartConditions(dict.startConditions);
    opts.conditions.INITIAL = {rules:[],inclusive:true};

    opts.performAction = buildActions.call(opts, dict, tokens);
    opts.conditionStack = ['INITIAL'];

    opts.moduleInclude = (dict.moduleInclude || '').trim();
    return opts;
}

// Assemble the final source from the processed grammar
function generateFromOpts (opt) {
    var code = "";

    if (opt.moduleType === 'commonjs') {
        code = generateCommonJSModule(opt);
    } else if (opt.moduleType === 'amd') {
        code = generateAMDModule(opt);
    } else {
        code = generateModule(opt);
    }

    return code;
}

/*

@param opt:
	opt.options
	opt.performAction
*/
function generateModuleBody (opt) {
    var functionDescriptions = {
        setInput: "resets the lexer, sets new input",
        input: "consumes and returns one char from the input",
        unput: "unshifts one char (or a string) into the input",
        more: "When called from action, caches matched text and appends it on next action",
        reject: "When called from action, signals the lexer that this rule fails to match the input, so the next matching rule (regex) should be tested instead.",
        less: "retain first n characters of the match",
        pastInput: "displays already matched input, i.e. for error messages",
        upcomingInput: "displays upcoming input, i.e. for error messages",
        showPosition: "displays the character position where the lexing error occurred, i.e. for error messages",
        test_match: "test the lexed token: return FALSE when not a match, otherwise return token",
        next: "return next match in input",
        lex: "return next match that has a token",
        begin: "activates a new lexer condition state (pushes the new lexer condition state onto the condition stack)",
        popState: "pop the previously active lexer condition state off the condition stack",
        _currentRules: "produce the lexer rule set which is active for the currently active lexer condition state",
        topState: "return the currently active lexer condition state; when an index argument is provided it produces the N-th previous condition state, if available",
        pushState: "alias for begin(condition)",
        stateStackSize: "return the number of states currently on the stack"
    };
    var out = "({\n";
    var p = [];
    var descr;
    for (var k in RegExpLexer.prototype) {
        if (RegExpLexer.prototype.hasOwnProperty(k) && k.indexOf("generate") === -1) {
            // copy the function description as a comment before the implementation; supports multi-line descriptions
            descr = "\n";
            if (functionDescriptions[k]) {
                descr += "// " + functionDescriptions[k].replace(/\n/g, "\n\/\/ ") + "\n";
            }
            p.push(descr + k + ":" + (RegExpLexer.prototype[k].toString() || '""'));
        }
    }
    out += p.join(",\n");

    if (opt.options) {
        out += ",\noptions: " + JSON.stringify(opt.options);
    }

    out += ",\nperformAction: " + String(opt.performAction);
    out += ",\nrules: [" + opt.rules + "]";
    out += ",\nconditions: " + JSON.stringify(opt.conditions);
    out += "\n})";

    return out;
}

function generateModule(opt) {
    opt = opt || {};

    var out = "/* generated by jison-lex " + version + " */";
    var moduleName = opt.moduleName || "lexer";

    out += "\nvar " + moduleName + " = (function(){\nvar lexer = "
          + generateModuleBody(opt);

    if (opt.moduleInclude) {
		// t:?
        out += ";\n" + opt.moduleInclude;
    }

    out += ";\nreturn lexer;\n})();";

    return out;
}

function generateAMDModule(opt) {
    var out = "/* generated by jison-lex " + version + " */";

    out += "define([], function(){\nvar lexer = "
          + generateModuleBody(opt);

    if (opt.moduleInclude) {
        out += ";\n" + opt.moduleInclude;
    }

    out += ";\nreturn lexer;"
         + "\n});";

    return out;
}

function generateCommonJSModule(opt) {
    opt = opt || {};

    var out = "";
    var moduleName = opt.moduleName || "lexer";

    out += generateModule(opt);
    out += "\nexports.lexer = " + moduleName;
    out += ";\nexports.lex = function () { return " + moduleName + ".lex.apply(lexer, arguments); };";
    return out;
}

RegExpLexer.generate = generate;

module.exports = RegExpLexer;

