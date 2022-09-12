
```
meta:
	start date: 07/31/2022
	
```

## dev 

```
yarn 
yarn test // in vscode debug terminal
```


## notes

-> regex word boundary -  https://www.regular-expressions.info/wordboundaries.html

word boundary has a special property that eg. `\bworld\b` matches

```
world
 world<EOF>
world world world<EOF>
```
that means `\b` matches

* `^`, `$`, and any non word character in between.


Notes:
* flex is case insensitive




## test case explain


```
exports["test disambiguate"] = function() {
    var dict = {
        rules: [
           ["for\\b", "return 'FOR';" ],
           ["if\\b", "return 'IF';" ],
           // the reason this ambiguity can be resolved is that, the matches start from top to bottom
           // and only choose the longest match, but for FOR/IDENTIFIER is the same length
           ["[a-z]+", "return 'IDENTIFIER';" ],
           ["\\s+", "/* skip whitespace */" ],
           ["$", "return 'EOF';" ]
       ]
    };

    var input = "if forever for for";

    var lexer = new RegExpLexer(dict, input);
    assert.equal(lexer.lex(), "IF");
    assert.equal(lexer.lex(), "IDENTIFIER");
    assert.equal(lexer.lex(), "FOR");
    assert.equal(lexer.lex(), "FOR");
    assert.equal(lexer.lex(), "EOF");
};
```

has more case

> continue passing
```
exports["test generator with more complex lexer"] = function() {
    var dict = {
        rules: [
           ["x", "return 'X';" ],
           ['"[^"]*', function(){
               if(yytext.charAt(yyleng-1) == '\\') {
                  // since this clause doesn't return any TOKEN
                  // it causes the lex to recursively call itself again. without reset matched text
                   this.more();
               } else {
                   yytext += this.input(); // swallow end quote
                   return "STRING";
               }
            } ],
           ["$", "return 'EOF';" ]
       ]
    };

    var input = 'x"fgjdrtj\\"sdfsdf"x';

    var lexer_ = new RegExpLexer(dict);
    var lexerSource = lexer_.generateModule();
    eval(lexerSource);
    lexer.setInput(input);

    assert.equal(lexer.lex(), "X");
    assert.equal(lexer.lex(), "STRING");
    assert.equal(lexer.lex(), "X");
    assert.equal(lexer.lex(), "EOF");
};
```



start conditions

> this rules defination creates two sub group 'TEST' and default, 
> like TEST: Rules[], DEFAULT: Rules[]
> when matching, action can pick one of the group by using `begin(<GROUP_NAME>)` method 
> then the text matching will be done using rule inside that group

```
exports["test inclusive start conditions"] = function() {
    var dict = {
        startConditions: {
			// stackName: isExclusive
            "TEST": 0,
        },
        rules: [
			// from here on, matching text that in 'TEST' group
            ["enter-test", "this.begin('TEST');" ],
			// matching 'x'-> return 'T' 
			// this rule belongs to 'TEST' group
            [["TEST"], "x", "return 'T';" ],

			// from here on, matching text that in 'INITIAL' group
            [["TEST"], "y", "this.begin('INITIAL'); return 'TY';" ],
            ["x", "return 'X';" ],
            ["y", "return 'Y';" ],
            ["$", "return 'EOF';" ]
        ]
    };
    var input = "xenter-testxyy";

    var lexer = new RegExpLexer(dict);
    lexer.setInput(input);

    assert.equal(lexer.lex(), "X");
    assert.equal(lexer.lex(), "T");
    assert.equal(lexer.lex(), "TY");
    assert.equal(lexer.lex(), "Y");
    assert.equal(lexer.lex(), "EOF");
};
```

start condition: exclusive rules

> `exclusive`, if true, rules without explicit group name would not be added to this group
> so in the following example, 'EAT' group only has rules with [1, 2] index. and the default
> group 'INITIAL' will has all other non-explicit rules which are [0, 3, 4, 5]

