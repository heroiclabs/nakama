%{
package querystr

import(
    "github.com/blugelabs/bluge"
)
%}

%union {
s string
n int
f float64
q bluge.Query
pf *float64}

%token tSTRING tPHRASE tPLUS tMINUS tCOLON tBOOST tNUMBER tSTRING tGREATER tLESS
tEQUAL tTILDE

%type <s>                tSTRING
%type <s>                tPHRASE
%type <s>                tNUMBER
%type <s>                posOrNegNumber
%type <s>                tTILDE
%type <s>                tBOOST
%type <q>                searchBase
%type <pf>                searchSuffix
%type <n>                searchPrefix

%%

input:
searchParts {
	yylex.(*lexerWrapper).logDebugGrammarf("INPUT")
};

searchParts:
searchPart searchParts {
	yylex.(*lexerWrapper).logDebugGrammarf("SEARCH PARTS")
}
|
searchPart {
	yylex.(*lexerWrapper).logDebugGrammarf("SEARCH PART")
};

searchPart:
searchPrefix searchBase searchSuffix {
    q := $2
    if $3 != nil {
        var err error
        q, err = queryStringSetBoost($2, *$3)
        if err != nil {
          yylex.(*lexerWrapper).lex.Error(err.Error())
        }
    }
	switch($1) {
		case queryShould:
			yylex.(*lexerWrapper).query.AddShould(q)
		case queryMust:
			yylex.(*lexerWrapper).query.AddMust(q)
		case queryMustNot:
			yylex.(*lexerWrapper).query.AddMustNot(q)
	}
};


searchPrefix:
/* empty */ {
	$$ = queryShould
}
|
tPLUS {
	yylex.(*lexerWrapper).logDebugGrammarf("PLUS")
	$$ = queryMust
}
|
tMINUS {
	yylex.(*lexerWrapper).logDebugGrammarf("MINUS")
	$$ = queryMustNot
};

