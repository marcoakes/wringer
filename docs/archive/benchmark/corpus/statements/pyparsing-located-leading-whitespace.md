# Some matches include erroneous leading whitespace

(verbatim body of https://github.com/pyparsing/pyparsing/issues/621)

It seems that there is a bug which causes some matches to include erroneous leading whitespace.

pyparsing 3.1.2 and 3.3.0a1 were checked and both of them have this bug.

I am providing a minimal reproducible example below. In the example the first match works correctly and the second includes the erroneous leading whitespace.  In the example the two expressions combined via `|` are identical, but the bug happens even if the two expressions are different

```
#!/usr/bin/env python3

import pyparsing as pp

def show_match(text, loc, tokens):
	matched = text[tokens.locn_start:tokens.locn_end]
	print(f"locn_start:{tokens.locn_start}, locn_end:{tokens.locn_end}")
	print(f"Matched string '{matched}'")

abc = pp.Keyword("abc")

expr = pp.Suppress(pp.SkipTo(abc, False)) + pp.Located(abc).set_parse_action(show_match)
expr.parse_string("ignored   abc")
# Outputs
# locn_start:10, locn_end:13
# Matched string 'abc'

expr2 = pp.Suppress(pp.SkipTo(abc | abc, False)) + pp.Located(abc | abc).set_parse_action(show_match)
expr2.parse_string("ignored   abc")
# Outputs
# locn_start:7, locn_end:13
# Matched string '   abc'
```