```
exports["test exclusive start conditions"] = function() {
    var dict = {
        startConditions: {
            "EAT": 1,
            //     ^ exclusive set to true
        },
        rules: [
            ["\\/\\/", "this.begin('EAT');" ],
            [["EAT"], ".", "" ],
            [["EAT"], "\\n", "this.begin('INITIAL');" ],
            ["x", "return 'X';" ],
            ["y", "return 'Y';" ],
            ["$", "return 'EOF';" ]
        ]
    };
    var input = "xy//yxteadh//ste\ny";
    //               ^ from y , matching will be using rules inside 'EAT' group
    //               . rule match a char but returns no token, so it swallows char until
    //                            \n
    //                            ^ switch to `INITIAL` group
    //                             y
    //                             ^ y is matched against rule 4, return 'Y'

    var lexer = new RegExpLexer(dict);
    lexer.setInput(input);

    assert.equal(lexer.lex(), "X");
    assert.equal(lexer.lex(), "Y");
    assert.equal(lexer.lex(), "Y");
    assert.equal(lexer.lex(), "EOF");
};

```

start condition: star rule

```
exports["test star start condition"] = function() {
    var dict = {
        startConditions: {
            "EAT": 1,
        },
        rules: [
            ["\\/\\/", "this.begin('EAT');" ],
            [["EAT"], ".", "" ],
            ["x", "return 'X';" ],
            ["y", "return 'Y';" ],
            // match all condition stack
            [["*"],"$", "return 'EOF';" ]
        ]
    };
    var input = "xy//yxteadh//stey";

    var lexer = new RegExpLexer(dict);
    lexer.setInput(input);

    assert.equal(lexer.lex(), "X");
    assert.equal(lexer.lex(), "Y");
    assert.equal(lexer.lex(), "EOF");
};
```

Context lexer
> this lib is context lexer, it allows parse using nested rule when certain condition are met
> and can unput char from catched input

```

exports["test EOF unput"] = function() {
    var dict = {
        startConditions: {
            "UN": 1,
        },
        rules: [
          // switch UN rule group
            ["U", "this.begin('UN');return 'U';" ],
          // unput X, since no match are made, the lex continue
            [["UN"],"$", "this.unput('X')" ],
          // match X rule, pop out UN rule group
            [["UN"],"X", "this.popState();return 'X';" ],
            ["$", "return 'EOF'" ]
        ]
    };
    var input = "U";

    var lexer = new RegExpLexer(dict);
    lexer.setInput(input);

    assert.equal(lexer.lex(), "U");
    assert.equal(lexer.lex(), "X");
    assert.equal(lexer.lex(), "EOF");
};
```



Backtracking
> 

```

exports["test backtracking lexer reject() method"] = function() {
    var dict = {
        rules: [
            // this.reject() would cause this rule to unmatch
            ["[A-Z]+([0-9]+)", "if (this.matches[1].length) this.reject(); else return 'ID';" ],
            ["[A-Z]+", "return 'WORD';" ],
            ["[0-9]+", "return 'NUM';" ]
        ],
        options: {backtrack_lexer: true}
    };
    var input = "A5";

    var lexer = new RegExpLexer(dict);
    lexer.setInput(input);

    assert.equal(lexer.lex(), "WORD");
    assert.equal(lexer.lex(), "NUM");
};

```






# jison-lex
A lexical analyzer generator used by [jison](http://jison.org). It takes a lexical grammar definition (either in JSON or Bison's lexical grammar format) and outputs a JavaScript lexer.

## install
npm install jison-lex -g

## usage
```
Usage: jison-lex [file] [options]

file     file containing a lexical grammar

Options:
   -o FILE, --outfile FILE       Filename and base module name of the generated parser
   -t TYPE, --module-type TYPE   The type of module to generate (commonjs, js)
   --version                     print version and exit
```

## programatic usage

```
var JisonLex = require('jison-lex');

var grammar = {
  rules: [
    ["x", "return 'X';" ],
    ["y", "return 'Y';" ],
    ["$", "return 'EOF';" ]
  ]
};

// or load from a file
// var grammar = fs.readFileSync('mylexer.l', 'utf8');

// generate source
var lexerSource = JisonLex.generate(grammar);

// or create a parser in memory
var lexer = new JisonLex(grammar);
lexer.setInput('xyxxy');
lexer.lex();
// => 'X'
lexer.lex();
// => 'Y'

## license
MIT