searchBase:
tSTRING {
    yylex.(*lexerWrapper).logDebugGrammarf("STRING - %s", $1)
	$$ = queryStringStringToken(yylex, "", $1)
}
|
tSTRING tTILDE {
    yylex.(*lexerWrapper).logDebugGrammarf("FUZZY STRING - %s %s", $1, $2)
	q, err := queryStringStringTokenFuzzy(yylex, "", $1, $2)
    if err != nil {
      yylex.(*lexerWrapper).lex.Error(err.Error())
    }
	$$ = q
}
|
tSTRING tCOLON tSTRING tTILDE {
    yylex.(*lexerWrapper).logDebugGrammarf("FIELD - %s FUZZY STRING - %s %s", $1, $3, $4)
    q, err := queryStringStringTokenFuzzy(yylex, $1, $3, $4)
    if err != nil {
      yylex.(*lexerWrapper).lex.Error(err.Error())
    }
	$$ = q
}
|
tNUMBER {
	yylex.(*lexerWrapper).logDebugGrammarf("STRING - %s", $1)
	q, err := queryStringNumberToken(yylex, "", $1)
    if err != nil {
      yylex.(*lexerWrapper).lex.Error(err.Error())
    }
	$$ = q
}
|
tPHRASE {
	yylex.(*lexerWrapper).logDebugGrammarf("PHRASE - %s", $1)
	$$ = queryStringPhraseToken("", $1)
}
|
tSTRING tCOLON tSTRING {
	yylex.(*lexerWrapper).logDebugGrammarf("FIELD - %s STRING - %s", $1, $3)
	$$ = queryStringStringToken(yylex, $1, $3)
}
|
tSTRING tCOLON posOrNegNumber {
	yylex.(*lexerWrapper).logDebugGrammarf("FIELD - %s STRING - %s", $1, $3)
	q, err := queryStringNumberToken(yylex, $1, $3)
    if err != nil {
      yylex.(*lexerWrapper).lex.Error(err.Error())
    }
	$$ = q
}
|
tSTRING tCOLON tPHRASE {
	yylex.(*lexerWrapper).logDebugGrammarf("FIELD - %s PHRASE - %s", $1, $3)
	$$ = queryStringPhraseToken($1, $3)
}
|
tSTRING tCOLON tGREATER posOrNegNumber {
    yylex.(*lexerWrapper).logDebugGrammarf("FIELD - GREATER THAN %s", $4)
	q, err := queryStringNumericRangeGreaterThanOrEqual($1, $4, false)
    if err != nil {
      yylex.(*lexerWrapper).lex.Error(err.Error())
    }
	$$ = q
}
|
tSTRING tCOLON tGREATER tEQUAL posOrNegNumber {
    yylex.(*lexerWrapper).logDebugGrammarf("FIELD - GREATER THAN OR EQUAL %s", $5)
    q, err := queryStringNumericRangeGreaterThanOrEqual($1, $5, true)
    if err != nil {
      yylex.(*lexerWrapper).lex.Error(err.Error())
    }
    $$ = q
}
|
tSTRING tCOLON tLESS posOrNegNumber {
    yylex.(*lexerWrapper).logDebugGrammarf("FIELD - LESS THAN %s", $4)
    q, err := queryStringNumericRangeLessThanOrEqual($1, $4, false)
    if err != nil {
      yylex.(*lexerWrapper).lex.Error(err.Error())
    }
    $$ = q
}
|
tSTRING tCOLON tLESS tEQUAL posOrNegNumber {
    yylex.(*lexerWrapper).logDebugGrammarf("FIELD - LESS THAN OR EQUAL %s", $5)
    q, err := queryStringNumericRangeLessThanOrEqual($1, $5, true)
    if err != nil {
      yylex.(*lexerWrapper).lex.Error(err.Error())
    }
    $$ = q
}
|
tSTRING tCOLON tGREATER tPHRASE {
    yylex.(*lexerWrapper).logDebugGrammarf("FIELD - GREATER THAN DATE %s", $4)
	q, err := queryStringDateRangeGreaterThanOrEqual(yylex, $1, $4, false)
    if err != nil {
      yylex.(*lexerWrapper).lex.Error(err.Error())
    }
	$$ = q
}
|
tSTRING tCOLON tGREATER tEQUAL tPHRASE {
    yylex.(*lexerWrapper).logDebugGrammarf("FIELD - GREATER THAN OR EQUAL DATE %s", $5)
    q, err := queryStringDateRangeGreaterThanOrEqual(yylex, $1, $5, true)
    if err != nil {
      yylex.(*lexerWrapper).lex.Error(err.Error())
    }
	$$ = q
}
|
tSTRING tCOLON tLESS tPHRASE {
    yylex.(*lexerWrapper).logDebugGrammarf("FIELD - LESS THAN DATE %s", $4)
    q, err := queryStringDateRangeLessThanOrEqual(yylex, $1, $4, false)
    if err != nil {
      yylex.(*lexerWrapper).lex.Error(err.Error())
    }
	$$ = q
}
|
tSTRING tCOLON tLESS tEQUAL tPHRASE {
    yylex.(*lexerWrapper).logDebugGrammarf("FIELD - LESS THAN OR EQUAL DATE %s", $5)
    q, err := queryStringDateRangeLessThanOrEqual(yylex, $1, $5, true)
    if err != nil {
      yylex.(*lexerWrapper).lex.Error(err.Error())
    }
	$$ = q
};

searchSuffix:
/* empty */ {
	$$ = nil
}
|
tBOOST {
    $$ = nil
    yylex.(*lexerWrapper).logDebugGrammarf("BOOST %s", $1)
    boost, err := queryStringParseBoost($1)
    if err != nil {
      yylex.(*lexerWrapper).lex.Error(err.Error())
    } else {
        $$ = &boost
    }
};

posOrNegNumber:
tNUMBER {
	$$ = $1
}
|
tMINUS tNUMBER {
	$$ = "-" + $2
};
